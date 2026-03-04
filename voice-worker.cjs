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
 * @module voice-worker
 */

const { Client, GatewayIntentBits } = require('discord.js');
const { Pool } = require('pg');

// ─── Environment Validation ─────────────────────────────────────────────

const BOT_TOKEN = process.env.PERSONA_BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const VOICE_CHANNEL_ID = process.env.VOICE_CHANNEL_ID;

if (!BOT_TOKEN) {
  console.error('[voice-worker] PERSONA_BOT_TOKEN is required');
  process.exit(1);
}

if (!VOICE_CHANNEL_ID) {
  console.error('[voice-worker] VOICE_CHANNEL_ID is required');
  process.exit(1);
}

if (!OPENAI_API_KEY) {
  console.error('[voice-worker] OPENAI_API_KEY is required for Whisper transcription');
  process.exit(1);
}

// ─── Database Connection ────────────────────────────────────────────────

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('amazonaws.com')
    ? { rejectUnauthorized: false }
    : false
});

// ─── Constants ──────────────────────────────────────────────────────────

/** Silence threshold in milliseconds — flush buffer after this much silence */
const SILENCE_THRESHOLD_MS = 1800;

/** Minimum audio duration in ms before sending to Whisper (avoid noise fragments) */
const MIN_AUDIO_DURATION_MS = 500;

/** Maximum buffer duration per speaker in ms before forced flush */
const MAX_BUFFER_DURATION_MS = 30000;

/** PCM sample rate after Opus decode (Discord sends 48kHz stereo) */
const SAMPLE_RATE = 48000;

/** Channels in decoded PCM (Discord audio is stereo) */
const CHANNELS = 2;

/** Bytes per sample (16-bit PCM) */
const BYTES_PER_SAMPLE = 2;

// ─── Per-Speaker Audio Buffer ───────────────────────────────────────────

/**
 * @typedef {Object} SpeakerBuffer
 * @property {Buffer[]} chunks - Raw PCM audio chunks
 * @property {number} totalBytes - Total bytes in buffer
 * @property {number} firstChunkTime - Timestamp of first chunk
 * @property {number} lastChunkTime - Timestamp of most recent chunk
 * @property {NodeJS.Timeout|null} silenceTimer - Timer for silence detection
 * @property {string} displayName - Speaker's display name
 */

/** @type {Map<string, SpeakerBuffer>} Map of Discord user ID to their audio buffer */
const speakerBuffers = new Map();

/**
 * Gets or creates a speaker buffer.
 * @param {string} userId - Discord user ID
 * @param {string} displayName - Speaker's display name
 * @returns {SpeakerBuffer}
 */
function getOrCreateBuffer(userId, displayName) {
  if (!speakerBuffers.has(userId)) {
    speakerBuffers.set(userId, {
      chunks: [],
      totalBytes: 0,
      firstChunkTime: Date.now(),
      lastChunkTime: Date.now(),
      silenceTimer: null,
      displayName
    });
  }
  return speakerBuffers.get(userId);
}

/**
 * Resets a speaker's buffer after transcription.
 * @param {string} userId - Discord user ID
 */
function resetBuffer(userId) {
  const buf = speakerBuffers.get(userId);
  if (buf) {
    if (buf.silenceTimer) clearTimeout(buf.silenceTimer);
    buf.chunks = [];
    buf.totalBytes = 0;
    buf.firstChunkTime = Date.now();
    buf.lastChunkTime = Date.now();
    buf.silenceTimer = null;
  }
}

// ─── Whisper Transcription ──────────────────────────────────────────────

/**
 * Converts raw PCM buffer to WAV format for Whisper API.
 * @param {Buffer} pcmBuffer - Raw 16-bit PCM audio data
 * @param {number} sampleRate - Sample rate (48000)
 * @param {number} numChannels - Number of channels (2)
 * @returns {Buffer} WAV file buffer
 */
function pcmToWav(pcmBuffer, sampleRate, numChannels) {
  const byteRate = sampleRate * numChannels * BYTES_PER_SAMPLE;
  const blockAlign = numChannels * BYTES_PER_SAMPLE;
  const dataSize = pcmBuffer.length;
  const headerSize = 44;
  const wavBuffer = Buffer.alloc(headerSize + dataSize);

  // RIFF header
  wavBuffer.write('RIFF', 0);
  wavBuffer.writeUInt32LE(36 + dataSize, 4);
  wavBuffer.write('WAVE', 8);

  // fmt sub-chunk
  wavBuffer.write('fmt ', 12);
  wavBuffer.writeUInt32LE(16, 16); // sub-chunk size
  wavBuffer.writeUInt16LE(1, 20);  // PCM format
  wavBuffer.writeUInt16LE(numChannels, 22);
  wavBuffer.writeUInt32LE(sampleRate, 24);
  wavBuffer.writeUInt32LE(byteRate, 28);
  wavBuffer.writeUInt16LE(blockAlign, 32);
  wavBuffer.writeUInt16LE(16, 34); // bits per sample

  // data sub-chunk
  wavBuffer.write('data', 36);
  wavBuffer.writeUInt32LE(dataSize, 40);
  pcmBuffer.copy(wavBuffer, headerSize);

  return wavBuffer;
}

/**
 * Sends audio to OpenAI Whisper API for transcription.
 * Uses the REST API directly to avoid heavy SDK dependency overhead.
 * 
 * @param {Buffer} wavBuffer - WAV audio data
 * @returns {Promise<string|null>} Transcribed text or null on failure
 */
async function transcribeAudio(wavBuffer) {
  try {
    const { default: OpenAI } = await import('openai');
    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

    // Create a File-like object from buffer for the SDK
    const file = new File([wavBuffer], 'audio.wav', { type: 'audio/wav' });

    const transcription = await openai.audio.transcriptions.create({
      file,
      model: 'whisper-1',
      language: 'en',
      response_format: 'text'
    });

    const text = typeof transcription === 'string' ? transcription.trim() : (transcription.text || '').trim();
    if (!text || text.length < 2) return null; // Ignore empty/noise transcripts
    return text;
  } catch (err) {
    console.error('[voice-worker] Whisper transcription error:', err.message || err);
    return null;
  }
}

// ─── Database Storage ───────────────────────────────────────────────────

/** Current event ID — set externally or null */
let currentEventId = null;

/**
 * Stores a voice transcript in the database.
 * @param {string|null} eventId - Associated raid event ID (if known)
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
    console.log(`[voice-worker] Stored transcript from ${speakerName}: "${transcriptText.substring(0, 80)}${transcriptText.length > 80 ? '...' : ''}"`);
  } catch (err) {
    console.error('[voice-worker] Failed to store transcript:', err.message || err);
  }
}

// ─── Audio Processing Pipeline ──────────────────────────────────────────

/**
 * Flushes a speaker's audio buffer: concatenates PCM chunks,
 * converts to WAV, sends to Whisper, stores transcript.
 * 
 * @param {string} userId - Discord user ID
 */
async function flushSpeakerBuffer(userId) {
  const buf = speakerBuffers.get(userId);
  if (!buf || buf.chunks.length === 0) return;

  const durationMs = buf.lastChunkTime - buf.firstChunkTime;
  if (durationMs < MIN_AUDIO_DURATION_MS) {
    // Too short — likely noise, discard
    resetBuffer(userId);
    return;
  }

  // Concatenate all PCM chunks
  const pcmData = Buffer.concat(buf.chunks);
  const displayName = buf.displayName;
  resetBuffer(userId);

  // Convert to WAV and transcribe
  const wavData = pcmToWav(pcmData, SAMPLE_RATE, CHANNELS);
  const transcript = await transcribeAudio(wavData);

  if (transcript) {
    await storeTranscript(currentEventId, userId, displayName, transcript);
  }
}

/**
 * Handles incoming audio data for a speaker.
 * Buffers PCM data, resets silence timer, flushes on silence or max duration.
 * 
 * @param {string} userId - Discord user ID
 * @param {string} displayName - Speaker's display name
 * @param {Buffer} pcmChunk - Decoded PCM audio data
 */
function handleAudioChunk(userId, displayName, pcmChunk) {
  const buf = getOrCreateBuffer(userId, displayName);
  buf.chunks.push(pcmChunk);
  buf.totalBytes += pcmChunk.length;
  buf.lastChunkTime = Date.now();

  // Reset silence detection timer
  if (buf.silenceTimer) clearTimeout(buf.silenceTimer);
  buf.silenceTimer = setTimeout(() => {
    flushSpeakerBuffer(userId);
  }, SILENCE_THRESHOLD_MS);

  // Force flush if buffer exceeds max duration
  const duration = buf.lastChunkTime - buf.firstChunkTime;
  if (duration >= MAX_BUFFER_DURATION_MS) {
    if (buf.silenceTimer) clearTimeout(buf.silenceTimer);
    flushSpeakerBuffer(userId);
  }
}

// ─── Main Entry Point ───────────────────────────────────────────────────

async function main() {
  console.log('[voice-worker] Starting voice transcription worker...');
  console.log('[voice-worker] Target voice channel:', VOICE_CHANNEL_ID);

  // Load voice dependencies
  let joinVoiceChannel, VoiceConnectionStatus, entersState, EndBehaviorType;
  try {
    const voice = require('@discordjs/voice');
    joinVoiceChannel = voice.joinVoiceChannel;
    VoiceConnectionStatus = voice.VoiceConnectionStatus;
    entersState = voice.entersState;
    EndBehaviorType = voice.EndBehaviorType;
    console.log('[voice-worker] @discordjs/voice loaded successfully');
  } catch (err) {
    console.error('[voice-worker] @discordjs/voice not installed. Install Phase 2 dependencies:');
    console.error('  npm install @discordjs/voice opusscript prism-media tweetnacl openai');
    process.exit(1);
  }

  // Load Opus decoder
  let prism;
  try {
    prism = require('prism-media');
    console.log('[voice-worker] prism-media loaded');
  } catch (err) {
    console.error('[voice-worker] prism-media not installed');
    process.exit(1);
  }

  // Verify database connection
  try {
    await pool.query('SELECT 1');
    console.log('[voice-worker] Database connected');
  } catch (err) {
    console.error('[voice-worker] Database connection failed:', err.message);
    process.exit(1);
  }

  // Create Discord client with voice intents
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildVoiceStates
    ]
  });

  client.once('ready', async () => {
    console.log(`[voice-worker] Bot ready as ${client.user?.tag}`);

    // Find the voice channel
    const channel = await client.channels.fetch(VOICE_CHANNEL_ID).catch(() => null);
    if (!channel) {
      console.error(`[voice-worker] Could not find voice channel ${VOICE_CHANNEL_ID}`);
      process.exit(1);
    }

    if (!channel.isVoiceBased()) {
      console.error(`[voice-worker] Channel ${VOICE_CHANNEL_ID} is not a voice channel`);
      process.exit(1);
    }

    console.log(`[voice-worker] Joining voice channel: ${channel.name} (${channel.guild.name})`);

    // Join the voice channel
    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: false,  // Must not be deafened to receive audio
      selfMute: true     // Muted — we only listen
    });

    // Wait for connection to be ready
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
      console.log('[voice-worker] Voice connection established');
    } catch (err) {
      console.error('[voice-worker] Failed to connect to voice channel:', err.message);
      connection.destroy();
      process.exit(1);
    }

    // Handle connection state changes
    connection.on('stateChange', (oldState, newState) => {
      console.log(`[voice-worker] Connection state: ${oldState.status} → ${newState.status}`);
    });

    // Subscribe to the receiver for incoming audio
    const receiver = connection.receiver;

    receiver.speaking.on('start', (userId) => {
      console.log(`[voice-worker] User ${userId} started speaking`);

      // Create an audio stream for this speaker
      const audioStream = receiver.subscribe(userId, {
        end: {
          behavior: EndBehaviorType.AfterSilence,
          duration: SILENCE_THRESHOLD_MS
        }
      });

      // Decode Opus to PCM using prism-media
      const opusDecoder = new prism.opus.Decoder({
        rate: SAMPLE_RATE,
        channels: CHANNELS,
        frameSize: 960
      });

      // Resolve the speaker's display name
      const member = channel.guild.members.cache.get(userId);
      const displayName = member?.displayName || member?.user?.username || `User-${userId.slice(-4)}`;

      // Pipe audio through Opus decoder and handle PCM output
      const pcmStream = audioStream.pipe(opusDecoder);

      pcmStream.on('data', (chunk) => {
        handleAudioChunk(userId, displayName, chunk);
      });

      pcmStream.on('error', (err) => {
        console.error(`[voice-worker] PCM stream error for ${displayName}:`, err.message);
      });

      pcmStream.on('end', () => {
        // Stream ended — silence detection will handle flushing via the timer
      });
    });

    // Periodically log status
    setInterval(() => {
      const activeBuffers = [...speakerBuffers.entries()].filter(([, b]) => b.chunks.length > 0);
      if (activeBuffers.length > 0) {
        console.log(`[voice-worker] Active buffers: ${activeBuffers.map(([id, b]) => `${b.displayName}(${b.chunks.length} chunks)`).join(', ')}`);
      }
    }, 60_000);

    console.log('[voice-worker] Listening for voice audio. Transcripts will be stored in raid_voice_transcripts.');
  });

  // Handle graceful shutdown
  const shutdown = () => {
    console.log('[voice-worker] Shutting down...');
    // Flush any remaining buffers
    const flushPromises = [...speakerBuffers.keys()].map(userId => flushSpeakerBuffer(userId));
    Promise.allSettled(flushPromises).then(() => {
      pool.end();
      client.destroy();
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await client.login(BOT_TOKEN);
}

main().catch(err => {
  console.error('[voice-worker] Fatal error:', err);
  process.exit(1);
});
