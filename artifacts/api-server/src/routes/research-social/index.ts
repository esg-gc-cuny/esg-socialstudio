import { Router, type IRouter } from "express";
import {
  ExtractArticleBody,
  ExtractArticleResponse,
  GenerateCampaignBody,
  GenerateCampaignResponse,
  ListProvidersResponse,
} from "@workspace/api-zod";
import { generatePlatformDrafts, type ProviderId } from "../../lib/social-ai";
import { ArticleExtractionError, extractPublicArticle } from "../../lib/article-extractor";

const providerCosts: Record<ProviderId, { input: number; output: number }> = {
  openai: { input: 0.1, output: 0.5 },
  anthropic: { input: 0.1, output: 0.5 },
  gemini: { input: 0.75, output: 3.75 },
};

type Services = {
  generate: typeof generatePlatformDrafts;
  extract: typeof extractPublicArticle;
};

// Request-local processing only: no database, file storage, or shared memory.
export function createResearchSocialRouter(
  services: Services = { generate: generatePlatformDrafts, extract: extractPublicArticle },
): IRouter {
  const router = Router();

  router.post("/sources/extract", async (req, res): Promise<void> => {
    const parsed = ExtractArticleBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      res.json(ExtractArticleResponse.parse(await services.extract(parsed.data.url)));
    } catch (error) {
      if (error instanceof ArticleExtractionError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      req.log.error({ err: error }, "Article link extraction failed");
      res.status(502).json({ error: "Could not read that page. Paste the article text instead." });
    }
  });

  router.post("/campaigns/generate", async (req, res): Promise<void> => {
    const parsed = GenerateCampaignBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { source, provider, platforms, tone, generateHashtags, audience, campaignGoal } = parsed.data;
    try {
      const result = await services.generate({
        title: source.title,
        content: source.content,
        sourceUrl: source.sourceUrl ?? null,
        provider,
        platforms,
        tone,
        generateHashtags: generateHashtags ?? true,
        audience,
        campaignGoal,
      });
      const prices = providerCosts[provider];
      const timestamp = new Date().toISOString();
      res.status(201).json(GenerateCampaignResponse.parse({
        // A transient UI key, not a saved record identifier.
        id: Date.now(),
        sourceTitle: source.title,
        provider,
        model: result.model,
        status: "needs_review",
        tone,
        platforms,
        outputs: result.drafts,
        estimatedCostUsd: (result.inputTokens * prices.input + result.outputTokens * prices.output) / 1_000_000,
        createdAt: timestamp,
        updatedAt: timestamp,
      }));
    } catch (error) {
      req.log.error({ err: error }, "AI post generation failed");
      res.status(502).json({
        error: error instanceof Error ? error.message : "Post generation failed. Please try again.",
      });
    }
  });

  router.get("/providers", (_req, res): void => {
    res.json(ListProvidersResponse.parse([{
      id: "anthropic",
      name: "Claude",
      model: "claude-haiku-5-5",
      apiAccess: "Direct Anthropic API using the server-side ANTHROPIC_API_KEY.",
      inputUsdPerMillion: providerCosts.anthropic.input,
      outputUsdPerMillion: providerCosts.anthropic.output,
      pricingUrl: "https://docs.anthropic.com/en/docs/about-claude/pricing",
      note: "Direct API charges are billed by Anthropic. Prices are estimates.",
    }]));
  });

  // Make old clients fail explicitly rather than pretending to save anything.
  router.all(
    ["/sources", "/sources/:id", "/campaigns", "/campaigns/:id", "/dashboard"],
    (_req, res): void => {
      res.status(410).json({ error: "Saved articles and post history are no longer supported. Drafts stay in the current tab only." });
    },
  );
  return router;
}

export default createResearchSocialRouter();
