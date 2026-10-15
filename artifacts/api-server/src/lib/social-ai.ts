import Anthropic from "@anthropic-ai/sdk";
import { ai } from "@workspace/integrations-gemini-ai";
import { openai } from "@workspace/integrations-openai-ai-server";
import type { PlatformDraft } from "@workspace/db";
import type { SocialPlatform, EditorialSource } from "../config/platform-editorial-prompts";
import {
  generateIndependentPosts,
  type EditorialModelResponse,
} from "./platform-post-generation";

export type ProviderId = "openai" | "anthropic" | "gemini";
export type PlatformId = SocialPlatform;

type GenerationContext = EditorialSource & {
  provider: ProviderId;
  platforms: PlatformId[];
};

type GenerationResult = {
  model: string;
  drafts: PlatformDraft[];
  inputTokens: number;
  outputTokens: number;
};

const modelByProvider: Record<ProviderId, string> = {
  openai: "gpt-6-luna",
  anthropic: "claude-haiku-5-5",
  gemini: "gemini-3.8-flash",
};

function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Anthropic API key is missing. Add ANTHROPIC_API_KEY in Replit Secrets.");
  }
  return new Anthropic({ apiKey });
}

async function requestModelText(
  prompt: string,
  provider: ProviderId,
  model: string,
  anthropicClient?: Anthropic,
): Promise<EditorialModelResponse> {
  const estimatedInputTokens = Math.ceil(prompt.length / 4);
  if (provider === "openai") {
    const response = await openai.chat.completions.create({
      model,
      max_completion_tokens: 4096,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    });
    const text = response.choices[0]?.message?.content ?? "";
    return {
      text,
      inputTokens: response.usage?.prompt_tokens ?? estimatedInputTokens,
      outputTokens: response.usage?.completion_tokens ?? Math.ceil(text.length / 4),
    };
  }
  if (provider === "anthropic") {
    const response = await (anthropicClient ?? getAnthropicClient()).messages.create({
      model,
      max_tokens: 4096,
      thinking: { type: "disabled" },
      messages: [{ role: "user", content: prompt }],
    });
    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
    return {
      text,
      inputTokens: response.usage.input_tokens ?? estimatedInputTokens,
      outputTokens: response.usage.output_tokens ?? Math.ceil(text.length / 4),
    };
  }
  const response = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: { maxOutputTokens: 4096, responseMimeType: "application/json" },
  });
  const text = response.text ?? "";
  return {
    text,
    inputTokens: response.usageMetadata?.promptTokenCount ?? estimatedInputTokens,
    outputTokens: response.usageMetadata?.candidatesTokenCount ?? Math.ceil(text.length / 4),
  };
}

export async function generatePlatformDrafts(
  context: GenerationContext,
): Promise<GenerationResult> {
  const model = modelByProvider[context.provider];
  const anthropicClient = context.provider === "anthropic" ? getAnthropicClient() : undefined;
  const result = await generateIndependentPosts(context, (prompt) =>
    requestModelText(prompt, context.provider, model, anthropicClient),
  );
  return { model, ...result };
}
