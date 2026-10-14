import Anthropic from "@anthropic-ai/sdk";
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

const forbiddenPerspectivePattern =
  /\b(?:i|me|my|mine|myself|we|us|our|ours|ourselves|you|your|yours|yourself|yourselves)\b|\b(?:i|we|you)[’'](?:m|ve|ll|d|re)\b/i;

function containsNonThirdPersonText(text: string): boolean {
  return forbiddenPerspectivePattern.test(text.replace(/https?:\/\/\S+/gi, ""));
}

function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Anthropic API key is missing. Add ANTHROPIC_API_KEY in Replit Secrets.");
  }
  return new Anthropic({ apiKey });
}

function hasNonThirdPersonDraft(drafts: PlatformDraft[]): boolean {
  return drafts.some((draft) => containsNonThirdPersonText(draft.content));
}

function removeNonThirdPersonSentences(content: string): string {
  return content
    .split(/(?<=[.!?])\s+|[\r\n]+/u)
    .filter((sentence) => !containsNonThirdPersonText(sentence))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function enforceThirdPerson(
  drafts: PlatformDraft[],
  context: GenerationContext,
): PlatformDraft[] {
  const safeInvitation =
    "The Economic Studies Group welcomes discussion of these findings.";

  return drafts.map((draft) => {
    let content = removeNonThirdPersonSentences(draft.content);
    if (!content) {
      content = "The Economic Studies Group shares new research.";
    }
    if (context.sourceUrl && !content.includes(context.sourceUrl)) {
      content += `\n\nThe full article is available at ${context.sourceUrl}`;
    }
    if (!/\b(?:read|discussion|discuss|conversation|comments?|respond|response)\b/i.test(content)) {
      content += `\n\n${safeInvitation}`;
    }

    const hashtagLength = draft.hashtags.length
      ? draft.hashtags.join(" ").length + 1
      : 0;
    const contentLimit = Math.max(0, draft.characterLimit - hashtagLength);
    if (content.length > contentLimit) {
      const linkLine = context.sourceUrl
        ? `Full article: ${context.sourceUrl}`
        : "";
      const invitation = "The Group welcomes discussion.";
      const suffix = [linkLine, invitation].filter(Boolean).join("\n\n");
      const safeBody = context.sourceUrl
        ? content.replace(context.sourceUrl, "").trim()
        : content;
      const bodyLimit = Math.max(0, contentLimit - suffix.length - 2);
      const body = safeBody
        .slice(0, bodyLimit)
        .replace(/\s+\S*$/, "")
        .trim();
      content = [body, suffix].filter(Boolean).join("\n\n");
    }

    return {
      ...draft,
      content,
      characterCount:
        content.length +
        (draft.hashtags.length ? draft.hashtags.join(" ").length + 1 : 0),
    };
  });
}

const shortPostTargets: Record<PlatformId, number> = {
  linkedin: 450,
  facebook: 300,
  bluesky: 260,
  substack: 450,
  x: 260,
  instagram: 300,
};

const platformInvitations: Record<PlatformId, string> = {
  linkedin: "The Group welcomes discussion.",
  facebook: "The Group welcomes comments.",
  bluesky: "The Group welcomes discussion.",
  substack: "The Group welcomes reader responses.",
  x: "The Group welcomes discussion.",
  instagram: "The Group welcomes comments.",
};

function truncateAtWord(text: string, maxLength: number): string {
  if (maxLength <= 0) return "";
  if (text.length <= maxLength) return text;
  if (maxLength <= 3) return text.slice(0, maxLength);
  return `${text
    .slice(0, maxLength - 1)
    .replace(/\s+\S*$/, "")
    .trim()}…`;
}

function makeBriefTeasers(
  drafts: PlatformDraft[],
  context: GenerationContext,
): PlatformDraft[] {
  return drafts.map((draft) => {
    const platform = draft.platform as PlatformId;
    const maxSentences =
      platform === "linkedin" || platform === "substack" ? 2 : 1;
    const hook = removeNonThirdPersonSentences(draft.content)
      .split(/(?<=[.!?])\s+|[\r\n]+/u)
      .filter(Boolean)
      .filter((sentence) => !/\b(?:read|discussion|discuss|conversation|comments?|respond|response)\b/i.test(sentence))
      .filter((sentence) => !context.sourceUrl || !sentence.includes(context.sourceUrl))
      .slice(0, maxSentences)
      .join(" ");
    const hashtagsLength = draft.hashtags.length
      ? draft.hashtags.join(" ").length + 1
      : 0;
    const contentLimit = Math.max(
      0,
      shortPostTargets[platform] - hashtagsLength,
    );
    const linkLine = context.sourceUrl
      ? `Full article: ${context.sourceUrl}`
      : "";
    const invitation = platformInvitations[platform];
    const fixedLines = [linkLine, invitation].filter(Boolean);
    const fixedLength =
      fixedLines.join("\n\n").length +
      (fixedLines.length && hook ? 2 : 0);
    const body = truncateAtWord(
      hook || "The Economic Studies Group explores a timely economic question.",
      Math.max(0, contentLimit - fixedLength),
    );
    const content = [body, ...fixedLines].filter(Boolean).join("\n\n");

    return {
      ...draft,
      content,
      characterCount:
        content.length +
        (draft.hashtags.length ? draft.hashtags.join(" ").length + 1 : 0),
    };
  });
}

function buildPrompt(context: GenerationContext): string {
  const platformInstructions = context.platforms
    .map((platform) => {
      const name = platformNames[platform];
      const limit = characterLimits[platform];
      const style =
        platform === "substack"
          ? "Write a short newsletter teaser of 2-3 sentences, about 200-450 characters including hashtags when possible. Use one hook, at most one supporting detail, the article link, and a brief invitation in the Group's publisher voice. Do not summarize the whole article."
          : platform === "bluesky" || platform === "x"
            ? "Write one very concise post, about 170-260 characters including hashtags and link when possible. Use one hook, the article link, and a brief third-person invitation. Do not summarize the whole article."
            : platform === "linkedin"
              ? "Write a natural, short professional teaser of 2-3 sentences, about 200-450 characters including hashtags when possible. Use one specific hook, one reason it matters, the article link, and a brief subject-focused question or third-person invitation from the Group. Do not summarize the whole article."
              : platform === "facebook"
                ? "Write an approachable teaser of 1-2 short sentences, about 150-300 characters including hashtags when possible. Use one hook, the article link, and a short topic-focused question or third-person invitation from the Group. Do not summarize the whole article."
              : platform === "instagram"
                ? "Use a short, accessible caption with a strong first line and a clear next step."
                : "Write a warm, accessible post with a plain-language takeaway, the article link, and a relevant invitation to discuss.";
      return `- ${name} (${platform}, maximum ${limit} characters): ${style}`;
    })
    .join("\n");

  return `You are the Economic Studies Group's social media manager. Adapt the Group's published research articles and primers into accurate public-facing posts that encourage followers to read and discuss the original work.

Editorial rules:
- Use only claims supported by the source. Never invent study results, statistics, quotes, authors, or implications.
- Preserve uncertainty, limitations, and non-causal language when needed to avoid misleading readers. Do not overstate evidence or promise outcomes.
- Write a short promotional teaser, not an article summary or abstract. Use one attention-grabbing hook and at most one supporting detail. Omit methods, extra findings, and background that the full article can explain.
- Write from the Economic Studies Group's publisher perspective, but use third person only. Refer to it as "the Economic Studies Group" or "the Group" when attribution is useful. Do not sound like a detached outside observer.
- Never use first-person or second-person pronouns or contractions. Do not use I, me, my, mine, myself, we, us, our, ours, ourselves, you, your, yours, yourself, or yourselves. Do not quote first-person source language. Rephrase it in third person.
- Invite readers to open the original article and engage with its topic. Use a platform-appropriate, third-person invitation in the Group's publisher voice, such as "The full article is available at [URL]" and "The Group welcomes discussion of [topic]." Questions must focus on the issue, never address the reader.
- Keep the voice ${context.tone}. Write for ${context.audience || "an interested general audience"}.
- Campaign goal: ${context.campaignGoal || "raise awareness and invite readers to the full research resource"}.
- Sound like a human social media manager promoting work published by the Group, not an ad template or a detached summary. Lead with a specific, accurate reason to care, then invite readers to the source and a brief discussion. Avoid canned hooks, exaggerated claims, detailed summaries, and repeated calls to action.
- Use plain language and platform-appropriate formatting.
- Add 2-4 specific hashtags that fit the article topic and the platform audience. Do not use generic tags such as #ResearchCommunication or #EvidenceInPractice. Do not repeat the same tags across platforms unless they genuinely fit each one.
- Put hashtags only in the hashtags array, not in the post content.
- Do not use em dashes, en dashes, or double hyphens in the post content. Use commas, periods, or colons instead.
- Do not use emojis.
- Include the source URL in the copy when provided: ${context.sourceUrl || "No source URL provided"}.
- Keep each post specific to its platform and within its character limit after hashtags are included.
- Keep posts brief enough to make readers curious, not fully informed. The article should contain the detail and analysis.
- Before returning, check every post for first-person and second-person wording. Rewrite any violation in third person. Do not use direct-address questions or imperatives.
- Return only valid JSON in the shape {"drafts":[{"platform":"linkedin","content":"...","hashtags":["#Example"],"characterCount":0,"characterLimit":3000}]}.

Source title: ${context.title}

Source content:
${context.content}

Create one draft for each requested platform:
${platformInstructions}`;
}

function buildPerspectiveCorrectionPrompt(rawText: string): string {
  return `Rewrite the following JSON social posts so every post uses third person only.

Rules:
- The Economic Studies Group is the publisher. Refer to it as "the Economic Studies Group" or "the Group" when attribution is useful.
- Remove all first-person and second-person pronouns and contractions. Do not use I, me, my, mine, myself, we, us, our, ours, ourselves, you, your, yours, yourself, or yourselves.
- Keep supported claims, URLs, hashtags, and platform formats. Do not add facts.
- Shorten each post to a teaser with one hook and no more than one supporting detail. Remove methods, extra findings, and article-summary language.
- Replace any reader-directed question or imperative with a third-person invitation, such as "The Economic Studies Group welcomes discussion of [topic]." The article link can be introduced with "The full article is available at [URL]."
- Keep the posts natural and inviting. Questions must focus on the research topic, not address the reader.
- Return only valid JSON in the same shape as the input.

Posts to revise:
${rawText}`;
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
  let anthropicClient: Anthropic | undefined;

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
    anthropicClient = getAnthropicClient();
    const response = await anthropicClient.messages.create({
      model,
      max_tokens: 8192,
      thinking: { type: "disabled" },
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

  let drafts = parseDrafts(rawText, context.platforms);
  if (hasNonThirdPersonDraft(drafts)) {
    if (anthropicClient) {
      try {
        const correction = await anthropicClient.messages.create({
          model,
          max_tokens: 8192,
          thinking: { type: "disabled" },
          messages: [
            {
              role: "user",
              content: buildPerspectiveCorrectionPrompt(rawText),
            },
          ],
        });
        const correctedText = correction.content
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("");
        inputTokens += correction.usage.input_tokens;
        outputTokens += correction.usage.output_tokens;
        if (correctedText) {
          drafts = parseDrafts(correctedText, context.platforms);
        }
      } catch {
        // Preserve the original drafts and apply deterministic cleanup below.
      }
    }
  }
  if (hasNonThirdPersonDraft(drafts)) {
    drafts = enforceThirdPerson(drafts, context);
  }
  drafts = makeBriefTeasers(drafts, context);
  if (hasNonThirdPersonDraft(drafts)) {
    throw new Error("Generated posts could not be kept in third-person language.");
  }

  return {
    model,
    drafts,
    inputTokens,
    outputTokens,
  };
}
