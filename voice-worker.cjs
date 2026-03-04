/**
 * Voice Worker — Phase 2: Discord Voice Transcription
 * 
 * Runs as a separate Heroku dyno (worker). Connects to a Discord voice
 * channel, captures per-speaker Opus audio, detects silence, transcribes
 * via OpenAI Whisper API, and stores transcripts in raid_voice_transcripts.
 * 
 * Environment variables required:
 *   PERSONA_BOT_TOKEN — Discord bot token (same as persona bot)
 *   DATABASE_URL — PostgreSQL connection string
 *   OPENAI_API_KEY — OpenAI API key for Whisper
 *   VOICE_CHANNEL_ID — Discord voice channel ID to monitor
 * 
 * Usage: node voice-worker.cjs
 * Procfile: worker: node voice-worker.cjs
 * 
 * Dependencies (Phase 2):
 *   @discordjs/voice, @discordjs/opus or opusscript, openai, prism-media,
 *   sodium-native or tweetnacl
 * 
 * NOTE: This file is a scaffold for Phase 2. The full implementation
 * requires installing voice dependencies which are not included in Phase 1.
 * The database table (raid_voice_transcripts) is created in Phase 1 migrations.
 * 
 * @module voice-worker
 */

const { Client, GatewayIntentBits } = require('discord.js');
const { Pool } = require('pg');

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('amazonaws.com')
    ? { rejectUnauthorized: false }
    : false
});

const VOICE_CHANNEL_ID = process.env.VOICE_CHANNEL_ID;
const BOT_TOKEN = process.env.PERSONA_BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error('[voice-worker] PERSONA_BOT_TOKEN is required');
  process.exit(1);
}

if (!VOICE_CHANNEL_ID) {
  console.error('[voice-worker] VOICE_CHANNEL_ID is required');
  process.exit(1);
}

/**
 * Stores a voice transcript in the database.
 * @param {string} eventId - Associated raid event ID (if known)
 * @param {string} speakerDiscordId - Speaker's Discord user ID
 * @param {string} speakerName - Speaker's display name
 * @param {string} transcriptText - Transcribed text from Whisper
 */
async function storeTranscript(eventId, speakerDiscordId, speakerName, transcriptText) {
  try {
    await pool.query(
      `INSERT INTO raid_voice_transcripts (event_id, speaker_discord_id, speaker_name, transcript_text)
       VALUES ($1, $2, $3, $4)`,
      [eventId || null, speakerDiscordId, speakerName, transcriptText]
    );
    console.log(`[voice-worker] Stored transcript from ${speakerName}: "${transcriptText.substring(0, 50)}..."`);
  } catch (err) {
    console.error('[voice-worker] Failed to store transcript:', err.message || err);
  }
}

async function main() {
  console.log('[voice-worker] Starting voice transcription worker...');
  console.log('[voice-worker] Target voice channel:', VOICE_CHANNEL_ID);

  // Phase 2 implementation:
  // 1. Create Discord client with voice intents
  // 2. Join the specified voice channel using @discordjs/voice
  // 3. Subscribe to audio streams per speaker
  // 4. Buffer Opus frames per speaker
  // 5. On silence detection (1.5-2s gap), decode and send to Whisper
  // 6. Store transcript via storeTranscript()

  try {
    // Check if voice dependencies are available
    require('@discordjs/voice');
    console.log('[voice-worker] @discordjs/voice loaded');
  } catch (err) {
    console.error('[voice-worker] @discordjs/voice not installed. Install Phase 2 dependencies:');
    console.error('  npm install @discordjs/voice @discordjs/opus openai prism-media sodium-native');
    console.error('[voice-worker] Exiting — voice worker requires Phase 2 dependencies.');
    process.exit(1);
  }

  // Full implementation would go here after Phase 2 deps are installed
  // For now, create the Discord client and verify connectivity
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildVoiceStates
    ]
  });

  client.once('ready', () => {
    console.log(`[voice-worker] Bot ready as ${client.user?.tag}`);
    console.log('[voice-worker] Voice worker scaffold running. Install Phase 2 deps for full functionality.');
  });

  await client.login(BOT_TOKEN);
}

main().catch(err => {
  console.error('[voice-worker] Fatal error:', err);
  process.exit(1);
});
