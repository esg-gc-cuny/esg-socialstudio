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
          ? "Write a conversational newsletter teaser with a clear opening, a useful detail, and an invitation to read the full work."
          : platform === "bluesky" || platform === "x"
            ? "Write one concise, self-contained post that sounds like a thoughtful person sharing useful work. Stay within the character limit including hashtags."
            : platform === "linkedin"
              ? "Write a natural professional post. Lead with a specific insight, explain why it matters, and invite readers to the full article."
              : platform === "instagram"
                ? "Use a short, accessible caption with a strong first line and a clear next step."
                : "Write a warm, accessible post with a plain-language takeaway and a relevant invitation to read.";
      return `- ${name} (${platform}, maximum ${limit} characters): ${style}`;
    })
    .join("\n");

  return `You adapt research-group articles and primers into accurate public-facing promotional copy.

Editorial rules:
- Use only claims supported by the source. Never invent study results, statistics, quotes, authors, or implications.
- Preserve uncertainty, limitations, and non-causal language. Do not overstate evidence or promise outcomes.
- Keep the voice ${context.tone}. Write for ${context.audience || "an interested general audience"}.
- Campaign goal: ${context.campaignGoal || "raise awareness and invite readers to the full research resource"}.
- Sound like a real person sharing useful work, not an ad template. Avoid canned hooks, exaggerated claims, and repeated calls to action.
- Use plain language and platform-appropriate formatting.
- Add 2-4 specific hashtags that fit the article topic and the platform audience. Do not use generic tags such as #ResearchCommunication or #EvidenceInPractice. Do not repeat the same tags across platforms unless they genuinely fit each one.
- Put hashtags only in the hashtags array, not in the post content.
- Do not use em dashes, en dashes, or double hyphens in the post content. Use commas, periods, or colons instead.
- Do not use emojis.
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
    const excludedHashtags = new Set(["#researchcommunication", "#evidenceinpractice"]);
    const hashtags = Array.isArray(item.hashtags)
      ? item.hashtags
          .filter((tag): tag is string => typeof tag === "string")
          .map((tag) => {
            const normalized = tag.trim().startsWith("#")
              ? tag.trim()
              : `#${tag.trim().replace(/^#+/, "")}`;
            return normalized.replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\uFE0E\uFE0F\u200D\u20E3]/gu, "");
          })
          .filter((tag, index, all) => !excludedHashtags.has(tag.toLowerCase()) && all.indexOf(tag) === index)
          .slice(0, 4)
      : [];
    let content = item.content
      .trim()
      .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\uFE0E\uFE0F\u200D\u20E3]/gu, "")
      .replace(/\s*--+\s*/g, ", ")
      .replace(/\s*[\u2012-\u2015]\s*/g, ", ")
      .replace(/,\s*,+/g, ",")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/#ResearchCommunication\b|#EvidenceInPractice\b/gi, "")
      .trim();
    for (const tag of hashtags) {
      content = content.split(tag).join("").trim();
    }
    content = content.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+\n/g, "\n").trim();
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
