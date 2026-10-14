import { anthropic } from "@workspace/integrations-anthropic-ai";
import { ai } from "@workspace/integrations-gemini-ai";
import { openai } from "@workspace/integrations-openai-ai-server";
import type { PlatformDraft } from "@workspace/db";

export type ProviderId = "openai" | "anthropic" | "gemini";
export type PlatformId =
  | "linkedin"
  | "facebook"
  | "bluesky"
  | "substack"
  | "x"
  | "instagram";

type GenerationContext = {
  title: string;
  content: string;
  sourceUrl: string | null;
  provider: ProviderId;
  platforms: PlatformId[];
  tone: string;
  audience?: string;
  campaignGoal?: string;
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

const characterLimits: Record<PlatformId, number> = {
  linkedin: 3000,
  facebook: 63206,
  bluesky: 300,
  substack: 50000,
  x: 280,
  instagram: 2200,
};

const platformNames: Record<PlatformId, string> = {
  linkedin: "LinkedIn",
  facebook: "Facebook",
  bluesky: "Bluesky",
  substack: "Substack",
  x: "X",
  instagram: "Instagram",
};

function buildPrompt(context: GenerationContext): string {
  const platformInstructions = context.platforms
    .map((platform) => {
      const name = platformNames[platform];
      const limit = characterLimits[platform];
      const style =
        platform === "substack"
          ? "Write a useful newsletter-style introduction with a clear subject-like opening and an invitation to read or discuss the full work."
          : platform === "bluesky" || platform === "x"
            ? "Write one concise, self-contained post. Stay within the character limit including hashtags."
            : platform === "linkedin"
              ? "Lead with a research insight, explain why it matters to practitioners or the public, and end with a grounded question or call to action."
              : platform === "instagram"
                ? "Use a short, accessible caption with a strong first line and a clear next step."
                : "Use a clear, accessible post with a plain-language research takeaway and a relevant next step.";
      return `- ${name} (${platform}, maximum ${limit} characters): ${style}`;
    })
    .join("\n");

  return `You adapt research-group articles and primers into accurate public-facing promotional copy.

Editorial rules:
- Use only claims supported by the source. Never invent study results, statistics, quotes, authors, or implications.
- Preserve uncertainty, limitations, and non-causal language. Do not overstate evidence or promise outcomes.
- Keep the voice ${context.tone}. Write for ${context.audience || "an interested general audience"}.
- Campaign goal: ${context.campaignGoal || "raise awareness and invite readers to the full research resource"}.
- Be engaging without sensationalism. Avoid jargon where plain language works.
- Add 2-5 relevant hashtags per platform, formatted as #Hashtag.
- Include the source URL in the copy when provided: ${context.sourceUrl || "No source URL provided"}.
- Keep each post specific to its platform and within its character limit after hashtags are included.
- Return only valid JSON in the shape {"drafts":[{"platform":"linkedin","content":"...","hashtags":["#Example"],"characterCount":0,"characterLimit":3000}]}.

Source title: ${context.title}

Source content:
${context.content}

Create one draft for each requested platform:
${platformInstructions}`;
}

function extractJson(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return JSON.parse(cleaned) as unknown;
}

function parseDrafts(
  rawText: string,
  requestedPlatforms: PlatformId[],
): PlatformDraft[] {
  const parsed = extractJson(rawText);
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    !("drafts" in parsed) ||
    !Array.isArray(parsed.drafts)
  ) {
    throw new Error("The selected AI provider returned an invalid draft response.");
  }

  const requested = new Set(requestedPlatforms);
  const byPlatform = new Map<string, Record<string, unknown>>();
  for (const item of parsed.drafts) {
    if (item && typeof item === "object" && "platform" in item) {
      byPlatform.set(String(item.platform), item as Record<string, unknown>);
    }
  }

  return requestedPlatforms.map((platform) => {
    const item = byPlatform.get(platform);
    if (!item || typeof item.content !== "string" || !requested.has(platform)) {
      throw new Error(`The selected AI provider did not return a valid ${platformNames[platform]} draft.`);
    }
    const hashtags = Array.isArray(item.hashtags)
      ? item.hashtags
          .filter((tag): tag is string => typeof tag === "string")
          .map((tag) => (tag.startsWith("#") ? tag : `#${tag.replace(/^#+/, "")}`))
          .slice(0, 5)
      : [];
    let content = item.content.trim();
    for (const tag of hashtags) {
      content = content.split(tag).join("").trim();
    }
    content = content.replace(/\s{2,}/g, " ").trim();
    const characterCount =
      content.length + (hashtags.length ? hashtags.join(" ").length + 1 : 0);
    return {
      platform,
      content,
      hashtags,
      characterCount,
      characterLimit: characterLimits[platform],
    };
  });
}

export async function generatePlatformDrafts(
  context: GenerationContext,
): Promise<GenerationResult> {
  const prompt = buildPrompt(context);
  const model = modelByProvider[context.provider];
  let rawText = "";
  let inputTokens = Math.ceil(prompt.length / 4);
  let outputTokens = 0;

  if (context.provider === "openai") {
    const response = await openai.chat.completions.create({
      model,
      max_completion_tokens: 8192,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    });
    rawText = response.choices[0]?.message?.content ?? "";
    inputTokens = response.usage?.prompt_tokens ?? inputTokens;
    outputTokens = response.usage?.completion_tokens ?? Math.ceil(rawText.length / 4);
  } else if (context.provider === "anthropic") {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    });
    rawText = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
    inputTokens = response.usage.input_tokens ?? inputTokens;
    outputTokens = response.usage.output_tokens ?? Math.ceil(rawText.length / 4);
  } else {
    const response = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        maxOutputTokens: 8192,
        responseMimeType: "application/json",
      },
    });
    rawText = response.text ?? "";
    inputTokens = response.usageMetadata?.promptTokenCount ?? inputTokens;
    outputTokens =
      response.usageMetadata?.candidatesTokenCount ?? Math.ceil(rawText.length / 4);
  }

  if (!rawText) {
    throw new Error("The selected AI provider returned an empty response.");
  }

  return {
    model,
    drafts: parseDrafts(rawText, context.platforms),
    inputTokens,
    outputTokens,
  };
}
