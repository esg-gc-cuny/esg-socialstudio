import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import express from "express";
import pino from "pino";
import pinoHttp from "pino-http";
import { ExtractArticleResponse, GenerateCampaignResponse } from "@workspace/api-zod";
import { createResearchSocialRouter } from "./index";

test("paste, link, validation, retry, and retired storage routes are stateless", async () => {
  const calls: unknown[] = [];
  let fail = false;
  const app = express();
  app.use(express.json());
  app.use(pinoHttp({ logger: pino({ enabled: false }) }));
  app.use("/api", createResearchSocialRouter({
    extract: async (url) => ({
      url,
      title: "Local employment",
      content: "By Alex Smith. Employment growth differs across industries.",
    }),
    generate: async (context) => {
      calls.push(context);
      if (fail) throw new Error("Temporary provider failure. Try again.");
      return {
        model: "test-claude",
        inputTokens: 100,
        outputTokens: 50,
        drafts: context.platforms.map((platform) => ({
          platform,
          content: `Which industries are driving employment growth? Alex Smith examines the differences.\n\nRead the full article on our website: ${context.sourceUrl}`,
          hashtags: context.generateHashtags ? ["#Employment", "#Economics"] : [],
          characterCount: 180,
          characterLimit: platform === "bluesky" ? 300 : 3000,
        })),
      };
    },
  }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}/api`;
  const post = (route: string, body: unknown) => fetch(`${base}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const source = {
    title: "Employment",
    content: "By Alex Smith. Employment growth differs across industries.",
    sourceUrl: "https://example.org/employment",
  };
  const settings = {
    provider: "anthropic",
    platforms: ["linkedin", "facebook", "bluesky", "substack"],
    tone: "Professional and inviting",
    generateHashtags: false,
  };
  try {
    const generated = await post("/campaigns/generate", { source, ...settings });
    assert.equal(generated.status, 201);
    const result = GenerateCampaignResponse.parse(await generated.json());
    assert.equal(result.sourceTitle, source.title);
    assert.equal(result.sourceId, undefined);
    assert.equal(result.outputs.length, 4);
    assert.ok(result.outputs.every((draft: { hashtags: string[] }) => draft.hashtags.length === 0));

    const extraction = await post("/sources/extract", { url: source.sourceUrl });
    assert.equal(extraction.status, 200);
    const article = ExtractArticleResponse.parse(await extraction.json());
    const linked = await post("/campaigns/generate", {
      ...settings, generateHashtags: true,
      source: { title: article.title, content: article.content, sourceUrl: article.url },
    });
    assert.equal(linked.status, 201);
    assert.equal(GenerateCampaignResponse.parse(await linked.json()).sourceTitle, article.title);

    assert.equal((await post("/campaigns/generate", { sourceId: 1, ...settings })).status, 400);
    assert.equal((await post("/campaigns/generate", { source: { ...source, content: "short" }, ...settings })).status, 400);
    assert.equal(calls.length, 2);
    for (const route of ["/sources", "/campaigns", "/dashboard"]) {
      assert.equal((await fetch(`${base}${route}`)).status, 410);
    }
    const patch = await fetch(`${base}/campaigns/1`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    assert.equal(patch.status, 410);

    fail = true;
    const failed = await post("/campaigns/generate", { source, ...settings });
    assert.equal(failed.status, 502);
    const error = await failed.json() as { error: string };
    assert.match(error.error, /Temporary provider failure/);
    fail = false;
    assert.equal((await post("/campaigns/generate", { source, ...settings })).status, 201);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
