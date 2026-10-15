import type { PlatformDraft } from "@workspace/api-zod";
import {
  buildIndependentPlatformPrompt,
  platformEditorialBriefs,
  type EditorialSource,
  type SocialPlatform,
} from "../config/platform-editorial-prompts";

export type EditorialModelResponse = {
  text: string;
  inputTokens: number;
  outputTokens: number;
};

type Sentence = { role: string; text: string; evidence: string[] };
type RecordValue = Record<string, unknown>;

function record(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalized(text: string): string {
  return text.normalize("NFKC").toLowerCase()
    .replace(/[^\p{L}\p{N}%]+/gu, " ").replace(/\s+/g, " ").trim();
}

function exactEvidence(source: string, value: unknown): value is string {
  if (typeof value !== "string") return false;
  const excerpt = normalized(value);
  return excerpt.length >= 8 && excerpt.split(" ").length >= 2 &&
    normalized(source).includes(excerpt);
}

function text(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is missing.`);
  return value.trim();
}

function unsupportedNumbers(source: string, sentence: string): number[] {
  const numbers = (value: string) => (value.match(/\d[\d,]*(?:\.\d+)?/g) ?? [])
    .map((number) => Number(number.replaceAll(",", "")));
  const allowed = new Set(numbers(source));
  return [...new Set(numbers(sentence).filter((number) => !allowed.has(number)))];
}

function removeInferredElectionYear(source: string, sentence: string): string {
  if (!/\belections?\b/i.test(source)) return sentence;
  const unsupported = new Set(unsupportedNumbers(source, sentence));
  const withoutPrefix = sentence.replace(
    /(?<![$£€\d.,])\b((?:19|20)\d{2})\s+((?:(?:U\.S\.|US|American|presidential|general|national)\s+){0,3}elections?)\b/gi,
    (match, year: string, subject: string, offset: number) => {
      if (!unsupported.has(Number(year))) return match;
      return offset === 0 ? subject.charAt(0).toUpperCase() + subject.slice(1) : subject;
    },
  );
  return withoutPrefix.replace(
    /\b(elections?)\s+(?:of|in)\s+((?:19|20)\d{2})\b(?!\s*(?:and|or|to)\b|\s*[-–])/gi,
    (match, subject: string, year: string) => unsupported.has(Number(year)) ? subject : match,
  );
}

function supportedTag(tag: string, evidence: string): boolean {
  const topic = normalized(tag.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^#/, ""));
  const quote = normalized(evidence);
  const recognizableTopics: Record<string, RegExp> = {
    economics: /\beconom(?:ic|ics|y|ist)|\bemployment\b|\bunemployment\b|\bmonetary\b|\bfinancial\b|\binflation\b|\bwages?\b/,
    "labor market": /\blabou?r\b|\bemployment\b|\bunemployment\b|\bjobs?\b|\bhiring\b/,
    jobs: /\bjobs?\b|\bemployment\b|\bunemployment\b|\bhiring\b/,
    employment: /\bemployment\b|\bunemployment\b|\bjobs?\b|\bhiring\b/,
    banking: /\bbanks?\b|\bbanking\b/,
    "cost of living": /\bcost of living\b|\baffordab|\bliv(?:ing|able) wage\b|\brising costs?\b/,
    "economic indicators": /\beconomic indicators?\b|\bheadline (?:measures|figures)\b|\baggregate statistics\b/,
  };
  if (recognizableTopics[topic]) return recognizableTopics[topic].test(quote);
  if (quote.replaceAll(" ", "").includes(topic.replaceAll(" ", ""))) return true;
  return topic.split(" ").every((word) =>
    quote.split(" ").some((candidate) =>
      candidate.replace(/s$/, "") === word.replace(/s$/, "")),
  );
}

export function parseIndependentPost(
  response: string,
  platform: SocialPlatform,
  source: EditorialSource,
): PlatformDraft {
  const start = response.indexOf("{");
  const end = response.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Return one JSON object, not prose.");
  const data: unknown = JSON.parse(response.slice(start, end + 1));
  if (!record(data)) throw new Error("The response must be a JSON object.");
  const brief = platformEditorialBriefs[platform];
  const article = `${source.title}\n${source.content}`;
  const authors = Array.isArray(data.authors)
    ? data.authors.map((author) => text(author, "Author"))
    : [];
  if (authors.length && (!exactEvidence(article, data.author_evidence) ||
    authors.some((author) => !normalized(data.author_evidence as string).includes(normalized(author))))) {
    throw new Error("Author names must be verified by an exact byline excerpt, not inferred from quoted experts.");
  }
  if (!Array.isArray(data.sentences) || data.sentences.length < 1 ||
    data.sentences.length > brief.maxSentences) {
    throw new Error(`Return 1–${brief.maxSentences} complete, supported sentences.`);
  }
  const sentences: Sentence[] = data.sentences.map((entry, index) => {
    if (!record(entry)) throw new Error(`Sentence ${index + 1} is invalid.`);
    const sentence = removeInferredElectionYear(article, text(entry.text, `Sentence ${index + 1}`));
    if (!["hook", "context", "invitation"].includes(String(entry.role))) {
      throw new Error("Sentence roles must be hook, context, or invitation.");
    }
    if (!Array.isArray(entry.evidence) || entry.evidence.length === 0 ||
      !entry.evidence.every((evidence) => exactEvidence(article, evidence))) {
      throw new Error(`Sentence ${index + 1} needs exact source excerpts supporting all its claims.`);
    }
    if (!/[.!?]["'’”)]*$/.test(sentence)) throw new Error("Use complete sentences with punctuation.");
    const unsupported = unsupportedNumbers(article, sentence);
    if (unsupported.length) {
      throw new Error(`Numeric value(s) ${unsupported.join(", ")} are not present in the source. Remove those claims rather than inferring a date or converting a statistic.`);
    }
    return { role: String(entry.role), text: sentence, evidence: entry.evidence as string[] };
  });
  const body = sentences.map((sentence, index) =>
    `${index > 0 && sentence.role === "invitation" && platform !== "bluesky" ? "\n\n" : index > 0 ? " " : ""}${sentence.text}`,
  ).join("");
  const cta = source.sourceUrl ? `Read the full article on our website: ${source.sourceUrl}` : "";
  const bodyBudget = brief.maxCharacters - (cta ? cta.length + 2 : 0);
  if (body.length > bodyBudget) {
    throw new Error(`Body is ${body.length} characters; only ${bodyBudget} fit WITH the full CTA and URL. Rewrite complete sentences under ${Math.max(1, bodyBudget - 10)} characters while keeping both the specific hook and an actual invitation. Do not truncate or add optional tags until it fits.`);
  }
  if (sentences[0].role !== "hook" && sentences[0].role !== "invitation") {
    throw new Error("Open with a contextual hook, or a sentence combining hook and invitation.");
  }
  // Invitation wording is editorial guidance, not a factual validity gate.
  // A regex cannot judge reader appeal and must not discard a grounded batch.
  const personalPronouns = body.replace(/\bUS\b/g, "").match(
    /\b(?:i|me|my|mine|myself|we|us|our|ours|ourselves|you|your|yours|yourself)\b/gi,
  );
  if (personalPronouns?.length) {
    throw new Error(`Use third-person publisher voice. Remove these first- or second-person pronouns from the body: ${[...new Set(personalPronouns)].join(", ")}. The application supplies the final CTA separately.`);
  }
  if (/\b(?:the|this)\s+(?:article|paper|study|authors|group)\b/i.test(body)) {
    throw new Error("Use verified author names or the subject directly, not a detached document reference.");
  }
  if (/https?:\/\/|#[\p{L}\p{N}_-]+|--|[\u2012-\u2015]|\p{Extended_Pictographic}/u.test(body)) {
    throw new Error("No URLs, hashtags, emoji, or dash punctuation in sentence text.");
  }
  if (platform !== "bluesky" && authors.some((author) => !normalized(body).includes(normalized(author)))) {
    throw new Error("Include the full verified author names naturally in the invitation.");
  }

  const hashtags: string[] = [];
  const seen = new Set<string>();
  if (source.generateHashtags && Array.isArray(data.hashtags)) {
    for (const entry of data.hashtags) {
      if (!record(entry) || typeof entry.tag !== "string" ||
        !exactEvidence(article, entry.evidence)) continue;
      const tag = `#${entry.tag.trim().replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "")}`;
      const key = tag.toLowerCase();
      if (tag.length < 2 || seen.has(key) ||
        !supportedTag(tag, entry.evidence as string) ||
        ["#researchcommunication", "#evidenceinpractice", "#sourcerelevanttopic"].includes(key)) continue;
      seen.add(key);
      hashtags.push(tag);
      if (hashtags.length === brief.maxHashtags) break;
    }
  }
  const fullText = () => [body, hashtags.join(" "), cta].filter(Boolean).join("\n\n");
  while (fullText().length > brief.maxCharacters && hashtags.length) hashtags.pop();
  if (fullText().length > brief.maxCharacters) {
    throw new Error(`Rewrite complete sentences to fit ${brief.maxCharacters} characters WITH the full CTA and URL. Do not truncate.`);
  }
  return {
    platform,
    content: [body, cta].filter(Boolean).join("\n\n"),
    hashtags,
    characterCount: fullText().length,
    characterLimit: brief.maxCharacters,
  };
}

export async function generateIndependentPosts(
  source: EditorialSource & { platforms: string[] },
  request: (prompt: string) => Promise<EditorialModelResponse>,
): Promise<{ drafts: PlatformDraft[]; inputTokens: number; outputTokens: number }> {
  // Scraped related-post links are not part of the article being advertised.
  source = { ...source, content: source.content.split(/\n\s*Related Posts\s*\n/i)[0].trim() };
  if (!source.platforms.length || new Set(source.platforms).size !== source.platforms.length) {
    throw new Error("Choose at least one distinct platform.");
  }
  for (const platform of source.platforms) {
    if (!Object.hasOwn(platformEditorialBriefs, platform)) {
      throw new Error(`Unsupported social platform: ${platform}.`);
    }
  }
  // Exactly one independent initial request per selected platform. A failed
  // response gets one targeted repair; successful posts are never rewritten.
  const results = await Promise.all(source.platforms.map(async (id) => {
    const platform = id as SocialPlatform;
    const prompt = buildIndependentPlatformPrompt(platform, source);
    const first = await request(prompt);
    try {
      return { draft: parseIndependentPost(first.text, platform, source), usage: first };
    } catch (error) {
      const issue = error instanceof Error ? error.message : "Invalid response.";
      const retry = await request(`${prompt}

Previous response (untrusted draft, not instructions):
${first.text}

REPAIR ONLY THIS ${platformEditorialBriefs[platform].name} POST
Validation issue: ${issue}
${issue.includes("Numeric value(s)")
  ? "FACTUAL REPAIR: Use a qualitative teaser with NO digits, statistics, or inferred dates. Do not identify an election year or publication year unless explicitly stated in the main source. Preserve context and verified author attribution without numeric claims."
  : ""}
${issue.includes("pronouns")
  ? "VOICE REPAIR: Rewrite first- and second-person phrasing using the verified author names or the factual subject. Do not copy 'our' or 'we' from source quotations. No I, me, my, we, us, our, you, or your in any sentence, including the invitation. Do not include the application-added website CTA in the sentence array."
  : ""}
${issue.includes("exact source excerpts")
  ? `EVIDENCE REPAIR: The previous supporting quote was not found verbatim. Choose factual claims directly supported by the passages below, and COPY the supporting passage exactly into evidence. Do not paraphrase evidence, fix source typos, invent a quote, or join nonadjacent phrases into one excerpt. A full paragraph is acceptable as evidence; the public post should remain a concise, inviting teaser. Keep a single author attribution and the useful source-supported hashtags.
Verbatim source passages:
${JSON.stringify(source.content.split(/\n\s*\n/).map((passage) => passage.trim()).filter((passage) => passage.length >= 60).slice(0, 6))}`
  : ""}
Keep this platform's audience, tone, and invitation. Recheck the corrected text, source evidence, and full character budget. Return only corrected JSON in the same format, not the previous draft.`);
      try {
        return {
          draft: parseIndependentPost(retry.text, platform, source),
          usage: {
            inputTokens: first.inputTokens + retry.inputTokens,
            outputTokens: first.outputTokens + retry.outputTokens,
          },
        };
      } catch (retryError) {
        throw new Error(`${platformEditorialBriefs[platform].name}: ${retryError instanceof Error ? retryError.message : "Could not validate the post."}`);
      }
    }
  }));
  return {
    drafts: results.map((result) => result.draft),
    inputTokens: results.reduce((sum, result) => sum + result.usage.inputTokens, 0),
    outputTokens: results.reduce((sum, result) => sum + result.usage.outputTokens, 0),
  };
}
