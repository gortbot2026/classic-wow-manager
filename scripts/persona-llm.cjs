/**
 * Persona LLM Module
 * 
 * Anthropic Claude API wrapper for Maya's AI-generated responses.
 * Handles API initialization, request formatting, error handling,
 * and rate limit management.
 * 
 * @module persona-llm
 */

const Anthropic = require('@anthropic-ai/sdk');

/** @type {Anthropic|null} */
let client = null;

/**
 * Initializes the Anthropic client. Safe to call multiple times;
 * only creates a client on first invocation (or if API key changes).
 * 
 * @returns {Anthropic} The initialized Anthropic client
 * @throws {Error} If ANTHROPIC_API_KEY is not set
 */
function getClient() {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('[persona-llm] ANTHROPIC_API_KEY environment variable is not set');
    }
    client = new Anthropic.default({ apiKey });
  }
  return client;
}

/**
 * Generates an AI response using Anthropic's Messages API.
 * 
 * @param {string} systemPrompt - The system prompt defining Maya's persona
 * @param {Array<{role: string, content: string}>} messages - Conversation history 
 *   formatted as Anthropic message objects (role: 'user' | 'assistant')
 * @param {string} [model='claude-haiku-4-5'] - The Anthropic model to use
 * @returns {Promise<string>} The assistant's response text
 * @throws {Error} On API errors (rate limit, timeout, auth failure)
 */
async function generateResponse(systemPrompt, messages, model) {
  const anthropic = getClient();
  const modelId = model || 'claude-haiku-4-5';

  try {
    const response = await anthropic.messages.create({
      model: modelId,
      max_tokens: 1024,
      system: systemPrompt,
      messages: messages
    });

    // Extract text from the response content blocks
    if (response.content && response.content.length > 0) {
      const textBlock = response.content.find(block => block.type === 'text');
      if (textBlock) {
        return textBlock.text;
      }
    }

    console.warn('[persona-llm] No text content in API response');
    return '';
  } catch (err) {
    // Handle specific Anthropic error types
    if (err && err.status === 429) {
      console.error('[persona-llm] Rate limited by Anthropic API. Retrying after delay...');
      // Wait 5 seconds and retry once
      await new Promise(resolve => setTimeout(resolve, 5000));
      try {
        const retryResponse = await anthropic.messages.create({
          model: modelId,
          max_tokens: 1024,
          system: systemPrompt,
          messages: messages
        });
        if (retryResponse.content && retryResponse.content.length > 0) {
          const textBlock = retryResponse.content.find(block => block.type === 'text');
          if (textBlock) return textBlock.text;
        }
        return '';
      } catch (retryErr) {
        console.error('[persona-llm] Retry also failed:', retryErr.message || retryErr);
        throw retryErr;
      }
    }

    if (err && err.status === 401) {
      console.error('[persona-llm] Authentication failed — check ANTHROPIC_API_KEY');
    } else if (err && err.status === 400) {
      console.error('[persona-llm] Bad request:', err.message || err);
    } else {
      console.error('[persona-llm] API error:', err.message || err);
    }
    throw err;
  }
}

module.exports = { generateResponse };
