import OpenAI from "openai";

let _client: OpenAI | null = null;

export function getOpenAIClient(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }
  if (!_client) {
    _client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      // Optional OpenAI-compatible endpoint (e.g. Groq) — unset = api.openai.com
      baseURL: process.env.OPENAI_BASE_URL || undefined,
      timeout: 120000,
      maxRetries: 2,
    });
  }
  return _client;
}

export function isApiKeyConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}
