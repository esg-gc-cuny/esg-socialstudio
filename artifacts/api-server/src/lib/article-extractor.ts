import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { load } from "cheerio";
import type { CheerioAPI } from "cheerio";

const MAX_HTML_BYTES = 3 * 1024 * 1024;
const MAX_ARTICLE_LENGTH = 100_000;
const MAX_REDIRECTS = 3;

export class ArticleExtractionError extends Error {
  constructor(
    message: string,
    readonly statusCode: 400 | 422 = 422,
  ) {
    super(message);
    this.name = "ArticleExtractionError";
  }
}

function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 2 || b === 168)) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }

  if (version === 6) {
    const normalized = address.toLowerCase().split("%")[0];
    return (
      /^[23]/.test(normalized) &&
      !normalized.startsWith("2001:db8:") &&
      !normalized.startsWith("::ffff:")
    );
  }

  return false;
}

async function validatePublicUrl(url: URL): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ArticleExtractionError("Use a public http or https article link.", 400);
  }
  if (url.username || url.password) {
    throw new ArticleExtractionError("The link must not contain a username or password.", 400);
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new ArticleExtractionError("Only public article links can be read.", 400);
  }

  if (isIP(hostname)) {
    if (!isPublicAddress(hostname)) {
      throw new ArticleExtractionError("Only public article links can be read.", 400);
    }
    return;
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new ArticleExtractionError("Could not reach that page. Check the link or paste the text instead.");
  }
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new ArticleExtractionError("Only public article links can be read.", 400);
  }
}

async function readLimitedBody(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_HTML_BYTES) {
    throw new ArticleExtractionError("This page is too large to read. Paste the article text instead.");
  }
  if (!response.body) {
    throw new ArticleExtractionError("This page returned no readable content.");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_HTML_BYTES) {
        await reader.cancel();
        throw new ArticleExtractionError("This page is too large to read. Paste the article text instead.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function fetchPublicHtml(startUrl: string): Promise<{ html: string; finalUrl: string }> {
  let currentUrl: URL;
  try {
    currentUrl = new URL(startUrl);
  } catch {
    throw new ArticleExtractionError("Enter a valid article link.", 400);
  }
  currentUrl.hash = "";

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    await validatePublicUrl(currentUrl);

    let response: Response;
    try {
      response = await fetch(currentUrl, {
        redirect: "manual",
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": "ResearchSocialDesk/1.0 (public article text extraction)",
        },
        signal: AbortSignal.timeout(12_000),
      });
    } catch {
      throw new ArticleExtractionError("Could not read that page. Paste the article text instead.");
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirects === MAX_REDIRECTS) {
        throw new ArticleExtractionError("This link redirects too many times. Paste the article text instead.");
      }
      try {
        currentUrl = new URL(location, currentUrl);
        currentUrl.hash = "";
      } catch {
        throw new ArticleExtractionError("This page returned an invalid redirect.");
      }
      continue;
    }

    if (!response.ok) {
      throw new ArticleExtractionError("This page blocked automatic reading or is unavailable. Paste the article text instead.");
    }
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      throw new ArticleExtractionError("That link is not an HTML article page. Paste the article text instead.");
    }

    return {
      html: await readLimitedBody(response),
      finalUrl: currentUrl.toString(),
    };
  }

  throw new ArticleExtractionError("This link redirects too many times. Paste the article text instead.");
}

function normalizedText(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function articleText($: CheerioAPI, root: ReturnType<CheerioAPI>): string {
  const blocks = root.find("h1, h2, h3, h4, p, li, blockquote, pre").toArray();
  const text = blocks
    .filter((element) => {
      const tagName = element.tagName.toLowerCase();
      return (
        tagName === "li" ||
        tagName === "blockquote" ||
        $(element).parents("li, blockquote").length === 0
      );
    })
    .map((element) => normalizedText($(element).text()))
    .filter(Boolean)
    .join("\n\n");
  return normalizedText(text || root.text());
}

export async function extractPublicArticle(
  inputUrl: string,
): Promise<{ title: string; content: string; url: string }> {
  const { html, finalUrl } = await fetchPublicHtml(inputUrl);
  const $ = load(html);

  const title =
    $('meta[property="og:title"]').attr("content")?.trim() ||
    $('meta[name="twitter:title"]').attr("content")?.trim() ||
    $("h1").first().text().trim() ||
    $("title").first().text().trim() ||
    new URL(finalUrl).hostname;

  $(
    "script, style, noscript, nav, footer, aside, form, iframe, svg, button, " +
    ".advertisement, .advert, .ads, .cookie-banner, .newsletter, .social-share, " +
    ".related-articles, .comments",
  ).remove();

  const candidates = [
    "article",
    '[itemprop="articleBody"]',
    "main",
    '[role="main"]',
    ".article-body",
    ".article-content",
    ".post-content",
    ".entry-content",
    "body",
  ];
  let content = "";
  for (const selector of candidates) {
    const root = $(selector).first();
    if (!root.length) continue;
    content = articleText($, root);
    if (content.length >= 100) break;
  }

  if (content.length < 100) {
    throw new ArticleExtractionError("Could not find article text on that page. Paste the text instead.");
  }

  return {
    title: normalizedText(title).slice(0, 200) || "Research article",
    content: content.slice(0, MAX_ARTICLE_LENGTH),
    url: finalUrl,
  };
}
