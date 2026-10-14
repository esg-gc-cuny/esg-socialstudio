import Anthropic from "@anthropic-ai/sdk";
import { ai } from "@workspace/integrations-gemini-ai";
import { openai } from "@workspace/integrations-openai-ai-server";
import type { PlatformDraft } from "@workspace/db";
import {
  buildAnalysisPrompt,
  buildAnalysisRetryPrompt,
  buildPlatformPrompt,
  buildPlatformRetryPrompt,
  platformRules,
  type ArticleAnalysis,
  type HookAngle,
  type PromptPlatformId,
  type PlatformPromptInput,
} from "../config/social-prompts";

export type ProviderId = "openai" | "anthropic" | "gemini";
export type PlatformId = PromptPlatformId;

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

type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
};

type SingleVariant = {
  format: "single";
  angle: HookAngle;
  content: string;
  hashtags: unknown;
};

type ThreadVariant = {
  format: "thread";
  angle: HookAngle;
  posts: string[];
  hashtags: unknown;
};

type PlatformResponse = {
  variants: Array<SingleVariant | ThreadVariant>;
  recommendedIndex: number;
};

type ModelTextResponse = TokenUsage & {
  text: string;
};

const modelByProvider: Record<ProviderId, string> = {
  openai: "gpt-6-luna",
  anthropic: "claude-haiku-5-5",
  gemini: "gemini-3.8-flash",
};

const characterLimits: Record<PlatformId, number> = {
  linkedin: platformRules.linkedin.maxCharacters,
  facebook: platformRules.facebook.maxCharacters,
  bluesky: platformRules.bluesky.maxCharacters,
  substack: platformRules.substack.maxCharacters,
  x: platformRules.x.maxCharacters,
  instagram: platformRules.instagram.maxCharacters,
};

const platformNames: Record<PlatformId, string> = {
  linkedin: "LinkedIn",
  facebook: "Facebook",
  bluesky: "Bluesky",
  substack: "Substack Note",
  x: "X",
  instagram: "Instagram",
};

const allowedHookAngles = new Set<HookAngle>([
  "curiosity gap",
  "bold claim",
  "specific stat",
  "personal story",
  "question",
  "contrarian",
]);

const forbiddenPerspectivePattern =
  /\b(?:i|me|my|mine|myself|we|us|our|ours|ourselves|you|your|yours|yourself|yourselves)\b|\b(?:i|we|you)[’'](?:m|ve|ll|d|re)\b/i;

function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Anthropic API key is missing. Add ANTHROPIC_API_KEY in Replit Secrets.");
  }
  return new Anthropic({ apiKey });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function extractJson(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return JSON.parse(cleaned) as unknown;
}

function parseArticleAnalysis(text: string): ArticleAnalysis {
  const parsed = extractJson(text);
  if (!isRecord(parsed)) {
    throw new Error("Analysis must be a JSON object.");
  }

  const core_thesis = requireText(parsed.core_thesis, "core_thesis");
  const reader_payoff = requireText(parsed.reader_payoff, "reader_payoff");
  const tension = requireText(parsed.tension, "tension");
  const audience = requireText(parsed.audience, "audience");

  if (!Array.isArray(parsed.best_details) || parsed.best_details.length < 3 || parsed.best_details.length > 5) {
    throw new Error("best_details must contain 3–5 supported details.");
  }
  const best_details = parsed.best_details.map((detail, index) => {
    if (!isRecord(detail)) {
      throw new Error(`best_details[${index}] must be an object.`);
    }
    return {
      detail: requireText(detail.detail, `best_details[${index}].detail`),
      evidence: requireText(detail.evidence, `best_details[${index}].evidence`),
    };
  });

  if (!isRecord(parsed.voice_profile)) {
    throw new Error("voice_profile must be an object.");
  }
  const voice = parsed.voice_profile;
  if (
    typeof voice.formality !== "number" ||
    !Number.isInteger(voice.formality) ||
    voice.formality < 1 ||
    voice.formality > 10
  ) {
    throw new Error("voice_profile.formality must be an integer from 1 to 10.");
  }
  if (!Array.isArray(voice.signature_phrases) || voice.signature_phrases.some((phrase) => typeof phrase !== "string")) {
    throw new Error("voice_profile.signature_phrases must be an array of strings.");
  }
  const voice_profile = {
    formality: voice.formality,
    humor: requireText(voice.humor, "voice_profile.humor"),
    sentence_length: requireText(voice.sentence_length, "voice_profile.sentence_length"),
    first_person_use: requireText(voice.first_person_use, "voice_profile.first_person_use"),
    jargon_level: requireText(voice.jargon_level, "voice_profile.jargon_level"),
    emotional_register: requireText(voice.emotional_register, "voice_profile.emotional_register"),
    signature_phrases: voice.signature_phrases.map((phrase) => phrase.trim()).filter(Boolean),
  };

  if (!Array.isArray(parsed.hook_angles) || parsed.hook_angles.length !== 4) {
    throw new Error("hook_angles must contain exactly four distinct angles.");
  }
  const hook_angles = parsed.hook_angles.map((angle, index) => {
    if (!isRecord(angle) || typeof angle.angle !== "string") {
      throw new Error(`hook_angles[${index}] must include an angle label.`);
    }
    const label = angle.angle.trim().toLowerCase() as HookAngle;
    if (!allowedHookAngles.has(label)) {
      throw new Error(`hook_angles[${index}] uses an unsupported angle label.`);
    }
    return {
      angle: label,
      hook: requireText(angle.hook, `hook_angles[${index}].hook`),
    };
  });
  if (new Set(hook_angles.map((angle) => angle.angle)).size !== 4) {
    throw new Error("hook_angles must use four different angle labels.");
  }

  return {
    core_thesis,
    reader_payoff,
    tension,
    best_details,
    voice_profile,
    audience,
    hook_angles,
  };
}

function removePublisherName(content: string): string {
  return content
    .replace(
      /\bthe Group['’]s(?: latest| new)?\s+(analysis|article|study|primer|brief|piece)\b/gi,
      (_match, subject: string) =>
        subject.toLowerCase() === "piece" ? "a new article" : `a new ${subject.toLowerCase()}`,
    )
    .replace(
      /\b(?:the )?Economic Studies Group['’]s(?: latest| new)?\s+(analysis|article|study|primer|brief|piece)\b/gi,
      (_match, subject: string) =>
        subject.toLowerCase() === "piece" ? "a new article" : `a new ${subject.toLowerCase()}`,
    )
    .replace(/\b(?:according to|published by|produced by|from|by) the Economic Studies Group\b/gi, "")
    .replace(/\bthe Economic Studies Group\b/gi, "the article")
    .replace(/\bthe Group(?:['’]s)?\b/gi, "the article")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

function normalizeContent(rawContent: string): string {
  return removePublisherName(rawContent)
    .replace(
      /(?:^|\n)[ \t]*(?:Read the full article on our website:|Full article:|The full article is available at)[ \t]*https?:\/\/\S+[ \t]*(?=\n|$)/gim,
      "",
    )
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/#[\p{L}\p{N}_-]+/gu, "")
    .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\uFE0E\uFE0F\u200D\u20E3]/gu, "")
    .replace(/\s*--+\s*/g, ", ")
    .replace(/\s*[\u2012-\u2015]\s*/g, ", ")
    .replace(/,\s*,+/g, ",")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeHashtags(platform: PlatformId, value: unknown): string[] {
  const policy = platformRules[platform];
  if (!Array.isArray(value) || policy.maxHashtags === 0) return [];
  const excluded = new Set(["#researchcommunication", "#evidenceinpractice"]);
  const tags: string[] = [];
  for (const rawTag of value) {
    if (typeof rawTag !== "string") continue;
    const body = rawTag
      .trim()
      .replace(/^#+/, "")
      .replace(/\s+/g, "")
      .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\uFE0E\uFE0F\u200D\u20E3]/gu, "")
      .replace(/[^\p{L}\p{N}_-]/gu, "");
    if (!body) continue;
    const tag = `#${body}`;
    if (!excluded.has(tag.toLowerCase()) && !tags.includes(tag)) tags.push(tag);
  }
  return tags.slice(0, policy.maxHashtags);
}

function hasNonThirdPersonText(text: string): boolean {
  return forbiddenPerspectivePattern.test(text.replace(/https?:\/\/\S+/gi, ""));
}

function copyText(content: string, hashtags: string[], sourceUrl: string | null): string {
  const cta = sourceUrl
    ? `Read the full article on our website: ${sourceUrl}`
    : "";
  return [content, hashtags.join(" "), cta].filter(Boolean).join("\n\n");
}

function splitCompleteSentences(content: string): string[] {
  const sentences: string[] = [];
  const boundary = /([.!?]+["'’”)]*)(\s+|$)/g;
  let start = 0;
  let match: RegExpExecArray | null;

  while ((match = boundary.exec(content)) !== null) {
    const end = match.index + match[1].length;
    const rest = content.slice(boundary.lastIndex).trimStart();
    if (match[1].startsWith(".") && /^[A-Z]\.\s+[a-z]/.test(rest)) continue;
    if (match[1].startsWith(".") && /^[a-z]/.test(rest)) continue;

    const sentence = content.slice(start, end).trim();
    if (sentence) sentences.push(sentence);
    start = boundary.lastIndex;
  }

  const remainder = content.slice(start).trim();
  if (remainder) sentences.push(remainder);
  return sentences;
}

function removeArticleOverviewSentences(content: string): string {
  const articleOverview =
    /^(?:(?:the|this) (?:full )?(?:article|analysis|essay|piece|study)|a new (?:article|essay) from)\b.*\b(?:walks?|maps?|covers?|explores?|examines?|traces?|outlines?|details?|discusses?|looks?|weighs?|considers?|describes?)\b/i;
  return content
    .split(/\n{2,}/)
    .map((paragraph) =>
      splitCompleteSentences(paragraph)
        .filter((sentence) => !articleOverview.test(sentence.trim()))
        .join(" "),
    )
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function limitTeaserSentences(content: string, maximum: number): string {
  const sentences = splitCompleteSentences(content);
  if (sentences.length <= maximum) return content;
  const lastQuestion = sentences
    .slice()
    .reverse()
    .find((sentence) => /\?\s*["'’”)]*$/.test(sentence));
  if (maximum === 1) return lastQuestion ?? sentences[0];
  const kept = sentences.slice(0, Math.max(1, maximum - (lastQuestion ? 1 : 0)));
  if (lastQuestion && !kept.includes(lastQuestion)) kept.push(lastQuestion);
  return kept.join(" ").trim();
}

function bodyCharacterBudget(
  maxCharacters: number,
  hashtags: string[],
  sourceUrl: string | null,
): number {
  const cta = sourceUrl
    ? `Read the full article on our website: ${sourceUrl}`
    : "";
  const hashtagBlock = hashtags.join(" ");
  const extraCharacters =
    (cta ? cta.length + 2 : 0) +
    (hashtagBlock ? hashtagBlock.length + 2 : 0);
  return Math.max(0, maxCharacters - extraCharacters);
}

function trimAtClauseBoundary(content: string, characterBudget: number): string {
  const boundaries = [...content.matchAll(/[,;:]/g)];
  for (let index = boundaries.length - 1; index >= 0; index -= 1) {
    const match = boundaries[index];
    const cutAt = match.index;
    if (cutAt === undefined || cutAt > characterBudget) continue;
    const clause = content.slice(0, cutAt).trim();
    const wordCount = clause.split(/\s+/).filter(Boolean).length;
    if (
      wordCount < 5 ||
      /\b(?:and|or|but|because|with|for|to|from|of|the|a|an|as|by|in|on|at|that|which)$/i.test(
        clause,
      )
    ) {
      continue;
    }
    return `${clause.replace(/[.!?]+$/, "")}.`;
  }
  return "";
}

function compactToCharacterLimit(
  content: string,
  hashtags: string[],
  sourceUrl: string | null,
  maxCharacters: number,
): string {
  let compacted = content;
  let sentences = splitCompleteSentences(content);
  while (
    copyText(compacted, hashtags, sourceUrl).length > maxCharacters &&
    sentences.length > 1 &&
    /[.!?]["'’”)]*$/.test(sentences[sentences.length - 1])
  ) {
    sentences = sentences.slice(0, -1);
    compacted = sentences.join(" ");
  }

  if (copyText(compacted, hashtags, sourceUrl).length <= maxCharacters) {
    return compacted;
  }
  const clause = trimAtClauseBoundary(
    compacted,
    bodyCharacterBudget(maxCharacters, hashtags, sourceUrl),
  );
  return clause || compacted;
}

function appendCta(content: string, sourceUrl: string | null): string {
  if (!sourceUrl) return content;
  return `${content}\n\nRead the full article on our website: ${sourceUrl}`;
}

async function requestModelText(
  prompt: string,
  provider: ProviderId,
  model: string,
  anthropicClient?: Anthropic,
): Promise<ModelTextResponse> {
  const estimatedInputTokens = Math.ceil(prompt.length / 4);
  if (provider === "openai") {
    const response = await openai.chat.completions.create({
      model,
      max_completion_tokens: 8192,
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
    const client = anthropicClient ?? getAnthropicClient();
    const response = await client.messages.create({
      model,
      max_tokens: 8192,
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
    config: {
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
    },
  });
  const text = response.text ?? "";
  return {
    text,
    inputTokens: response.usageMetadata?.promptTokenCount ?? estimatedInputTokens,
    outputTokens:
      response.usageMetadata?.candidatesTokenCount ?? Math.ceil(text.length / 4),
  };
}

async function generateArticleAnalysis(
  context: GenerationContext,
  model: string,
  anthropicClient?: Anthropic,
): Promise<{ analysis: ArticleAnalysis; usage: TokenUsage }> {
  const prompt = buildAnalysisPrompt(context.title, context.content);
  const first = await requestModelText(prompt, context.provider, model, anthropicClient);
  try {
    return { analysis: parseArticleAnalysis(first.text), usage: first };
  } catch (error) {
    const retryPrompt = buildAnalysisRetryPrompt(
      context.title,
      context.content,
      first.text,
      error instanceof Error ? error.message : "The response did not match the required schema.",
    );
    const retry = await requestModelText(
      retryPrompt,
      context.provider,
      model,
      anthropicClient,
    );
    try {
      return {
        analysis: parseArticleAnalysis(retry.text),
        usage: {
          inputTokens: first.inputTokens + retry.inputTokens,
          outputTokens: first.outputTokens + retry.outputTokens,
        },
      };
    } catch (retryError) {
      throw new Error(
        `Article analysis was not valid after one retry: ${
          retryError instanceof Error ? retryError.message : "invalid JSON response"
        }`,
      );
    }
  }
}

function parsePlatformResponse(
  text: string,
  platform: PlatformId,
  analysis: ArticleAnalysis,
): PlatformResponse {
  const parsed = extractJson(text);
  if (!isRecord(parsed) || parsed.platform !== platform || !Array.isArray(parsed.variants)) {
    throw new Error(`The response must include ${platformNames[platform]} variants.`);
  }
  const expectedCount = platform === "bluesky" ? 2 : 3;
  if (parsed.variants.length !== expectedCount) {
    throw new Error(`${platformNames[platform]} must return exactly ${expectedCount} variants.`);
  }
  if (
    typeof parsed.recommended_index !== "number" ||
    !Number.isInteger(parsed.recommended_index) ||
    parsed.recommended_index < 0 ||
    parsed.recommended_index >= expectedCount
  ) {
    throw new Error(`${platformNames[platform]} recommended_index is invalid.`);
  }

  const analysisAngles = new Set(analysis.hook_angles.map((angle) => angle.angle));
  const variants = parsed.variants.map((value, index): SingleVariant | ThreadVariant => {
    if (!isRecord(value) || typeof value.angle !== "string") {
      throw new Error(`${platformNames[platform]} variant ${index + 1} is missing its angle.`);
    }
    const angle = value.angle.trim().toLowerCase() as HookAngle;
    if (!allowedHookAngles.has(angle) || !analysisAngles.has(angle)) {
      throw new Error(`${platformNames[platform]} variant ${index + 1} uses an unsupported angle.`);
    }
    const format = value.format;
    if (platform === "bluesky" && format === "thread") {
      if (
        !Array.isArray(value.posts) ||
        value.posts.length < 2 ||
        value.posts.length > 3 ||
        value.posts.some((post) => typeof post !== "string" || !post.trim())
      ) {
        throw new Error("The Bluesky thread must contain 2–3 complete posts.");
      }
      return {
        format: "thread",
        angle,
        posts: value.posts as string[],
        hashtags: value.hashtags,
      };
    }
    if (format !== "single" || typeof value.content !== "string") {
      throw new Error(`${platformNames[platform]} variant ${index + 1} must be a single post.`);
    }
    return {
      format: "single",
      angle,
      content: value.content,
      hashtags: value.hashtags,
    };
  });

  if (new Set(variants.map((variant) => variant.angle)).size !== variants.length) {
    throw new Error(`${platformNames[platform]} variants must use distinct hook angles.`);
  }
  if (platform === "bluesky") {
    if (
      variants.filter((variant) => variant.format === "single").length !== 1 ||
      variants.filter((variant) => variant.format === "thread").length !== 1 ||
      parsed.recommended_index !== 0
    ) {
      throw new Error("Bluesky must return one single post and one thread, with the single post selected.");
    }
  } else if (variants.some((variant) => variant.format !== "single")) {
    throw new Error(`${platformNames[platform]} variants must all be single posts.`);
  }

  return { variants, recommendedIndex: parsed.recommended_index };
}

function selectPlatformDraft(
  response: PlatformResponse,
  platform: PlatformId,
  context: GenerationContext,
): PlatformDraft {
  const rules = platformRules[platform];
  const singleVariants = response.variants
    .map((variant, index) => ({ variant, index }))
    .filter(
      (entry): entry is { variant: SingleVariant; index: number } =>
        entry.variant.format === "single",
    );
  const singleCandidates = singleVariants.map(({ variant, index }) => ({
    content: variant.content,
    hashtags: variant.hashtags,
    index,
  }));
  const threadPostCandidates =
    platform === "bluesky"
      ? response.variants.flatMap((variant, index) =>
          variant.format === "thread"
            ? variant.posts.map((content, postIndex) => ({
                content,
                hashtags: variant.hashtags,
                index: response.variants.length + index + postIndex,
              }))
            : [],
        )
      : [];
  const candidates =
    platform === "bluesky"
      ? [...singleCandidates, ...threadPostCandidates]
      : [
          ...singleCandidates.filter((candidate) => candidate.index === response.recommendedIndex),
          ...singleCandidates.filter((candidate) => candidate.index !== response.recommendedIndex),
        ];
  const rejected: string[] = [];

  for (const candidate of candidates) {
    let content = limitTeaserSentences(
      removeArticleOverviewSentences(normalizeContent(candidate.content)),
      rules.maxTeaserSentences,
    );
    if (!content) {
      rejected.push("empty post text");
      continue;
    }
    if (hasNonThirdPersonText(content)) {
      rejected.push("first-person or second-person wording");
      continue;
    }
    if (/\b(?:Economic Studies Group|the Group)\b/i.test(content)) {
      rejected.push("publisher name in post text");
      continue;
    }

    const hashtags = normalizeHashtags(platform, candidate.hashtags);
    let fullText = copyText(content, hashtags, context.sourceUrl);
    if (fullText.length > rules.maxCharacters) {
      content = compactToCharacterLimit(
        content,
        hashtags,
        context.sourceUrl,
        rules.maxCharacters,
      );
      fullText = copyText(content, hashtags, context.sourceUrl);
    }
    const characterCount = fullText.length;
    if (characterCount > rules.maxCharacters) {
      rejected.push(`over ${rules.maxCharacters} characters`);
      continue;
    }
    if (rules.minCharacters > 0 && characterCount < rules.minCharacters) {
      rejected.push(`under ${rules.minCharacters} characters`);
      continue;
    }
    if (hashtags.length < rules.minHashtags || hashtags.length > rules.maxHashtags) {
      rejected.push("hashtag count outside platform policy");
      continue;
    }

    return {
      platform,
      content: appendCta(content, context.sourceUrl),
      hashtags,
      characterCount,
      characterLimit: rules.maxCharacters,
    };
  }

  const issue = [...new Set(rejected)].join(", ") || "no eligible single-post variant";
  throw new Error(
    `No ${platformNames[platform]} variant passed validation (${issue}).`,
  );
}

async function generateOnePlatform(
  platform: PlatformId,
  context: GenerationContext,
  analysis: ArticleAnalysis,
  model: string,
  anthropicClient?: Anthropic,
): Promise<{ draft: PlatformDraft; usage: TokenUsage }> {
  const promptInput: PlatformPromptInput = {
    platform,
    title: context.title,
    article: context.content,
    sourceUrl: context.sourceUrl,
    analysis,
    tone: context.tone,
    audience: context.audience,
    campaignGoal: context.campaignGoal,
  };
  const prompt = buildPlatformPrompt(promptInput);
  const first = await requestModelText(prompt, context.provider, model, anthropicClient);
  try {
    const parsed = parsePlatformResponse(first.text, platform, analysis);
    return {
      draft: selectPlatformDraft(parsed, platform, context),
      usage: first,
    };
  } catch (error) {
    const retryPrompt = buildPlatformRetryPrompt(
      promptInput,
      first.text,
      error instanceof Error ? error.message : "The response did not pass validation.",
    );
    const retry = await requestModelText(
      retryPrompt,
      context.provider,
      model,
      anthropicClient,
    );
    try {
      const parsed = parsePlatformResponse(retry.text, platform, analysis);
      return {
        draft: selectPlatformDraft(parsed, platform, context),
        usage: {
          inputTokens: first.inputTokens + retry.inputTokens,
          outputTokens: first.outputTokens + retry.outputTokens,
        },
      };
    } catch (retryError) {
      throw new Error(
        `${platformNames[platform]} posts were invalid after one retry: ${
          retryError instanceof Error ? retryError.message : "invalid response"
        }`,
      );
    }
  }
}

export async function generatePlatformDrafts(
  context: GenerationContext,
): Promise<GenerationResult> {
  const model = modelByProvider[context.provider];
  const anthropicClient =
    context.provider === "anthropic" ? getAnthropicClient() : undefined;
  const { analysis, usage: analysisUsage } = await generateArticleAnalysis(
    context,
    model,
    anthropicClient,
  );
  const platformResults = await Promise.all(
    context.platforms.map((platform) =>
      generateOnePlatform(platform, context, analysis, model, anthropicClient),
    ),
  );

  return {
    model,
    drafts: platformResults.map((result) => result.draft),
    inputTokens:
      analysisUsage.inputTokens +
      platformResults.reduce((total, result) => total + result.usage.inputTokens, 0),
    outputTokens:
      analysisUsage.outputTokens +
      platformResults.reduce((total, result) => total + result.usage.outputTokens, 0),
  };
}
