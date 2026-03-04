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
const { buildPlayerContext, buildVoiceContext } = require('./persona-context.cjs');

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
    // Get conversation details (for template instructions)
    const convRes = await pool.query(
      `SELECT template_id FROM bot_conversations WHERE id = $1`,
      [conversationId]
    );
    const conv = convRes.rows[0];

    // Start with persona system prompt
    let systemPrompt = persona.system_prompt;

    // Add template-specific instructions if applicable
    if (conv && conv.template_id) {
      const tplRes = await pool.query(
        `SELECT agent_instructions, model_override FROM bot_templates WHERE id = $1`,
        [conv.template_id]
      );
      if (tplRes.rows.length > 0 && tplRes.rows[0].agent_instructions) {
        systemPrompt += '\n\n=== Conversation-Specific Instructions ===\n' + tplRes.rows[0].agent_instructions;
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

    const discordId = message.author.id;
    const playerName = message.author.globalName || message.author.username || null;

    try {
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
        
        // Add a human-like delay (2-3 seconds)
        const delay = 2000 + Math.random() * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));

        const responseText = await generateResponse(systemPrompt, messages, model);

        if (responseText) {
          // Store and send the response
          await storeMessage(conversation.id, 'maya', responseText, model);

          // Send via Discord DM
          await message.channel.send(responseText);
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
      const user = await client.users.fetch(discordId);
      if (!user) return false;
      await user.send(content);
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

          // Create conversation
          const convId = crypto.randomUUID();
          await pool.query(
            `INSERT INTO bot_conversations (id, discord_id, player_name, status, started_by, template_id)
             VALUES ($1, $2, $3, 'active', 'template', $4)`,
            [convId, attendee.discord_id, attendee.player_name || null, template.id]
          );

          // Personalize opening message (replace {{player_name}} if present)
          let opening = template.opening_message;
          if (attendee.player_name) {
            opening = opening.replace(/\{\{player_name\}\}/g, attendee.player_name);
          }

          // Store and send the opening message
          const model = template.model_override || 'claude-haiku-4-5';
          await storeMessage(convId, 'maya', opening, null);
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

module.exports = { createPersonaBot };
