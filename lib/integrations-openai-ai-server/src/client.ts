import OpenAI from "openai";

const baseURL = process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"];
const apiKey = process.env["AI_INTEGRATIONS_OPENAI_API_KEY"];

if (!baseURL || !apiKey) {
  throw new Error(
    "OpenAI AI integration is not configured. Provision AI_INTEGRATIONS_OPENAI_BASE_URL and AI_INTEGRATIONS_OPENAI_API_KEY.",
  );
}

export const openai = new OpenAI({ apiKey, baseURL });