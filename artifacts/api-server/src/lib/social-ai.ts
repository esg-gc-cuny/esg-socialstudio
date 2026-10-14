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
  substack: "Substack Note",
  x: "X",
  instagram: "Instagram",
};

const forbiddenPerspectivePattern =
  /\b(?:i|me|my|mine|myself|we|us|our|ours|ourselves|you|your|yours|yourself|yourselves)\b|\b(?:i|we|you)[’'](?:m|ve|ll|d|re)\b/i;

function containsNonThirdPersonText(text: string): boolean {
  const teaserText = text.replace(
    /(?:^|\n)[ \t]*Read the full article on our website:[ \t]*https?:\/\/\S+[ \t]*(?=\n|$)/gim,
    "",
  );
  return forbiddenPerspectivePattern.test(teaserText.replace(/https?:\/\/\S+/gi, ""));
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
  const safeInvitation = "What questions do these findings raise?";

  return drafts.map((draft) => {
    let content = removeNonThirdPersonSentences(
      removePublisherName(draft.content),
    );
    if (!content) {
      content = "The Economic Studies Group shares new research.";
    }
    if (!/\b(?:read|discussion|discuss|conversation|comments?|respond|response)\b/i.test(content)) {
      content += `\n\n${safeInvitation}`;
    }
    if (context.sourceUrl && !content.includes(context.sourceUrl)) {
      content += `\n\nFull article: ${context.sourceUrl}`;
    }

    const hashtagLength = draft.hashtags.length
      ? draft.hashtags.join(" ").length + 1
      : 0;
    const contentLimit = Math.max(0, draft.characterLimit - hashtagLength);
    if (content.length > contentLimit) {
      const linkLine = context.sourceUrl
        ? `Full article: ${context.sourceUrl}`
        : "";
      const invitation = "What questions remain?";
      const suffix = [invitation, linkLine].filter(Boolean).join("\n\n");
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
  linkedin: 650,
  facebook: 350,
  bluesky: 280,
  substack: 500,
  x: 280,
  instagram: 350,
};

function shortenAtClauseBoundary(text: string, maxLength: number): string {
  const clauseBreak = /\s+(?:but|yet|while|although|though)\s+/i.exec(text);
  if (!clauseBreak || clauseBreak.index > maxLength) return "";
  const clause = text.slice(0, clauseBreak.index).replace(/[,:;]\s*$/, "").trim();
  if (!clause || clause.length + 1 > maxLength) return "";
  return `${clause}.`;
}

function isNaturalTopicQuestion(sentence: string): boolean {
  if (
    /^(?:what questions do (?:these|the) findings raise|what remains unresolved|which question deserves more attention|what does this suggest)\??$/i.test(
      sentence.trim(),
    )
  ) {
    return false;
  }
  return (
    sentence.includes("?") &&
    /^(?:what|how|why|which|when|where|who|can|could|should|does|do|is|are|will|would)\b/i.test(
      sentence.trim(),
    )
  );
}

function makeTitleFallback(title: string, maxLength: number): string {
  let topic = title.split(/[:.!?]/u)[0].trim();
  if (!topic) return "The article explores a timely economic question.";
  const startsWithArticle = /^(?:the|a|an)\s/i.test(topic);
  topic = topic.replace(/^(?:the|a|an)\s+/i, "").toLowerCase();
  if (!startsWithArticle && /^(?:economics|effects?|impacts?|role|future|rise|growth|costs?|benefits?|risks?|relationship|case|markets?|policy|trade|labor|employment)\b/i.test(topic)) {
    topic = `the ${topic}`;
  }
  const fallback = `The article examines ${topic}.`;
  if (fallback.length <= maxLength) return fallback;
  return maxLength >= 32 ? "The article examines this topic." : "";
}

function makeBriefTeasers(
  drafts: PlatformDraft[],
  context: GenerationContext,
): PlatformDraft[] {
  return drafts.map((draft) => {
    const platform = draft.platform as PlatformId;
    const maxHookSentences =
      platform === "linkedin" || platform === "substack" ? 2 : 1;
    const safeSentences = removeNonThirdPersonSentences(
      removePublisherName(draft.content),
    )
      .split(/(?<=[.!?])\s+|[\r\n]+/u)
      .filter(Boolean)
      .filter((sentence) => !/\b(?:Economic Studies Group|the Group)\b/i.test(sentence))
      .filter((sentence) => !/\b(?:read|discussion|discuss|conversation|comments?|respond|response)\b/i.test(sentence))
      .filter((sentence) => !context.sourceUrl || !sentence.includes(context.sourceUrl))
      .filter(Boolean);
    const questionLimit: Record<PlatformId, number> = {
      linkedin: 75,
      facebook: 40,
      bluesky: 28,
      substack: 70,
      x: 28,
      instagram: 40,
    };
    const topicQuestion = safeSentences.find(
      (sentence) =>
        isNaturalTopicQuestion(sentence) &&
        sentence.length <= questionLimit[platform],
    );
    const hookCandidates = safeSentences
      .filter((sentence) => !sentence.includes("?"))
      .filter((sentence) => !/^(?:it|they|their|these|those|this|its)\b/i.test(sentence))
      .slice(0, maxHookSentences);
    const compactHooks = hookCandidates.map((sentence) =>
      sentence.replace(/,\s*[^,]{18,},/g, "").replace(/\s{2,}/g, " ").trim(),
    );
    const hashtagsLength = draft.hashtags.length
      ? draft.hashtags.join(" ").length + 2
      : 0;
    const contentLimit = Math.max(
      0,
      shortPostTargets[platform] - hashtagsLength,
    );
    const linkLine = context.sourceUrl
      ? `Read the full article on our website: ${context.sourceUrl}`
      : "";
    const invitation = topicQuestion || "";
    const fixedLength =
      (invitation ? invitation.length + 1 : 0) +
      (linkLine ? linkLine.length + 2 : 0);
    const bodyBudget = Math.max(0, contentLimit - fixedLength);
    const selectedHooks: string[] = [];
    for (const sentence of compactHooks) {
      const next = [...selectedHooks, sentence].join(" ");
      if (next.length <= bodyBudget) {
        selectedHooks.push(sentence);
        continue;
      }
      if (selectedHooks.length === 0) {
        const shortened = shortenAtClauseBoundary(sentence, bodyBudget);
        if (shortened) selectedHooks.push(shortened);
        else continue;
      }
      break;
    }
    let body = selectedHooks.join(" ");
    let finalInvitation = invitation;
    if (!body) {
      body = makeTitleFallback(context.title, bodyBudget);
      if (body && body.length + (finalInvitation ? finalInvitation.length + 1 : 0) > bodyBudget) {
        finalInvitation = "";
      }
    }
    const teaserParagraph = [body, finalInvitation].filter(Boolean).join(" ");
    const content = [teaserParagraph, linkLine].filter(Boolean).join("\n\n");

    return {
      ...draft,
      content,
      characterLimit: shortPostTargets[platform],
      characterCount:
        content.length +
        (draft.hashtags.length
          ? draft.hashtags.join(" ").length + 2
          : 0),
    };
  });
}

function buildPrompt(context: GenerationContext): string {
  const platformInstructions = context.platforms
    .map((platform) => {
      const name = platformNames[platform];
      const limit = shortPostTargets[platform];
      const hashtagReserve: Record<PlatformId, number> = {
        linkedin: 45,
        facebook: 38,
        bluesky: 24,
        substack: 36,
        x: 24,
        instagram: 38,
      };
      const ctaLength = context.sourceUrl
        ? `Read the full article on our website: ${context.sourceUrl}`.length + 4
        : 0;
      const paragraphCaps: Record<PlatformId, number> = {
        linkedin: 260,
        facebook: 100,
        bluesky: 65,
        substack: 220,
        x: 65,
        instagram: 100,
      };
      const bodyCharacterBudget = Math.max(
        0,
        Math.min(
          paragraphCaps[platform],
          limit - ctaLength - hashtagReserve[platform],
        ),
      );
      const style =
        platform === "substack"
          ? `Write a Substack Note, not a newsletter post. Use a thoughtful, editorial teaser paragraph of 2 short sentences, about 25-35 words and no more than ${bodyCharacterBudget} characters before hashtags and the final link. Name the topic, add one concrete context point, and use a specific question only if it sounds natural.`
          : platform === "bluesky" || platform === "x"
            ? `Write one concise, conversational teaser paragraph of 10-16 words and no more than ${bodyCharacterBudget} characters before hashtags and the final link. Name the topic and include one concrete context point. A short, specific question is optional; never return a question alone.`
            : platform === "linkedin"
              ? `Write a credible, professional, insight-led teaser paragraph of 2 sentences, about 30-40 words and no more than ${bodyCharacterBudget} characters before hashtags and the final link. Name the economic topic, add one specific fact or tension, and show why it matters. A policy question is optional if it sounds natural.`
              : platform === "facebook"
                ? `Write an approachable, plain-language Page teaser paragraph of 1-2 short sentences, about 18-25 words and no more than ${bodyCharacterBudget} characters before hashtags and the final link. Name the topic and give one clear practical or economic implication. A short, specific question is optional.`
              : platform === "instagram"
                ? "Use a short, accessible caption with a strong first line and a clear next step."
                : "Write a warm, accessible post with a plain-language takeaway, the article link, and a relevant invitation to discuss.";
      return `- ${name} (${platform}, maximum ${limit} characters): ${style}`;
    })
    .join("\n");

  return `You manage social posts for a research publisher. Adapt published research articles and primers into accurate public-facing posts that encourage followers to read and discuss the original work.

Editorial rules:
- Use only claims supported by the source. Never invent study results, statistics, quotes, authors, or implications.
- Preserve uncertainty, limitations, and non-causal language when needed to avoid misleading readers. Do not overstate evidence or promise outcomes.
- Write a short teaser paragraph, not an article summary or abstract. Start directly with the article's topic and one concrete context point. The first sentence must name the article's subject and give followers a reason to read on. Repeat the subject instead of opening with a pronoun such as “it,” “they,” “their,” or “these.” Hold back the full analysis.
- Do not add an announcement or preamble such as "New on the website." The teaser must identify what the article is about and why it matters without vague filler.
- Write in the publisher's official voice without naming or referring to the publisher. Use third person only. Let the article, analysis, research, or findings be the subject.
- Never use first-person or second-person pronouns or contractions. Do not use I, me, my, mine, myself, we, us, our, ours, ourselves, you, your, yours, yourself, or yourselves. Do not quote first-person source language. Rephrase it in third person.
- A topic-specific question is optional. Use one only when it sounds natural and adds genuine interest; do not turn a statement into a question by adding a question mark. Never return a question alone or use generic questions such as “What questions do these findings raise?” Do not address readers directly or use an imperative in the teaser paragraph.
- Keep the voice ${context.tone}. Write for ${context.audience || "an interested general audience"}.
- Campaign goal: ${context.campaignGoal || "raise awareness and invite readers to the full research resource"}.
- Sound human and distinct for each platform, not like a template or detached summary. Avoid canned openings, exaggerated claims, detailed summaries, and repeated calls to action.
- Use plain language and platform-appropriate formatting.
- Add 2-4 specific hashtags that fit the article topic and the platform audience. Do not use generic tags such as #ResearchCommunication or #EvidenceInPractice. Do not repeat the same tags across platforms unless they genuinely fit each one.
- Put hashtags only in the hashtags array. The copy button places hashtags before the final article call to action.
- Do not use em dashes, en dashes, or double hyphens in the post content. Use commas, periods, or colons instead.
- Do not use emojis.
- The workflow appends the source URL and final call to action separately, so do not include either in the post content.
- Keep the teaser paragraph within the character budget stated for its platform. The budget reserves space for hashtags and the article link CTA.
- Keep posts brief enough to make readers curious, not fully informed. The article should contain the detail and analysis.
- Every sentence must be complete. Never cut a sentence off to meet a length target.
- Before returning, check every teaser paragraph for first-person and second-person wording. Rewrite any violation in third person.
- Return only valid JSON in the shape {"drafts":[{"platform":"linkedin","content":"...","hashtags":["#Example"],"characterCount":0,"characterLimit":3000}]}.

Source title: ${context.title}

Source content:
${context.content}

Create one draft for each requested platform:
${platformInstructions}`;
}

function buildPerspectiveCorrectionPrompt(rawText: string): string {
  return `Rewrite the following JSON social posts in third person and keep the publisher unnamed.

Rules:
- Remove all first-person and second-person pronouns and contractions from the teaser paragraph. Do not use I, me, my, mine, myself, we, us, our, ours, ourselves, you, your, yours, yourself, or yourselves.
- Keep supported claims, hashtags, and platform formats. Do not add facts. Remove any link line, since the workflow adds the final call to action.
- Keep each post as a short teaser with one hook and no more than one supporting detail. Remove methods, extra findings, and article-summary language.
- Use the platform's tone and a short, topic-focused question.
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
