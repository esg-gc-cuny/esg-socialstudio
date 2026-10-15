import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildIndependentPlatformPrompt,
  platformEditorialBriefs,
  type EditorialSource,
  type SocialPlatform,
} from "../config/platform-editorial-prompts";
import { generateIndependentPosts, parseIndependentPost } from "./platform-post-generation";

const byline = "Ada Reed and Ben Orr";
const fact = "New York City's employment has recovered since 2020.";
const context = "Jobs grow at different rates across industries.";
const source: EditorialSource = {
  title: "The New York Employment Picture",
  content: `${byline}\n${fact}\n${context}\nHealth care employment has grown faster than retail.`,
  sourceUrl: "https://example.org/employment",
  generateHashtags: true,
};
const platforms: SocialPlatform[] = ["linkedin", "facebook", "bluesky", "substack"];

function response(platform: SocialPlatform = "linkedin") {
  if (platform === "bluesky") {
    return {
      authors: ["Ada Reed", "Ben Orr"], author_evidence: byline,
      sentences: [{
        role: "invitation",
        text: "Explore Reed and Orr's view of New York City's uneven jobs recovery.",
        evidence: [fact, context],
      }],
      hashtags: [
        { tag: "#Employment", evidence: fact },
        { tag: "#LaborMarket", evidence: context },
      ],
    };
  }
  return {
    authors: ["Ada Reed", "Ben Orr"],
    author_evidence: byline,
    sentences: [
      { role: "hook", text: "New York City's jobs are back, but growth is uneven.", evidence: [fact, context] },
      {
        role: "invitation",
        text: "Explore Ada Reed and Ben Orr's analysis of uneven employment growth.",
        evidence: [context],
      },
    ],
    hashtags: [
      { tag: "#Employment", evidence: fact },
      { tag: "#employment", evidence: fact },
      { tag: "#LaborMarket", evidence: context },
      { tag: "#Bitcoin", evidence: context },
    ],
  };
}

test("four platforms have distinct audiences, writing briefs, and hashtag instructions", () => {
  const prompts = platforms.map((platform) => buildIndependentPlatformPrompt(platform, source));
  assert.equal(new Set(prompts).size, 4);
  for (const prompt of prompts) {
    assert.match(prompt, /Audience:/);
    assert.match(prompt, /VOICE AND WORDS/);
    assert.match(prompt, /HOOK CHOICE/);
    assert.match(prompt, /HASHTAGS/);
    assert.match(prompt, /third-person/i);
    assert.match(prompt, /source is the only factual authority/i);
    assert.ok(prompt.includes(source.content));
    assert.match(prompt, /question is optional/i);
  }
});

test("one successful request per platform, without shared analysis or rewrite requests", async () => {
  const calls: string[] = [];
  const result = await generateIndependentPosts({ ...source, platforms }, async (prompt) => {
    calls.push(prompt);
    const platform = platforms.find((id) => prompt.startsWith(platformEditorialBriefs[id].prompt))!;
    return { text: JSON.stringify(response(platform)), inputTokens: 100, outputTokens: 50 };
  });
  assert.equal(calls.length, 4);
  assert.equal(result.drafts.length, 4);
  assert.equal(result.inputTokens, 400);
  assert.equal(result.outputTokens, 200);
  assert.deepEqual(result.drafts.map((draft) => draft.platform), platforms);
});

test("tags are deduplicated and grounded, separate from body, and CTA is last", () => {
  const draft = parseIndependentPost(JSON.stringify(response()), "linkedin", source);
  assert.deepEqual(draft.hashtags, ["#Employment", "#LaborMarket"]);
  assert.ok(!draft.content.includes("#"));
  assert.ok(draft.content.endsWith(`Read the full article on our website: ${source.sourceUrl}`));
  const [body, cta] = draft.content.split("\n\nRead the full article");
  assert.equal(draft.characterCount,
    [body, draft.hashtags.join(" "), `Read the full article${cta}`].join("\n\n").length);
});

test("hashtag toggle returns none even if the model ignores it", () => {
  assert.deepEqual(parseIndependentPost(JSON.stringify(response()), "linkedin",
    { ...source, generateHashtags: false }).hashtags, []);
});

test("editorial wording does not block a source-grounded batch", () => {
  const data = response();
  data.sentences[1].text = "Ada Reed and Ben Orr examine employment growth.";
  assert.match(parseIndependentPost(JSON.stringify(data), "linkedin", source).content, /Ada Reed and Ben Orr/);
});

test("rejects first-person voice, unsupported evidence, fabricated numbers, and invented authors", () => {
  const cases: Array<[string, (data: ReturnType<typeof response>) => void, RegExp]> = [
    ["first person", (data) => { data.sentences[1].text = "Explore our view of uneven employment growth."; }, /third-person/],
    ["unsupported evidence", (data) => { data.sentences[0].evidence = ["This quote does not exist."]; }, /exact source/],
    ["fabricated number", (data) => { data.sentences[0].text = "Employment has grown by 99 percent."; }, /not present in the source/],
    ["invented byline", (data) => { data.authors = ["Invented Person"]; }, /verified by an exact byline/],
    ["detached voice", (data) => { data.sentences[0].text = "The article explores uneven growth."; }, /detached document/],
  ];
  for (const [label, mutate, expected] of cases) {
    const data = response();
    mutate(data);
    assert.throws(() => parseIndependentPost(JSON.stringify(data), "linkedin", source), expected, label);
  }
});

test("only the invalid platform gets one repair request", async () => {
  const counts = new Map<string, number>();
  const result = await generateIndependentPosts({ ...source, platforms }, async (prompt) => {
    const platform = platforms.find((id) => prompt.startsWith(platformEditorialBriefs[id].prompt))!;
    const count = (counts.get(platform) ?? 0) + 1;
    counts.set(platform, count);
    const data = response(platform);
    if (platform === "facebook" && count === 1) data.sentences[1].evidence = ["This evidence does not exist in the source."];
    return { text: JSON.stringify(data), inputTokens: 10, outputTokens: 5 };
  });
  assert.equal(counts.get("facebook"), 2);
  assert.equal(counts.get("linkedin"), 1);
  assert.equal(counts.get("bluesky"), 1);
  assert.equal(counts.get("substack"), 1);
  assert.equal(result.inputTokens, 50);
});

test("Bluesky drops optional tags rather than truncating body or link", () => {
  const data = response("bluesky");
  const withoutTags = parseIndependentPost(JSON.stringify({ ...data, hashtags: [] }), "bluesky", source);
  const extra = 300 - withoutTags.characterCount;
  const draft = parseIndependentPost(JSON.stringify(data), "bluesky",
    { ...source, sourceUrl: `${source.sourceUrl}${"x".repeat(extra)}` });
  assert.equal(draft.characterCount, 300);
  assert.deepEqual(draft.hashtags, []);
  assert.match(draft.content, /Explore Reed and Orr/);
  assert.throws(() => parseIndependentPost(JSON.stringify(data), "bluesky",
    { ...source, sourceUrl: `${source.sourceUrl}${"x".repeat(extra + 1)}` }), /Rewrite complete sentences/);
});

test("an invitation can naturally follow context or share the opening sentence", () => {
  const data = response();
  data.sentences[1].role = "context";
  data.sentences[1].text = "Ada Reed and Ben Orr examine uneven job growth, so explore the differences across industries.";
  assert.match(parseIndependentPost(JSON.stringify(data), "facebook", source).content, /so explore/);
});

test("disabled platforms and duplicate selections fail before any model calls", async () => {
  const request = async () => { throw new Error("Should not call model."); };
  await assert.rejects(generateIndependentPosts({ ...source, platforms: ["x"] }, request), /Unsupported social platform/);
  await assert.rejects(generateIndependentPosts({ ...source, platforms: ["linkedin", "linkedin"] }, request), /distinct platform/);
});

test("a numerical repair explicitly removes inferred figures instead of weakening grounding", async () => {
  let calls = 0;
  await generateIndependentPosts({ ...source, platforms: ["linkedin"] }, async (prompt) => {
    calls++;
    const data = response();
    if (calls === 1) data.sentences[0].text = "Employment has grown by 99 percent.";
    else {
      assert.match(prompt, /NO digits, statistics, or inferred dates/);
      assert.match(prompt, /Numeric value\(s\) 99/);
    }
    return { text: JSON.stringify(data), inputTokens: 1, outputTokens: 1 };
  });
  assert.equal(calls, 2);
});

test("voice repair names the offending pronoun and places corrections after the invalid draft", async () => {
  let calls = 0;
  await generateIndependentPosts({ ...source, platforms: ["linkedin"] }, async (prompt) => {
    calls++;
    const data = response();
    if (calls === 1) data.sentences[0].text = "Our employment figures show uneven growth.";
    else {
      assert.match(prompt, /VOICE REPAIR/);
      assert.match(prompt, /body: Our/);
      assert.ok(prompt.indexOf("Previous response") < prompt.lastIndexOf("VOICE REPAIR"));
      assert.ok(prompt.endsWith("not the previous draft."));
    }
    return { text: JSON.stringify(data), inputTokens: 1, outputTokens: 1 };
  });
  assert.equal(calls, 2);
});

test("related-post footers cannot supply evidence or dates for the selected article", async () => {
  await generateIndependentPosts({
    ...source, platforms: ["linkedin"],
    content: `${source.content}\nRelated Posts\nUnrelated policy in 2045.`,
  }, async (prompt) => {
    assert.ok(!prompt.includes("Unrelated policy in 2045"));
    return { text: JSON.stringify(response()), inputTokens: 1, outputTokens: 1 };
  });
});
