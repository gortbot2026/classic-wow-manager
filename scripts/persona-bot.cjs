/**
 * Persona Bot Module
 * 
 * Discord client for Maya — the AI persona that DMs players.
 * Connects using PERSONA_BOT_TOKEN (separate from the management bot),
 * listens for DMs, manages conversations, and generates AI responses
 * via the Anthropic API.
 * 
 * Exports a factory function following the createDiscordBridge() pattern.
 * 
 * @module persona-bot
 */

const { Client, GatewayIntentBits, Partials, ChannelType } = require('discord.js');
const crypto = require('crypto');
const { generateResponse } = require('./persona-llm.cjs');
const { buildPlayerContext, buildVoiceContext, resolvePlayerName, resolveTemplateVariables, applyTemplateVariables } = require('./persona-context.cjs');
const { detectContextNeeds, resolveEventFromMessage, fetchManagementContext } = require('./persona-management-context.cjs');

/**
 * Sanitizes LLM response text by removing em-dashes (U+2014) and en-dashes (U+2013).
 * Replaces them with comma-space to maintain readability, then collapses
 * any resulting double spaces.
 *
 * @param {string} text - Raw response text from the LLM
 * @returns {string} Sanitized text with dashes replaced
 */
function sanitizeResponse(text) {
  if (!text) return text;
  // Replace em-dashes and en-dashes with comma-space
  let result = text.replace(/[\u2014\u2013]/g, ',');
  // Collapse any double/triple spaces into single space
  result = result.replace(/ {2,}/g, ' ');
  // Clean up cases like ", ," from adjacent dashes
  result = result.replace(/,\s*,/g, ',');
  return result.trim();
}

/**
 * Sanitizes outgoing messages for Discord delivery.
 * Defense-in-depth guard that ensures no raw JSON, code fences, or oversized
 * messages ever reach a Discord user. Applied as the final step before sending.
 *
 * Guards (applied in order):
 * 1. JSON wrapper extraction — unwraps {"reply": "..."} objects
 * 2. Code fence stripping — removes triple-backtick wrappers
 * 3. Raw JSON detection — replaces pure JSON with a friendly fallback
 * 4. Length enforcement — truncates to Discord's 2000-char limit
 *
 * @param {string} text - Message text to sanitize
 * @returns {string} Sanitized text safe for Discord delivery
 */
function sanitizeForDiscord(text) {
  if (!text || typeof text !== 'string') return text;

  let result = text.trim();

  // Guard 1: Extract from JSON wrapper (e.g. {"reply": "...", "reaction": "..."})
  try {
    const parsed = JSON.parse(result);
    if (parsed && typeof parsed === 'object' && typeof parsed.reply === 'string') {
      result = parsed.reply.trim();
    }
  } catch (_) {
    // Not JSON — continue with raw text
  }

  // Guard 2: Strip markdown code fences (```json ... ``` or ``` ... ```)
  result = result.replace(/^```(?:json|js|javascript)?\s*\n?/i, '');
  result = result.replace(/\n?```\s*$/i, '');
  result = result.trim();

  // Guard 3: Detect raw JSON arrays/objects as the entire message
  if (/^\s*[\[{]/.test(result)) {
    try {
      JSON.parse(result);
      // If it parses as valid JSON, the LLM produced structured data — replace with fallback
      console.warn('[persona-bot] sanitizeForDiscord: detected raw JSON output, replacing with fallback');
      result = "Sorry, I had a bit of a brain freeze. Could you ask me that again?";
    } catch (_) {
      // Starts with [ or { but isn't valid JSON — likely normal text, leave it
    }
  }

  // Guard 4: Enforce Discord's 2000-character message limit
  if (result.length > 2000) {
    // Truncate at the last space before 1997 chars to avoid cutting mid-word
    const truncateAt = result.lastIndexOf(' ', 1997);
    result = result.slice(0, truncateAt > 0 ? truncateAt : 1997) + '...';
  }

  return result;
}

/**
 * Clamps a numeric value between a minimum and maximum.
 *
 * @param {number} value - Value to clamp
 * @param {number} min - Minimum bound
 * @param {number} max - Maximum bound
 * @returns {number} Clamped value
 */
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Calculates a human-like reading delay based on incoming message word count.
 * Simulates Maya reading the player's message before she starts thinking.
 *
 * @param {string} text - Incoming message text
 * @returns {number} Delay in milliseconds (1000–4000)
 */
function readingDelay(text) {
  const wordCount = (text || '').split(/\s+/).filter(Boolean).length;
  return clamp(wordCount * 200, 1000, 4000);
}

/**
 * Calculates a human-like typing delay based on outgoing response word count.
 * Simulates Maya typing out her reply after the LLM generates it.
 *
 * @param {string} text - Outgoing response text
 * @returns {number} Delay in milliseconds (500–12000)
 */
function typingDelay(text) {
  const wordCount = (text || '').split(/\s+/).filter(Boolean).length;
  return clamp(wordCount * 90, 500, 12000);
}

/**
 * Simulates realistic typing with random "thinking" pauses.
 * Splits the total typing time into unequal segments with gaps where the
 * typing indicator disappears, mimicking a human pausing to think mid-message.
 *
 * @param {import('discord.js').TextBasedChannel} channel - Discord channel to send typing indicators to
 * @param {number} totalTypingMs - Total typing duration in milliseconds (from typingDelay())
 * @returns {Promise<void>} Resolves when all typing simulation is complete
 */
async function simulateTypingWithPauses(channel, totalTypingMs) {
  // Determine number of thinking pauses: 1 per ~2500ms of typing, capped at 3
  const pauseCount = Math.min(Math.floor(totalTypingMs / 2500), 3);
  const segmentCount = pauseCount + 1;

  // Split total typing time into random-length segments
  const weights = [];
  for (let i = 0; i < segmentCount; i++) {
    weights.push(Math.random());
  }
  const weightSum = weights.reduce((sum, w) => sum + w, 0);
  const segments = weights.map(w => Math.round((w / weightSum) * totalTypingMs));

  // Generate random pause durations (1000–3000ms each)
  const pauses = [];
  for (let i = 0; i < pauseCount; i++) {
    pauses.push(Math.round(1000 + Math.random() * 2000));
  }

  console.log(`[persona-bot] simulateTypingWithPauses: totalMs=${totalTypingMs}, segments=[${segments.join(', ')}]ms, pauses=[${pauses.join(', ')}]ms`);

  for (let i = 0; i < segments.length; i++) {
    const segmentMs = segments[i];

    // Start typing indicator for this segment
    channel.sendTyping().catch(() => {});

    // Wait for segment duration, refreshing typing indicator every 8s
    let remaining = segmentMs;
    while (remaining > 0) {
      const waitTime = Math.min(remaining, 8000);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      remaining -= waitTime;
      // Refresh typing indicator if more time remains in this segment
      if (remaining > 0) {
        channel.sendTyping().catch(() => {});
      }
    }

    // Insert thinking pause between segments (no typing indicator)
    if (i < segments.length - 1) {
      await new Promise(resolve => setTimeout(resolve, pauses[i]));
    }
  }
}

/**
 * TEST MODE: When set, all Maya DMs go to this Discord ID instead of the actual player.
 * Remove this override when ready to go live.
 * @type {string|null}
 */
const MAYA_TEST_MODE_DISCORD_ID = '492023474437619732';

/**
 * In-memory lock map to prevent concurrent LLM calls per conversation.
 * Key: conversationId, Value: true if generation in progress.
 * @type {Map<string, boolean>}
 */
const generationLocks = new Map();

/**
 * Creates and configures the Maya persona Discord bot.
 * 
 * @param {Object} options
 * @param {import('pg').Pool} options.pool - PostgreSQL connection pool
 * @param {import('socket.io').Server} [options.io] - Socket.IO server instance (for real-time admin updates)
 * @returns {{ start: () => Promise<void>, sendDM: (discordId: string, content: string) => Promise<boolean>, getClient: () => Client|null, triggerTemplate: (triggerType: string, eventId: string, attendees: Array<{discord_id: string, player_name?: string}>) => Promise<void> }}
 */
function createPersonaBot(options = {}) {
  const { pool, io } = options;
  const token = process.env.PERSONA_BOT_TOKEN;

  /**
   * Webhook URL for posting raid leader summaries to the management Discord channel.
   * If not set, summary posting is silently skipped.
   * @type {string|undefined}
   */
  const MAYA_MANAGEMENT_WEBHOOK_URL = process.env.MAYA_MANAGEMENT_WEBHOOK_URL;

  /**
   * Channel ID of the management Discord channel Maya should watch and respond in.
   * If not set, channel watching is silently disabled.
   * @type {string|undefined}
   */
  const MAYA_MANAGEMENT_CHANNEL_ID = process.env.MAYA_MANAGEMENT_CHANNEL_ID;

  if (!token) {
    console.log('[persona-bot] Persona bot disabled (missing PERSONA_BOT_TOKEN)');
    return {
      start: async () => {},
      sendDM: async () => false,
      getClient: () => null,
      triggerTemplate: async () => {}
    };
  }

  /** @type {Client} */
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel, Partials.Message]
  });

  let ready = false;

  /**
   * Emits a Socket.IO event to the /maya-admin namespace.
   * @param {string} event - Event name
   * @param {Object} data - Event payload
   */
  function emitToAdmin(event, data) {
    if (!io) return;
    try {
      const mayaNsp = io.of('/maya-admin');
      mayaNsp.emit(event, data);
    } catch (err) {
      console.warn('[persona-bot] Socket.IO emit failed:', err.message || err);
    }
  }

  /**
   * Generation lock for management channel responses.
   * Prevents concurrent LLM calls when multiple messages arrive simultaneously.
   * @type {boolean}
   */
  let managementChannelLock = false;

  /**
   * Posts a raid leader summary to the management Discord channel via webhook.
   * Fire-and-forget — errors are logged but never fail the main flow.
   *
   * @param {string} summaryText - The full summary message text to post
   * @param {Object} [opts] - Additional options
   * @param {boolean} [opts.pending=false] - If true, marks the summary as pending (raidleader not yet assigned)
   */
  function postSummaryToWebhook(summaryText, opts = {}) {
    if (!MAYA_MANAGEMENT_WEBHOOK_URL) return;

    const { pending = false } = opts;

    // Extract the intro line as the embed title
    const lines = summaryText.split('\n');
    const title = pending
      ? `⏳ ${lines[0] || 'Pre-raid briefing summary'} [PENDING - No raidleader assigned]`
      : lines[0] || 'Pre-raid briefing summary';

    // Build the avatar URL if bot client is ready
    const avatarUrl = client.user ? client.user.displayAvatarURL({ size: 128 }) : undefined;

    const payload = {
      username: 'Maya',
      avatar_url: avatarUrl,
      embeds: [{
        author: {
          name: 'Maya',
          icon_url: avatarUrl
        },
        title: title.substring(0, 256),
        description: summaryText.substring(0, 4096),
        color: 0x9B59B6,
        timestamp: new Date().toISOString()
      }]
    };

    // Fire-and-forget with 10s timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    fetch(MAYA_MANAGEMENT_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    })
      .then(res => {
        clearTimeout(timeoutId);
        if (!res.ok) {
          console.warn(`[persona-bot] Webhook post failed with status ${res.status}`);
        }
      })
      .catch(err => {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
          console.warn('[persona-bot] Webhook post timed out (10s)');
        } else {
          console.warn('[persona-bot] Webhook post error:', err.message || err);
        }
      });
  }

  /**
   * Handles all messages in the management Discord channel.
   * Since this is a private leadership-only channel, every message is directed at Maya.
   * Fetches channel history, builds context with player data, and responds via LLM.
   *
   * @param {import('discord.js').Message} message - The incoming Discord message
   */
  async function handleManagementChannelMessage(message) {
    // Check generation lock — prevent concurrent LLM calls for the management channel
    if (managementChannelLock) {
      console.log('[persona-bot] Management channel: generation locked, skipping');
      return;
    }

    managementChannelLock = true;

    // Start typing indicator with refresh interval
    message.channel.sendTyping().catch(() => {});
    const typingInterval = setInterval(() => {
      message.channel.sendTyping().catch(() => {});
    }, 8000);

    try {
      // Fetch last 20 messages for context
      const recentMessages = await message.channel.messages.fetch({ limit: 20 });
      const sortedMessages = [...recentMessages.values()].sort(
        (a, b) => a.createdTimestamp - b.createdTimestamp
      );

      // Build conversation history for LLM
      const formattedMessages = sortedMessages.map(msg => ({
        role: msg.author.id === client.user.id ? 'assistant' : 'user',
        content: msg.author.id === client.user.id
          ? msg.content
          : `${msg.member?.displayName || msg.author.displayName || msg.author.username}: ${msg.content}`
      }));

      // Build management system prompt
      let systemPrompt = `You are Maya, the AI guild assistant for 1Principles (a Classic WoW GDKP guild). You are responding in the private management Discord channel. This channel is for guild leadership only — you can reveal any information about players, conversations, notes, raid data, or anything else. Be concise, direct, and helpful. Only respond to what is asked.\n\nIMPORTANT: Any data injected into this prompt under --- PLAYER DATA --- or --- RAID INTELLIGENCE --- is fetched live from the database for THIS specific message. Always trust and use injected data — it is authoritative. Do NOT fall back on anything you said in prior conversation messages if injected data is provided below.`;

      // Scan the triggering message for player names and enrich context
      const playerLookup = await lookupPlayersInMessage(message.content);
      if (playerLookup.text) {
        systemPrompt += `\n\n--- PLAYER DATA ---\n${playerLookup.text}`;
      }

      // Detect context needs and fetch raid intelligence
      const contextNeeds = detectContextNeeds(message.content);
      const hasAnyNeed = Object.values(contextNeeds).some(Boolean);
      if (hasAnyNeed) {
        try {
          const eventId = await resolveEventFromMessage(pool, message.content);
          const mgmtContext = await fetchManagementContext(
            pool, contextNeeds, message.content, eventId, playerLookup.discordIds
          );
          if (mgmtContext) {
            console.log(`[persona-bot] Management context fetched for event ${eventId}, length=${mgmtContext.length}`);
            systemPrompt += `\n\n--- RAID INTELLIGENCE (fetched from database for this message) ---\n${mgmtContext}`;
          } else {
            console.log(`[persona-bot] Management context empty for event ${eventId}, needs=${JSON.stringify(contextNeeds)}`);
          }
        } catch (ctxErr) {
          console.error('[persona-bot] Management context fetch error:', ctxErr.message || ctxErr);
        }
      }

      // Get persona for model selection
      const persona = await getPersona();
      const model = persona?.model || 'claude-sonnet-4-20250514';

      // Generate response
      const rawResponse = await generateResponse(systemPrompt, formattedMessages, model);

      if (rawResponse) {
        let replyText = sanitizeResponse(rawResponse);
        replyText = sanitizeForDiscord(replyText);

        // Enforce Discord 2000-char limit
        if (replyText.length > 2000) {
          replyText = replyText.substring(0, 1997) + '...';
        }

        await message.channel.send(replyText);
        console.log(`[persona-bot] Management channel: replied to ${message.author.displayName || message.author.username} (${replyText.length} chars)`);
      }
    } catch (err) {
      console.error('[persona-bot] Management channel error:', err.message || err);
    } finally {
      clearInterval(typingInterval);
      managementChannelLock = false;
    }
  }

  /**
   * Scans a message for player references and builds enriched context.
   * Matches players by character name, Discord username, or Discord ID (snowflake).
   * Includes player data, notes, conversation summaries, and conversation count.
   *
   * @param {string} messageContent - The message text to scan for player references
   * @returns {Promise<string|null>} Formatted player data string, or null if no players found
   */
  async function lookupPlayersInMessage(messageContent) {
    try {
      /** @type {Set<string>} Track processed discord_ids to prevent duplicates across all passes */
      const processedIds = new Set();
      const sections = [];

      /**
       * Builds an enriched player section with context, notes, conversations, and stats.
       *
       * @param {string} discordId - The player's Discord ID
       * @param {string} characterName - The player's character name (for section header)
       * @returns {Promise<string>} Formatted player data section
       */
      async function buildEnrichedSection(discordId, characterName) {
        const playerContext = await buildPlayerContext(pool, discordId);

        // Fetch Maya's notes about this player
        const notesRes = await pool.query(
          `SELECT note, created_at FROM bot_player_notes WHERE discord_id = $1 ORDER BY created_at DESC LIMIT 10`,
          [discordId]
        );
        const notesBlock = notesRes.rows.length > 0
          ? notesRes.rows.map(n => `- ${n.note}`).join('\n')
          : 'No notes recorded.';

        // Fetch recent conversations with message counts
        const convsRes = await pool.query(
          `SELECT bc.id, bc.status, bc.created_at, bc.summary,
                  (SELECT COUNT(*) FROM bot_messages bm WHERE bm.conversation_id = bc.id) as msg_count
           FROM bot_conversations bc
           WHERE bc.discord_id = $1
           ORDER BY bc.created_at DESC LIMIT 5`,
          [discordId]
        );
        const convsBlock = convsRes.rows.length > 0
          ? convsRes.rows.map(c => {
              const date = new Date(c.created_at).toISOString().split('T')[0];
              const summary = c.summary ? ` — ${c.summary}` : '';
              return `- [${c.status}] ${date}, ${c.msg_count} messages${summary}`;
            }).join('\n')
          : 'No conversations recorded.';

        // Fetch conversation count and last chat date
        const convCountRes = await pool.query(
          `SELECT COUNT(*) as count, MAX(created_at) as last_chat FROM bot_conversations WHERE discord_id = $1`,
          [discordId]
        );
        const convCount = parseInt(convCountRes.rows[0].count, 10) || 0;
        const lastChat = convCountRes.rows[0].last_chat
          ? new Date(convCountRes.rows[0].last_chat).toISOString().split('T')[0]
          : 'Never';
        const convStatsLine = `Total conversations: ${convCount}, Last chat: ${lastChat}`;

        return `## ${characterName}\n${playerContext || 'No player data available.'}\n\n**Conversation Stats:** ${convStatsLine}\n\n**Maya's Notes:**\n${notesBlock}\n\n**Recent Conversations:**\n${convsBlock}`;
      }

      // --- Pass 1: Character name matching ---
      const playersRes = await pool.query(
        `SELECT discord_id, character_name FROM players WHERE character_name IS NOT NULL`
      );

      for (const player of playersRes.rows) {
        // Case-insensitive word boundary match for player names
        const nameRegex = new RegExp(`\\b${player.character_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        if (!nameRegex.test(messageContent)) continue;

        processedIds.add(player.discord_id);
        sections.push(await buildEnrichedSection(player.discord_id, player.character_name));
      }

      // --- Pass 1.5: Roster override character name matching (players not in players table) ---
      const rosterCharRes = await pool.query(
        `SELECT DISTINCT discord_user_id, assigned_char_name FROM roster_overrides
         WHERE discord_user_id IS NOT NULL AND assigned_char_name IS NOT NULL`
      );

      for (const row of rosterCharRes.rows) {
        if (processedIds.has(row.discord_user_id)) continue;
        const nameRegex = new RegExp(`\\b${row.assigned_char_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        if (!nameRegex.test(messageContent)) continue;
        processedIds.add(row.discord_user_id);
        sections.push(await buildEnrichedSection(row.discord_user_id, row.assigned_char_name));
      }

      // --- Pass 1.6: bot_conversations player_name matching ---
      const convPlayerRes = await pool.query(
        `SELECT DISTINCT discord_id, player_name FROM bot_conversations
         WHERE player_name IS NOT NULL AND discord_id IS NOT NULL`
      );

      for (const row of convPlayerRes.rows) {
        if (processedIds.has(row.discord_id)) continue;
        // Extract first word (character name often first in "name/alt1/alt2" format)
        const firstName = row.player_name.split(/[\/\s]/)[0];
        if (!firstName || firstName.length < 2) continue;
        const nameRegex = new RegExp(`\\b${firstName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        if (!nameRegex.test(messageContent)) continue;
        processedIds.add(row.discord_id);
        sections.push(await buildEnrichedSection(row.discord_id, firstName));
      }

      // --- Pass 2: Discord username matching ---
      const discordUsersRes = await pool.query(
        `SELECT discord_id, username FROM discord_users WHERE username IS NOT NULL`
      );

      for (const discordUser of discordUsersRes.rows) {
        if (processedIds.has(discordUser.discord_id)) continue;

        const usernameRegex = new RegExp(`\\b${discordUser.username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        if (!usernameRegex.test(messageContent)) continue;

        // Look up the character name for the section header
        const playerRow = playersRes.rows.find(p => p.discord_id === discordUser.discord_id);
        const displayName = playerRow ? playerRow.character_name : discordUser.username;

        processedIds.add(discordUser.discord_id);
        sections.push(await buildEnrichedSection(discordUser.discord_id, displayName));
      }

      // --- Pass 3: Discord snowflake ID matching ---
      const snowflakeMatches = messageContent.match(/\b(\d{17,20})\b/g);
      if (snowflakeMatches) {
        for (const snowflake of snowflakeMatches) {
          if (processedIds.has(snowflake)) continue;

          // Validate the snowflake exists in the players table
          const snowflakeCheck = await pool.query(
            `SELECT discord_id, character_name FROM players WHERE discord_id = $1`,
            [snowflake]
          );
          if (snowflakeCheck.rows.length === 0) continue;

          const matchedPlayer = snowflakeCheck.rows[0];
          processedIds.add(matchedPlayer.discord_id);
          sections.push(await buildEnrichedSection(matchedPlayer.discord_id, matchedPlayer.character_name || snowflake));
        }
      }

      return {
        text: sections.length > 0 ? sections.join('\n\n') : null,
        discordIds: [...processedIds]
      };
    } catch (err) {
      console.error('[persona-bot] Player lookup error:', err.message || err);
      return { text: null, discordIds: [] };
    }
  }

  /**
   * Fetches the active persona configuration from the database.
   * @returns {Promise<{system_prompt: string, model: string, max_context_messages: number}|null>}
   */
  async function getPersona() {
    try {
      const result = await pool.query(
        `SELECT system_prompt, model, max_context_messages FROM bot_persona ORDER BY id LIMIT 1`
      );
      return result.rows[0] || null;
    } catch (err) {
      console.error('[persona-bot] Failed to fetch persona:', err.message || err);
      return null;
    }
  }

  /**
   * Finds an existing conversation for a discord user, or creates one.
   * @param {string} discordId 
   * @param {string} [playerName]
   * @returns {Promise<{id: string, status: string, admin_override: boolean, template_id: string|null}>}
   */
  async function findOrCreateConversation(discordId, playerName) {
    // Check for existing non-closed conversation
    const existing = await pool.query(
      `SELECT id, status, admin_override, template_id FROM bot_conversations 
       WHERE discord_id = $1 AND status != 'closed' 
       ORDER BY created_at DESC LIMIT 1`,
      [discordId]
    );
    if (existing.rows.length > 0) return existing.rows[0];

    // Create new conversation
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO bot_conversations (id, discord_id, player_name, status, started_by)
       VALUES ($1, $2, $3, 'active', 'auto')`,
      [id, discordId, playerName || null]
    );
    return { id, status: 'active', admin_override: false, template_id: null };
  }

  /**
   * Stores a message in the bot_messages table and emits to admin.
   * @param {string} conversationId
   * @param {string} role - 'user' | 'maya' | 'admin'
   * @param {string} content
   * @param {string} [modelUsed]
   * @returns {Promise<{id: number, sent_at: string}>}
   */
  async function storeMessage(conversationId, role, content, modelUsed) {
    const result = await pool.query(
      `INSERT INTO bot_messages (conversation_id, role, content, model_used)
       VALUES ($1, $2, $3, $4)
       RETURNING id, sent_at`,
      [conversationId, role, content, modelUsed || null]
    );
    const msg = result.rows[0];

    // Update conversation timestamp
    await pool.query(
      `UPDATE bot_conversations SET updated_at = NOW() WHERE id = $1`,
      [conversationId]
    );

    // Emit real-time update
    emitToAdmin('maya:message', {
      conversationId,
      role,
      content,
      modelUsed: modelUsed || null,
      sentAt: msg.sent_at,
      messageId: msg.id
    });

    return msg;
  }

  /**
   * Builds the full LLM message context for a conversation.
   * @param {string} conversationId
   * @param {string} discordId
   * @param {{system_prompt: string, max_context_messages: number}} persona
   * @returns {Promise<{systemPrompt: string, messages: Array<{role: string, content: string}>}>}
   */
  async function buildContext(conversationId, discordId, persona) {
    // Get conversation details (for template instructions and event_id)
    const convRes = await pool.query(
      `SELECT template_id, event_id FROM bot_conversations WHERE id = $1`,
      [conversationId]
    );
    const conv = convRes.rows[0];

    // Resolve template variables for agent_instructions substitution
    const templateVars = await resolveTemplateVariables(
      pool, discordId, conv?.event_id || null, conversationId
    );

    // Start with persona system prompt
    let systemPrompt = persona.system_prompt;

    // Add template-specific instructions if applicable (with variable resolution)
    if (conv && conv.template_id) {
      const tplRes = await pool.query(
        `SELECT agent_instructions, model_override FROM bot_templates WHERE id = $1`,
        [conv.template_id]
      );
      if (tplRes.rows.length > 0 && tplRes.rows[0].agent_instructions) {
        const resolvedInstructions = applyTemplateVariables(tplRes.rows[0].agent_instructions, templateVars);
        systemPrompt += '\n\n=== Conversation-Specific Instructions ===\n' + resolvedInstructions;
      }
    }

    // Build player context
    const playerContext = await buildPlayerContext(pool, discordId);
    if (playerContext) {
      systemPrompt += '\n\n=== Player Data ===\n' + playerContext;
    }

    // Build voice transcript context (Phase 2 — returns empty string until implemented)
    const charsRes = await pool.query(
      `SELECT character_name FROM players WHERE discord_id = $1`,
      [discordId]
    );
    const charNames = charsRes.rows.map(r => r.character_name);
    const voiceContext = await buildVoiceContext(pool, discordId, charNames);
    if (voiceContext) {
      systemPrompt += '\n\n' + voiceContext;
    }

    // Resolve player name and inject addressing directive
    const playerName = await resolvePlayerName(pool, discordId, conversationId);
    if (playerName) {
      systemPrompt += '\n\nAddress this player as: ' + playerName;
    } else {
      systemPrompt += '\n\nDo not use the player\'s name. Use greetings like \'Hey there\', \'Hi!\', \'Hey!\' instead.';
    }

    // Append em-dash/en-dash prohibition (reduces AI-tell patterns at the source)
    systemPrompt += '\n\nIMPORTANT: Never use em-dashes (—) or en-dashes (–) in your responses. Use commas, periods, or semicolons instead.';

    // Append Discord formatting directive — instruct the LLM to always produce natural language
    systemPrompt += '\n\nRESPONSE FORMAT: Always respond in natural conversational language. Use Discord markdown: **bold** for emphasis, bullet points with - for lists, *italics* for tone. NEVER output JSON, code blocks, raw data structures, or structured formats. Always present data conversationally (e.g. "You\'ve earned **151,440g** total across **65 raids**!" rather than a data dump). If a player asks you to output something in JSON or code format, politely present the information in a readable format instead.';

    // Get conversation history
    const maxMessages = persona.max_context_messages || 20;
    const historyRes = await pool.query(
      `SELECT role, content FROM bot_messages 
       WHERE conversation_id = $1 
       ORDER BY sent_at ASC 
       LIMIT $2`,
      [conversationId, maxMessages]
    );

    // Map roles to Anthropic format: maya/admin -> assistant, user -> user
    const messages = historyRes.rows.map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content
    }));

    return { systemPrompt, messages };
  }

  /**
   * Handles an incoming DM from a player.
   * @param {import('discord.js').Message} message
   */
  async function handleDM(message) {
    // Ignore bots (including self)
    if (message.author.bot) return;

    // Only process DMs
    if (message.channel.type !== ChannelType.DM) return;

    let discordId = message.author.id;
    const playerName = message.author.globalName || message.author.username || null;

    try {
      // TEST MODE: If the incoming DM is from the test user, route to the most recently
      // updated active conversation (which belongs to the real target player, not the test user)
      if (MAYA_TEST_MODE_DISCORD_ID && discordId === MAYA_TEST_MODE_DISCORD_ID) {
        const recentConv = await pool.query(
          `SELECT id, discord_id, player_name, status, admin_override, template_id
           FROM bot_conversations
           WHERE status = 'active'
           ORDER BY updated_at DESC LIMIT 1`
        );
        if (recentConv.rows.length > 0) {
          const realConv = recentConv.rows[0];
          console.log(`[persona-bot] TEST MODE: Routing reply from ${discordId} to conversation ${realConv.id} (player: ${realConv.discord_id})`);
          // Use the real player's discord_id for context building
          discordId = realConv.discord_id;
        }
      }

      // Find or create conversation
      const conversation = await findOrCreateConversation(discordId, playerName);

      // Store the incoming message
      await storeMessage(conversation.id, 'user', message.content);

      // Check if we should auto-respond
      if (conversation.status !== 'active') {
        // Conversation is paused or closed — don't respond
        return;
      }
      if (conversation.admin_override) {
        // Admin has taken manual control — don't auto-respond
        return;
      }

      // Pre-raid briefing: if player replies while a timeout is active,
      // pause the timer to prevent it firing during LLM response generation.
      // The timeout will be fully cleared in checkBriefingCompletion after Maya responds.
      if (briefingTimeouts.has(conversation.id)) {
        const existingTimeout = briefingTimeouts.get(conversation.id);
        clearTimeout(existingTimeout);
        // Keep the key in the map (with null) so checkBriefingCompletion knows
        // the final question was asked and this is a Path A reply
        briefingTimeouts.set(conversation.id, null);
      }

      // Check generation lock (one at a time per conversation)
      if (generationLocks.get(conversation.id)) {
        return; // Already generating, skip
      }
      generationLocks.set(conversation.id, true);

      try {
        // Emit typing indicator
        emitToAdmin('maya:typing', { conversationId: conversation.id, typing: true });

        // Fetch persona config
        const persona = await getPersona();
        if (!persona) {
          console.warn('[persona-bot] No persona configured — skipping response');
          return;
        }

        // Determine model (template override or persona default)
        let model = persona.model;
        if (conversation.template_id) {
          const tplRes = await pool.query(
            `SELECT model_override FROM bot_templates WHERE id = $1`,
            [conversation.template_id]
          );
          if (tplRes.rows.length > 0 && tplRes.rows[0].model_override) {
            model = tplRes.rows[0].model_override;
          }
        }

        // Build context and generate response
        const { systemPrompt, messages } = await buildContext(conversation.id, discordId, persona);
        
        // Human-like reading delay — simulates Maya reading the incoming message
        const readDelay = readingDelay(message.content);
        await new Promise(resolve => setTimeout(resolve, readDelay));

        // Start Discord typing indicator and refresh it every 8s during LLM generation
        message.channel.sendTyping().catch(() => {});
        const typingInterval = setInterval(() => {
          message.channel.sendTyping().catch(() => {});
        }, 8000);

        let rawResponse;
        try {
          rawResponse = await generateResponse(systemPrompt, messages, model);
        } finally {
          clearInterval(typingInterval);
        }

        if (rawResponse) {
          // Sanitize the LLM response: em-dash removal first, then Discord safety guards
          let replyText = sanitizeResponse(rawResponse);
          replyText = sanitizeForDiscord(replyText);

          // Human-like typing delay with thinking pauses — simulates Maya composing her reply
          const typeDelay = typingDelay(replyText);
          await simulateTypingWithPauses(message.channel, typeDelay);

          // Strip structured signal tags before sending to Discord
          const sendText = replyText.replace(/\[SEND_BRIEFING\]/gi, '').trim();

          // Store and send the response
          await storeMessage(conversation.id, 'maya', replyText, model);

          // Send via Discord DM
          await message.channel.send(sendText);

          // Fire-and-forget: extract notes from this exchange
          extractPlayerNotes(pool, io, discordId, conversation.id, message.content, replyText)
            .catch(err => console.error('[persona-bot] Note extraction failed (non-blocking):', err.message || err));

          // Pre-raid briefing: check if Maya's response contains the marker phrase
          // to start the 10-minute timeout for raidleader summary forwarding
          checkBriefingMarker(conversation.id, discordId, conversation.template_id, replyText)
            .catch(err => console.error('[persona-bot] Briefing marker check failed (non-blocking):', err.message || err));

          // Pre-raid briefing: if player replied after the final question (timeout was active),
          // complete Path A — generate summary, forward to raidleader, confirm to player
          const briefingCompleted = await checkBriefingCompletion(conversation.id, discordId, replyText);
          if (briefingCompleted) {
            // Conversation is now closed — skip further processing
          }
        }
      } finally {
        generationLocks.delete(conversation.id);
        emitToAdmin('maya:typing', { conversationId: conversation.id, typing: false });
      }
    } catch (err) {
      console.error('[persona-bot] Error handling DM:', err.message || err);
      generationLocks.delete(discordId);
    }
  }

  /**
   * Sends a DM to a Discord user via Maya's bot account.
   * Used by admin message injection and auto-triggers.
   * 
   * @param {string} discordId - Target user's Discord ID
   * @param {string} content - Message content to send
   * @returns {Promise<boolean>} True if message was sent successfully
   */
  async function sendDM(discordId, content) {
    if (!ready || !client) return false;
    try {
      // TEST MODE: redirect DM to test Discord ID while preserving real player in conversation data
      const targetId = MAYA_TEST_MODE_DISCORD_ID || discordId;
      if (MAYA_TEST_MODE_DISCORD_ID && targetId !== discordId) {
        console.log(`[persona-bot] TEST MODE: Redirecting DM from ${discordId} to ${targetId}`);
      }
      const user = await client.users.fetch(targetId);
      if (!user) return false;
      // Sanitize outgoing content through Discord safety guards
      const sanitizedContent = sanitizeForDiscord(content);
      await user.send(sanitizedContent);
      return true;
    } catch (err) {
      console.error('[persona-bot] Failed to send DM to', discordId, ':', err.message || err);
      return false;
    }
  }

  /**
   * In-memory map tracking 10-minute reply timeouts for pre-raid briefing conversations.
   * Key: conversationId, Value: NodeJS.Timeout handle.
   * Cleared automatically on bot restart (in-memory only).
   * @type {Map<string, NodeJS.Timeout>}
   */
  const briefingTimeouts = new Map();

  /**
   * Interval handle for polling pending raidleader summaries.
   * @type {NodeJS.Timeout|null}
   */
  let pendingSummaryPollInterval = null;

  /**
   * Sends a pre-raid briefing summary DM to the raidleader for a given conversation.
   * Resolves the raidleader via event_metadata -> players table lookup.
   * If raidleader is not yet set, queues the summary in pending_raidleader_summaries.
   *
   * @param {string} conversationId - The conversation to summarize and forward
   * @param {string} playerDiscordId - The player's Discord ID (for pending queue)
   * @returns {Promise<boolean>} True if summary was sent or queued successfully
   */
  async function sendSummaryToRaidleader(conversationId, playerDiscordId) {
    try {
      // Get event_id from the conversation
      const convRes = await pool.query(
        `SELECT event_id FROM bot_conversations WHERE id = $1`,
        [conversationId]
      );
      const eventId = convRes.rows[0]?.event_id;

      if (!eventId) {
        console.warn(`[persona-bot] Conversation ${conversationId} has no event_id, skipping summary forwarding`);
        return false;
      }

      // Get the player's identity for the summary header
      // Use conversation's actual discord_id (not playerDiscordId which may be TEST MODE overridden)
      const convDiscordRes = await pool.query(
        `SELECT discord_id FROM bot_conversations WHERE id = $1`, [conversationId]
      );
      const actualDiscordId = convDiscordRes.rows[0]?.discord_id || playerDiscordId;

      // Try players table first, then roster_overrides, then discord_users
      const charRes = await pool.query(
        `SELECT character_name FROM players WHERE discord_id = $1 LIMIT 1`,
        [actualDiscordId]
      );
      let characterName = charRes.rows[0]?.character_name;

      if (!characterName && eventId) {
        const rosterRes = await pool.query(
          `SELECT assigned_char_name FROM roster_overrides WHERE event_id = $1 AND discord_user_id = $2 LIMIT 1`,
          [eventId, actualDiscordId]
        );
        characterName = rosterRes.rows[0]?.assigned_char_name;
      }

      if (!characterName) {
        const duRes = await pool.query(
          `SELECT username FROM discord_users WHERE discord_id = $1 LIMIT 1`, [actualDiscordId]
        );
        if (duRes.rows[0]?.username) {
          const raw = duRes.rows[0].username;
          const sanitized = raw.replace(/[^a-zA-Z]/g, '');
          characterName = sanitized.length >= 2
            ? sanitized.charAt(0).toUpperCase() + sanitized.slice(1).toLowerCase()
            : raw;
        }
      }
      characterName = characterName || 'Unknown Player';

      // Generate the summary — pass characterName so LLM knows who the player is (not the raidleader)
      const summary = await generateRaidleaderSummary(pool, conversationId, characterName);
      if (!summary) {
        console.warn(`[persona-bot] Failed to generate raidleader summary for conversation ${conversationId}`);
        return false;
      }

      // Get next upcoming raid name for intro line
      let raidLabel = 'tonight\'s raid';
      if (eventId) {
        const evtRes = await pool.query(
          `SELECT raidleader_name FROM event_metadata WHERE event_id = $1`, [eventId]
        );
        // Try events_cache for title
        const cacheRes = await pool.query(
          `SELECT e->>'title' as title FROM events_cache, jsonb_array_elements(events_data) e WHERE cache_key = 'raid_helper_events' AND e->>'id' = $1 LIMIT 1`,
          [eventId]
        ).catch(() => ({ rows: [] }));
        if (cacheRes.rows[0]?.title) {
          raidLabel = cacheRes.rows[0].title.replace(/\s*\|\s*/g, ' ').trim();
        }
      }

      // Format the summary DM with intro line
      const introLine = `I just spoke to **${characterName}** about ${raidLabel}. Here's a quick briefing summary:`;
      const summaryDM = `${introLine}\n\n${summary}`;

      // Look up raidleader for this event
      const rlRes = await pool.query(
        `SELECT raidleader_name FROM event_metadata WHERE event_id = $1`,
        [eventId]
      );
      const raidleaderName = rlRes.rows[0]?.raidleader_name;

      if (!raidleaderName) {
        // Raidleader not yet set — queue the summary for later delivery
        const pendingId = crypto.randomUUID();
        await pool.query(
          `INSERT INTO pending_raidleader_summaries (id, event_id, conversation_id, summary_text, player_discord_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [pendingId, eventId, conversationId, summaryDM, playerDiscordId]
        );
        console.log(`[persona-bot] Raidleader not set for event ${eventId}, queued summary ${pendingId}`);
        // Post to management webhook even when pending (leadership sees it immediately)
        postSummaryToWebhook(summaryDM, { pending: true });
        return true;
      }

      // Resolve raidleader's discord_id from players table
      const rlDiscordRes = await pool.query(
        `SELECT discord_id FROM players WHERE character_name = $1 LIMIT 1`,
        [raidleaderName]
      );
      const raidleaderDiscordId = rlDiscordRes.rows[0]?.discord_id;

      if (!raidleaderDiscordId) {
        console.warn(`[persona-bot] Raidleader "${raidleaderName}" has no discord_id in players table`);
        emitToAdmin('maya:error', {
          type: 'raidleader_lookup_failed',
          eventId,
          raidleaderName,
          message: `Raidleader "${raidleaderName}" not found in players table (no discord_id). Summary for conversation ${conversationId} could not be delivered.`
        });
        return false;
      }

      // Send the summary DM to the raidleader
      const sent = await sendDM(raidleaderDiscordId, summaryDM);
      if (sent) {
        console.log(`[persona-bot] Sent pre-raid summary to raidleader ${raidleaderName} (${raidleaderDiscordId})`);
        // Post to management webhook (fire-and-forget)
        postSummaryToWebhook(summaryDM);
      } else {
        console.warn(`[persona-bot] Failed to send pre-raid summary DM to raidleader ${raidleaderName}`);
      }
      return sent;
    } catch (err) {
      console.error('[persona-bot] Error in sendSummaryToRaidleader:', err.message || err);
      return false;
    }
  }

  /**
   * Polls for pending raidleader summaries where the raidleader has now been set.
   * Sends all queued summaries and updates their sent_at timestamps.
   */
  async function processPendingSummaries() {
    try {
      // Find pending summaries whose events now have a raidleader_name set
      const pendingRes = await pool.query(
        `SELECT prs.id, prs.event_id, prs.summary_text, prs.player_discord_id,
                em.raidleader_name
         FROM pending_raidleader_summaries prs
         JOIN event_metadata em ON em.event_id = prs.event_id
         WHERE prs.sent_at IS NULL
           AND em.raidleader_name IS NOT NULL
           AND em.raidleader_name != ''`
      );

      if (pendingRes.rows.length === 0) return;

      console.log(`[persona-bot] Processing ${pendingRes.rows.length} pending raidleader summaries`);

      for (const row of pendingRes.rows) {
        // Resolve raidleader discord_id
        const rlDiscordRes = await pool.query(
          `SELECT discord_id FROM players WHERE character_name = $1 LIMIT 1`,
          [row.raidleader_name]
        );
        const raidleaderDiscordId = rlDiscordRes.rows[0]?.discord_id;

        if (!raidleaderDiscordId) {
          console.warn(`[persona-bot] Pending summary ${row.id}: raidleader "${row.raidleader_name}" has no discord_id`);
          emitToAdmin('maya:error', {
            type: 'raidleader_lookup_failed',
            eventId: row.event_id,
            raidleaderName: row.raidleader_name,
            message: `Raidleader "${row.raidleader_name}" not found in players table. Pending summary ${row.id} could not be delivered.`
          });
          continue;
        }

        const sent = await sendDM(raidleaderDiscordId, row.summary_text);
        if (sent) {
          await pool.query(
            `UPDATE pending_raidleader_summaries SET sent_at = NOW() WHERE id = $1`,
            [row.id]
          );
          console.log(`[persona-bot] Sent pending summary ${row.id} to raidleader ${row.raidleader_name}`);
        }
      }
    } catch (err) {
      console.error('[persona-bot] Error processing pending summaries:', err.message || err);
    }
  }

  /**
   * Handles the pre-raid briefing timeout (Path B).
   * When a player doesn't reply within 10 minutes of the final Q&A question,
   * generates and sends the summary to the raidleader, notifies the player,
   * and closes the conversation.
   *
   * @param {string} conversationId - The timed-out conversation
   * @param {string} playerDiscordId - The player's Discord ID
   */
  async function handleBriefingTimeout(conversationId, playerDiscordId) {
    try {
      console.log(`[persona-bot] Pre-raid briefing timeout for conversation ${conversationId}`);
      briefingTimeouts.delete(conversationId);

      // Check if the summary was already sent (conversation already closed by player reply)
      const convCheck = await pool.query(
        `SELECT status FROM bot_conversations WHERE id = $1`, [conversationId]
      );
      if (convCheck.rows[0]?.status === 'closed') {
        console.log(`[persona-bot] Conversation ${conversationId} already closed — skipping timeout send`);
        return false;
      }

      // Generate and send summary to raidleader
      await sendSummaryToRaidleader(conversationId, playerDiscordId);

      // Notify the player
      await sendDM(playerDiscordId, 'No reply, so I went ahead and forwarded it to the raidleader. Good luck tonight!');

      // Store the timeout notification as a maya message
      await storeMessage(conversationId, 'maya', 'No reply, so I went ahead and forwarded it to the raidleader. Good luck tonight!');

      // Close the conversation
      await pool.query(
        `UPDATE bot_conversations SET status = 'closed', updated_at = NOW() WHERE id = $1`,
        [conversationId]
      );
      emitToAdmin('maya:conversationUpdate', { conversationId, status: 'closed' });
    } catch (err) {
      console.error('[persona-bot] Error handling briefing timeout:', err.message || err);
    }
  }

  /**
   * Checks if a Maya response in a pre-raid briefing conversation contains
   * the marker phrase indicating the final Q&A question has been asked.
   * If detected, starts a 10-minute timeout timer.
   *
   * @param {string} conversationId - The conversation ID
   * @param {string} playerDiscordId - The player's Discord ID
   * @param {string} templateId - The template ID for the conversation
   * @param {string} responseText - Maya's response text to check
   */
  async function checkBriefingMarker(conversationId, playerDiscordId, templateId, responseText) {
    if (!templateId) return;

    try {
      // Check if this is a pre_raid_briefing template
      const tplRes = await pool.query(
        `SELECT trigger_type FROM bot_templates WHERE id = $1`,
        [templateId]
      );
      if (tplRes.rows.length === 0 || tplRes.rows[0].trigger_type !== 'pre_raid_briefing') return;

      // Check for marker phrase in the response
      const lowerResponse = responseText.toLowerCase();
      // Detect when Maya asks the wrap-up question OR uses the structured tag
      // Trigger when Maya asks "anything else" before forwarding — she does this reliably
      const isWrapUpQuestion = (
        lowerResponse.includes('[send_briefing]') ||
        (lowerResponse.includes('anything else') && (
          lowerResponse.includes('forward') ||
          lowerResponse.includes('raidleader') ||
          lowerResponse.includes('zaappi') ||
          lowerResponse.includes('pass this') ||
          lowerResponse.includes('send this')
        ))
      );
      if (isWrapUpQuestion) {
        // Start 10-minute timeout (only if not already set)
        if (!briefingTimeouts.has(conversationId)) {
          console.log(`[persona-bot] Detected final Q&A marker in conversation ${conversationId}, starting 10-min timeout`);
          const timeout = setTimeout(
            () => handleBriefingTimeout(conversationId, playerDiscordId),
            10 * 60 * 1000 // 10 minutes
          );
          briefingTimeouts.set(conversationId, timeout);
        }
      }
    } catch (err) {
      console.error('[persona-bot] Error checking briefing marker:', err.message || err);
    }
  }

  /**
   * Checks if a player's reply to a pre-raid briefing conversation indicates
   * they have nothing more to add (Path A completion). Detects this by checking
   * if a timeout was active (meaning the final question was asked) and the player replied.
   *
   * @param {string} conversationId - The conversation ID
   * @param {string} playerDiscordId - The player's Discord ID
   * @param {string} responseText - Maya's response to the player's reply
   * @returns {Promise<boolean>} True if this was a Path A completion
   */
  async function checkBriefingCompletion(conversationId, playerDiscordId, responseText) {
    // If there was an active timeout (or paused timeout), the player replied after the final question
    if (!briefingTimeouts.has(conversationId)) return false;

    // Clear the timeout — player replied (Path A)
    const timeout = briefingTimeouts.get(conversationId);
    if (timeout) clearTimeout(timeout);
    briefingTimeouts.delete(conversationId);

    try {
      // Generate and send summary to raidleader
      await sendSummaryToRaidleader(conversationId, playerDiscordId);

      // Confirm to the player
      await sendDM(playerDiscordId, 'Great, forwarded it! Good luck tonight.');
      await storeMessage(conversationId, 'maya', 'Great, forwarded it! Good luck tonight.');

      // Close the conversation
      await pool.query(
        `UPDATE bot_conversations SET status = 'closed', updated_at = NOW() WHERE id = $1`,
        [conversationId]
      );
      emitToAdmin('maya:conversationUpdate', { conversationId, status: 'closed' });

      return true;
    } catch (err) {
      console.error('[persona-bot] Error completing briefing (Path A):', err.message || err);
      return false;
    }
  }

  /**
   * Fires an auto-trigger template for a list of attendees.
   * Creates conversations and sends opening messages. Idempotent —
   * skips players who already have active conversations or previously
   * closed conversations.
   * 
   * @param {string} triggerType - Template trigger type ('post_raid', 'welcome', 'item_won')
   * @param {string} eventId - The event ID that triggered this (for context)
   * @param {Array<{discord_id: string, player_name?: string}>} attendees - Players to contact
   */
  async function triggerTemplate(triggerType, eventId, attendees) {
    if (!ready) {
      console.warn('[persona-bot] Bot not ready — skipping trigger');
      return;
    }

    try {
      // Find active auto-trigger templates for this type
      const tplRes = await pool.query(
        `SELECT id, name, opening_message, agent_instructions, model_override
         FROM bot_templates 
         WHERE trigger_type = $1 AND auto_trigger = TRUE`,
        [triggerType]
      );

      if (tplRes.rows.length === 0) return;

      const template = tplRes.rows[0]; // Use first matching template

      for (const attendee of attendees) {
        try {
          if (!attendee.discord_id) continue;

          // Check for existing conversation (active or closed)
          const existingRes = await pool.query(
            `SELECT id, status FROM bot_conversations 
             WHERE discord_id = $1 
             ORDER BY created_at DESC LIMIT 1`,
            [attendee.discord_id]
          );

          // Skip if active conversation exists or player previously closed
          if (existingRes.rows.length > 0) {
            const existing = existingRes.rows[0];
            if (existing.status === 'active' || existing.status === 'closed') {
              continue;
            }
          }

          // Create conversation (with event_id if provided)
          const convId = crypto.randomUUID();
          await pool.query(
            `INSERT INTO bot_conversations (id, discord_id, player_name, status, started_by, template_id, event_id)
             VALUES ($1, $2, $3, 'active', 'template', $4, $5)`,
            [convId, attendee.discord_id, attendee.player_name || null, template.id, eventId || null]
          );

          // Generate LLM-powered opening with fallback to variable substitution
          const { generated, fallback, modelUsed } = await generateOpeningMessage(
            pool, template, attendee.discord_id, eventId || null, convId
          );
          const opening = generated || fallback;

          // Store and send the opening message (model_used reflects actual generation)
          await storeMessage(convId, 'maya', opening, generated ? modelUsed : null);
          await sendDM(attendee.discord_id, opening);

          // Small delay between messages to avoid rate limits
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (innerErr) {
          console.error('[persona-bot] Trigger error for', attendee.discord_id, ':', innerErr.message || innerErr);
        }
      }
    } catch (err) {
      console.error('[persona-bot] Template trigger error:', err.message || err);
    }
  }

  /**
   * Starts the persona bot and connects to Discord.
   * Also starts the pending raidleader summary polling interval.
   */
  async function start() {
    client.once('ready', () => {
      ready = true;
      console.log(`[persona-bot] Maya ready as ${client.user?.tag || client.user?.id || 'persona-bot'}`);

      // Start polling for pending raidleader summaries every 5 minutes
      pendingSummaryPollInterval = setInterval(() => {
        processPendingSummaries().catch(err =>
          console.error('[persona-bot] Pending summary poll error:', err.message || err)
        );
      }, 5 * 60 * 1000);
      console.log('[persona-bot] Started pending raidleader summary polling (5-min interval)');
    });

    client.on('messageCreate', (message) => {
      // Ignore all bot messages (prevents self-reply loops)
      if (message.author.bot) return;

      // Route DMs to existing handler
      if (message.channel.type === ChannelType.DM) {
        handleDM(message);
        return;
      }

      // Route management channel messages to the management handler
      if (MAYA_MANAGEMENT_CHANNEL_ID && message.channel.id === MAYA_MANAGEMENT_CHANNEL_ID) {
        handleManagementChannelMessage(message);
        return;
      }
    });

    // Clear polling interval and briefing timeouts on disconnect
    client.on('disconnect', () => {
      if (pendingSummaryPollInterval) {
        clearInterval(pendingSummaryPollInterval);
        pendingSummaryPollInterval = null;
        console.log('[persona-bot] Cleared pending summary polling interval (disconnect)');
      }
      // Clear all briefing timeouts
      for (const [convId, timeout] of briefingTimeouts) {
        if (timeout) clearTimeout(timeout);
      }
      briefingTimeouts.clear();
    });

    try {
      await client.login(token);
    } catch (err) {
      console.error('[persona-bot] Failed to login:', err.message || err);
    }
  }

  return {
    start,
    sendDM,
    getClient: () => client,
    triggerTemplate,
    sendSummaryToRaidleader
  };
}

/**
 * Extracts personal facts from a player-Maya exchange and stores them as notes.
 * Runs asynchronously — failures are logged but never block the main reply flow.
 *
 * @param {import('pg').Pool} pool - PostgreSQL connection pool
 * @param {import('socket.io').Server|null} io - Socket.IO server for real-time events
 * @param {string} discordId - Player's Discord ID
 * @param {string} conversationId - Current conversation ID
 * @param {string} playerMessage - The player's message text
 * @param {string} mayaReply - Maya's reply text
 */
async function extractPlayerNotes(pool, io, discordId, conversationId, playerMessage, mayaReply) {
  // Fetch existing notes for deduplication context (20 most recent)
  const existingRes = await pool.query(
    `SELECT note FROM bot_player_notes WHERE discord_id = $1 ORDER BY created_at DESC LIMIT 20`,
    [discordId]
  );
  const existingNotes = existingRes.rows.map(r => r.note);

  const existingNotesBlock = existingNotes.length > 0
    ? `\n\nEXISTING NOTES (already stored — do NOT create duplicates):\n${existingNotes.map(n => `- ${n}`).join('\n')}`
    : '';

  const extractionPrompt = `You are an information extraction assistant for a World of Warcraft guild bot called Maya.

Based on the exchange below, extract ONLY personal, non-queryable facts about the player. Return a JSON array of short note strings. Return empty array [] if nothing notable.

DO store (personal info Maya cannot look up in the database):
- Personal preferences (e.g. "prefers not to raid on Fridays")
- Personality traits (e.g. "tends to joke around", "very competitive")
- Life context (e.g. "mentioned they work nights", "going on vacation next week")
- Goals or wishes (e.g. "wants to main Priest next phase")
- Opinions (e.g. "doesn't like the loot council system")
- Any personal detail from conversation that gives useful future context

DO NOT store (data already tracked in the database):
- Gold earned or spent (tracked in rewards table)
- Raid attendance, dates, or counts (tracked in raid logs)
- Items won or loot details (tracked in loot table)
- Character names, class, race, or level (tracked in players table)
- Guild join date or membership status (tracked in guild records)
- Any game statistic or fact that can be queried from the database

DEDUPLICATION — This is critical:
- If existing notes are listed below, do NOT extract anything that is semantically similar, a rephrasing, or a subset of an existing note.
- "Semantically similar" means the same meaning even if worded differently. For example, if "works night shifts" exists, do not add "mentioned working nights".
- Only extract genuinely NEW personal information not already captured.

Each note should be a single concise sentence.${existingNotesBlock}`;

  const exchangeMessages = [
    { role: 'user', content: `Player said: "${playerMessage}"\n\nMaya replied: "${mayaReply}"\n\nExtract notable personal facts as JSON array:` }
  ];

  const rawResponse = await generateResponse(extractionPrompt, exchangeMessages, 'claude-haiku-4-5');

  // Parse JSON array from response — handle markdown code fences
  let notes = [];
  try {
    const cleaned = rawResponse.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    notes = JSON.parse(cleaned);
  } catch (_) {
    // Try to find a JSON array in the response
    const match = rawResponse.match(/\[[\s\S]*?\]/);
    if (match) {
      try { notes = JSON.parse(match[0]); } catch (__) { /* no valid JSON */ }
    }
  }

  if (!Array.isArray(notes)) return;

  for (const note of notes) {
    if (typeof note !== 'string' || note.trim().length === 0) continue;
    const trimmed = note.trim().slice(0, 500);
    const insertRes = await pool.query(
      `INSERT INTO bot_player_notes (discord_id, note, source_conversation_id)
       VALUES ($1, $2, $3) RETURNING *`,
      [discordId, trimmed, conversationId]
    );
    if (io) {
      try { io.of('/maya-admin').emit('maya:note-added', { discordId, note: insertRes.rows[0] }); } catch (_) {}
    }
  }
}

/**
 * Generates a short summary of a closed conversation using Claude Haiku.
 * Called asynchronously (fire-and-forget) after a conversation is closed.
 * Stores the summary in bot_conversations.summary.
 *
 * @param {import('pg').Pool} pool - PostgreSQL connection pool
 * @param {string} conversationId - The conversation to summarize
 * @returns {Promise<void>}
 */
async function generateConversationSummary(pool, conversationId) {
  try {
    // Fetch all messages for this conversation
    const msgRes = await pool.query(
      `SELECT role, content FROM bot_messages
       WHERE conversation_id = $1
       ORDER BY sent_at ASC`,
      [conversationId]
    );

    if (msgRes.rows.length === 0) return;

    // Build messages array for the LLM
    const messages = msgRes.rows.map(m => ({
      role: m.role === 'maya' || m.role === 'admin' ? 'assistant' : 'user',
      content: m.content
    }));

    const systemPrompt =
      'Summarize this conversation in 2-3 sentences from Maya\'s perspective. ' +
      'What was discussed, what was the player\'s mood/interest level, ' +
      'what was left unresolved? Be concise and factual.';

    const summary = await generateResponse(systemPrompt, messages, 'claude-haiku-4-5');

    if (summary && typeof summary === 'string' && summary.trim().length > 0) {
      await pool.query(
        `UPDATE bot_conversations SET summary = $1 WHERE id = $2`,
        [summary.trim().slice(0, 2000), conversationId]
      );
    }
  } catch (err) {
    console.error('[persona-bot] Error generating conversation summary:', err.message || err);
  }
}

/**
 * Generates a structured bullet-point summary of a pre-raid briefing conversation.
 * Used to forward key information to the raidleader.
 *
 * @param {import('pg').Pool} pool - PostgreSQL connection pool
 * @param {string} conversationId - The conversation to summarize
 * @returns {Promise<string|null>} Bullet-point summary text, or null on failure
 */
async function generateRaidleaderSummary(pool, conversationId, playerCharacterName) {
  try {
    const msgRes = await pool.query(
      `SELECT role, content FROM bot_messages
       WHERE conversation_id = $1
       ORDER BY sent_at ASC`,
      [conversationId]
    );

    if (msgRes.rows.length === 0) return null;

    // Format conversation as plain text to avoid role-ordering issues with Anthropic API
    // (Maya's opening message would be 'assistant' first, which Claude rejects)
    const conversationText = msgRes.rows.map(m => {
      const speaker = (m.role === 'maya' || m.role === 'admin') ? 'Maya' : 'Player';
      return `${speaker}: ${m.content}`;
    }).join('\n');

    const playerContext = playerCharacterName
      ? `This conversation was with the player: ${playerCharacterName}. Do NOT confuse them with the raidleader or other names mentioned in the conversation.\n\n`
      : '';

    const systemPrompt =
      playerContext +
      'Summarize this pre-raid briefing conversation as bullet points for the raidleader. ' +
      'Output ONLY bullet points (lines starting with "- "). No prose, no greeting, no sign-off.\n\n' +
      'Include:\n' +
      '- Player character name and class (if mentioned)\n' +
      '- Naxxramas/tactics familiarity\n' +
      '- Discord availability (voice/text)\n' +
      '- Raid role (buyer with budget, or performance raider)\n' +
      '- Any class-specific notes (e.g. Priest PI, Mage decurse)\n' +
      '- Any special requests, concerns, or notable information\n' +
      '- Any mention of needing to leave early or schedule constraints\n\n' +
      'Do NOT include a line about whether it is their first raid — that is already known.\n' +
      'Keep it concise and factual. The raidleader needs quick, actionable info.';

    const userMessage = [{ role: 'user', content: `Here is the conversation to summarize:\n\n${conversationText}` }];
    const summary = await generateResponse(systemPrompt, userMessage, 'claude-haiku-4-5');

    if (summary && typeof summary === 'string' && summary.trim().length > 0) {
      return summary.trim();
    }
    return null;
  } catch (err) {
    console.error('[persona-bot] Error generating raidleader summary:', err.message || err);
    return null;
  }
}

/**
 * Generates an AI-powered opening message for a Maya conversation.
 * 
 * Uses the template's opening_message as instructions (not a literal message)
 * and combines them with player context data to generate a unique, personalized
 * opening DM via Claude. Falls back to variable-substituted template text if
 * the LLM call fails or returns empty.
 *
 * @param {import('pg').Pool} pool - PostgreSQL connection pool
 * @param {{ id: string, opening_message: string, model_override?: string }} template - Template row
 * @param {string} discordId - Player's Discord ID
 * @param {string|null} eventId - Associated event ID (for post-raid context)
 * @param {string} conversationId - The new conversation ID
 * @returns {Promise<{ generated: string|null, fallback: string, modelUsed: string }>}
 *   generated is the LLM text (null on failure), fallback is the variable-substituted template
 */
async function generateOpeningMessage(pool, template, discordId, eventId, conversationId) {
  const model = template.model_override || 'claude-haiku-4-5';

  // Step 1: Resolve template variables for the fallback path
  const templateVars = await resolveTemplateVariables(pool, discordId, eventId, conversationId);
  const resolvedName = await resolvePlayerName(pool, discordId, conversationId);
  if (resolvedName) {
    templateVars.set('player_name', resolvedName);
  }
  const fallback = sanitizeResponse(applyTemplateVariables(template.opening_message, templateVars));

  // Step 2: Build player context for LLM generation
  let generated = null;
  try {
    const playerContext = await buildPlayerContext(pool, discordId);

    // Apply variable substitution to opening instructions so LLM sees actual values
    const resolvedInstructions = applyTemplateVariables(template.opening_message, templateVars);

    const systemPrompt =
      'You are Maya, a friendly guild assistant for 1Principles (a Classic WoW GDKP guild). ' +
      'Generate an opening DM based on the instructions below. Keep it natural and conversational. ' +
      'Do not use em-dashes or en-dashes.\n\n' +
      '=== Opening Instructions ===\n' +
      resolvedInstructions + '\n\n' +
      '=== Player Data ===\n' +
      playerContext;

    const messages = [{ role: 'user', content: 'Generate the opening message now.' }];
    const rawResponse = await generateResponse(systemPrompt, messages, model);

    if (rawResponse && rawResponse.trim().length > 0) {
      generated = sanitizeForDiscord(sanitizeResponse(rawResponse));
    }
  } catch (err) {
    console.error('[persona-bot] LLM opening generation failed for', discordId, ':', err.message || err);
  }

  return { generated, fallback, modelUsed: model };
}

module.exports = { createPersonaBot, generateConversationSummary, generateRaidleaderSummary, generateOpeningMessage };
