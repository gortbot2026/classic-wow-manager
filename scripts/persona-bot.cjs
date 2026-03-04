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

          // Store and send the response
          await storeMessage(conversation.id, 'maya', replyText, model);

          // Send via Discord DM
          await message.channel.send(replyText);

          // Fire-and-forget: extract notes from this exchange
          extractPlayerNotes(pool, io, discordId, conversation.id, message.content, replyText)
            .catch(err => console.error('[persona-bot] Note extraction failed (non-blocking):', err.message || err));
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
   */
  async function start() {
    client.once('ready', () => {
      ready = true;
      console.log(`[persona-bot] Maya ready as ${client.user?.tag || client.user?.id || 'persona-bot'}`);
    });

    client.on('messageCreate', handleDM);

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
    triggerTemplate
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

    const systemPrompt =
      'You are Maya, a friendly guild assistant for 1Principles (a Classic WoW GDKP guild). ' +
      'Generate an opening DM based on the instructions below. Keep it natural and conversational. ' +
      'Do not use em-dashes or en-dashes.\n\n' +
      '=== Opening Instructions ===\n' +
      template.opening_message + '\n\n' +
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

module.exports = { createPersonaBot, generateConversationSummary, generateOpeningMessage };
