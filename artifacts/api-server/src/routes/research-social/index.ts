import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import {
  CreateSourceBody,
  CreateSourceResponse,
  DeleteCampaignParams,
  DeleteSourceParams,
  ExtractArticleBody,
  ExtractArticleResponse,
  GenerateCampaignBody,
  GenerateCampaignResponse,
  GetDashboardResponse,
  ListCampaignsResponse,
  ListProvidersResponse,
  ListSourcesResponse,
  ReviewCampaignBody,
  ReviewCampaignParams,
  ReviewCampaignResponse,
  UpdateSourceBody,
  UpdateSourceParams,
  UpdateSourceResponse,
} from "@workspace/api-zod";
import {
  campaignsTable,
  db,
  sourcesTable,
  type Campaign,
  type PlatformDraft,
} from "@workspace/db";
import { generatePlatformDrafts, type ProviderId } from "../../lib/social-ai";
import {
  ArticleExtractionError,
  extractPublicArticle,
} from "../../lib/article-extractor";

const router: IRouter = Router();

const providerCosts: Record<
  ProviderId,
  { input: number; output: number }
> = {
  openai: { input: 0.1, output: 0.5 },
  anthropic: { input: 0.1, output: 0.5 },
  gemini: { input: 0.75, output: 3.75 },
};

const providerModels: Record<ProviderId, string> = {
  openai: "gpt-6-luna",
  anthropic: "claude-haiku-5-5",
  gemini: "gemini-3.8-flash",
};

const providers = [
  {
    id: "openai",
    name: "OpenAI",
    model: providerModels.openai,
    apiAccess: "Managed Replit AI Integration; no separate provider key required.",
    inputUsdPerMillion: providerCosts.openai.input,
    outputUsdPerMillion: providerCosts.openai.output,
    pricingUrl: "https://developers.openai.com/api/docs/pricing",
    note: "Rates shown are the current direct API reference. This app's managed calls are billed in Replit credits, not at these direct API rates.",
  },
  {
    id: "anthropic",
    name: "Claude",
    model: providerModels.anthropic,
    apiAccess: "Managed Replit AI Integration; no separate provider key required.",
    inputUsdPerMillion: providerCosts.anthropic.input,
    outputUsdPerMillion: providerCosts.anthropic.output,
    pricingUrl: "https://docs.anthropic.com/en/docs/about-claude/pricing",
    note: "Rates shown are the current direct API reference. This app's managed calls are billed in Replit credits, not at these direct API rates.",
  },
  {
    id: "gemini",
    name: "Gemini",
    model: providerModels.gemini,
    apiAccess: "Managed Replit AI Integration; no separate provider key required.",
    inputUsdPerMillion: providerCosts.gemini.input,
    outputUsdPerMillion: providerCosts.gemini.output,
    pricingUrl: "https://ai.google.dev/gemini-api/docs/pricing",
    note: "Introductory direct API pricing shown through Dec 31, 2026; rates may change. This app's managed calls are billed in Replit credits.",
  },
  {
    id: "copilot",
    name: "Microsoft Copilot",
    model: "Microsoft 365 Copilot APIs",
    apiAccess: "Not wired: no supported direct app API integration was found.",
    inputUsdPerMillion: null,
    outputUsdPerMillion: null,
    pricingUrl:
      "https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/cost-considerations",
    note: "Microsoft documents licensed-user requirements for its Copilot APIs. Licensing is not directly comparable to per-token API pricing.",
  },
];

function mapCampaign(
  campaign: Campaign,
  sourceTitle: string,
): Record<string, unknown> {
  return {
    ...campaign,
    sourceTitle,
    outputs: campaign.outputs as PlatformDraft[],
  };
}

async function findCampaign(id: number): Promise<Record<string, unknown> | null> {
  const [row] = await db
    .select({ campaign: campaignsTable, sourceTitle: sourcesTable.title })
    .from(campaignsTable)
    .innerJoin(sourcesTable, eq(campaignsTable.sourceId, sourcesTable.id))
    .where(eq(campaignsTable.id, id));
  return row ? mapCampaign(row.campaign, row.sourceTitle) : null;
}

router.get("/sources", async (_req, res): Promise<void> => {
  const sources = await db
    .select()
    .from(sourcesTable)
    .orderBy(desc(sourcesTable.createdAt));
  res.json(ListSourcesResponse.parse(sources));
});

router.post("/sources/extract", async (req, res): Promise<void> => {
  const parsed = ExtractArticleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const article = await extractPublicArticle(parsed.data.url);
    res.json(ExtractArticleResponse.parse(article));
  } catch (error) {
    if (error instanceof ArticleExtractionError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    req.log.error({ err: error }, "Article link extraction failed");
    res.status(502).json({
      error: "Could not read that page. Paste the article text instead.",
    });
  }
});

router.post("/sources", async (req, res): Promise<void> => {
  const parsed = CreateSourceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [source] = await db
    .insert(sourcesTable)
    .values({
      title: parsed.data.title.trim(),
      content: parsed.data.content.trim(),
      sourceUrl: parsed.data.sourceUrl ?? null,
    })
    .returning();
  res.status(201).json(CreateSourceResponse.parse(source));
});

router.patch("/sources/:id", async (req, res): Promise<void> => {
  const params = UpdateSourceParams.safeParse(req.params);
  const body = UpdateSourceBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const changes = { ...body.data };
  if (typeof changes.title === "string") changes.title = changes.title.trim();
  if (typeof changes.content === "string") changes.content = changes.content.trim();
  const [source] = await db
    .update(sourcesTable)
    .set(changes)
    .where(eq(sourcesTable.id, params.data.id))
    .returning();
  if (!source) {
    res.status(404).json({ error: "Source not found" });
    return;
  }
  res.json(UpdateSourceResponse.parse(source));
});

router.delete("/sources/:id", async (req, res): Promise<void> => {
  const params = DeleteSourceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [source] = await db
    .delete(sourcesTable)
    .where(eq(sourcesTable.id, params.data.id))
    .returning();
  if (!source) {
    res.status(404).json({ error: "Source not found" });
    return;
  }
  res.sendStatus(204);
});

router.get("/campaigns", async (_req, res): Promise<void> => {
  const rows = await db
    .select({ campaign: campaignsTable, sourceTitle: sourcesTable.title })
    .from(campaignsTable)
    .innerJoin(sourcesTable, eq(campaignsTable.sourceId, sourcesTable.id))
    .orderBy(desc(campaignsTable.createdAt));
  res.json(
    ListCampaignsResponse.parse(
      rows.map((row) => mapCampaign(row.campaign, row.sourceTitle)),
    ),
  );
});

router.post("/campaigns/generate", async (req, res): Promise<void> => {
  const parsed = GenerateCampaignBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [source] = await db
    .select()
    .from(sourcesTable)
    .where(eq(sourcesTable.id, parsed.data.sourceId));
  if (!source) {
    res.status(404).json({ error: "Source not found" });
    return;
  }

  try {
    const result = await generatePlatformDrafts({
      title: source.title,
      content: source.content,
      sourceUrl: source.sourceUrl,
      provider: parsed.data.provider as ProviderId,
      platforms: parsed.data.platforms as Parameters<
        typeof generatePlatformDrafts
      >[0]["platforms"],
      tone: parsed.data.tone,
      audience: parsed.data.audience,
      campaignGoal: parsed.data.campaignGoal,
    });
    const prices = providerCosts[parsed.data.provider as ProviderId];
    const estimatedCostUsd =
      (result.inputTokens * prices.input + result.outputTokens * prices.output) /
      1_000_000;
    const [campaign] = await db
      .insert(campaignsTable)
      .values({
        sourceId: source.id,
        provider: parsed.data.provider,
        model: result.model,
        status: "needs_review",
        tone: parsed.data.tone,
        platforms: parsed.data.platforms,
        outputs: result.drafts,
        estimatedCostUsd,
      })
      .returning();
    res
      .status(201)
      .json(GenerateCampaignResponse.parse(mapCampaign(campaign, source.title)));
  } catch (error) {
    req.log.error({ err: error }, "AI campaign generation failed");
    res.status(502).json({
      error:
        error instanceof Error
          ? error.message
          : "Campaign generation failed. Please try again.",
    });
  }
});

router.patch("/campaigns/:id", async (req, res): Promise<void> => {
  const params = ReviewCampaignParams.safeParse(req.params);
  const body = ReviewCampaignBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const updates: Partial<typeof campaignsTable.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (body.data.status) updates.status = body.data.status;
  if (body.data.outputs) {
    updates.outputs = body.data.outputs;
    if (!body.data.status) updates.status = "needs_review";
  }

  await db
    .update(campaignsTable)
    .set(updates)
    .where(eq(campaignsTable.id, params.data.id));
  const campaign = await findCampaign(params.data.id);
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  res.json(ReviewCampaignResponse.parse(campaign));
});

router.delete("/campaigns/:id", async (req, res): Promise<void> => {
  const params = DeleteCampaignParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [campaign] = await db
    .delete(campaignsTable)
    .where(eq(campaignsTable.id, params.data.id))
    .returning();
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  res.sendStatus(204);
});

router.get("/dashboard", async (_req, res): Promise<void> => {
  const sources = await db.select({ id: sourcesTable.id }).from(sourcesTable);
  const campaigns = await db
    .select({ campaign: campaignsTable, sourceTitle: sourcesTable.title })
    .from(campaignsTable)
    .innerJoin(sourcesTable, eq(campaignsTable.sourceId, sourcesTable.id))
    .orderBy(desc(campaignsTable.createdAt));
  const recentCampaigns = campaigns
    .slice(0, 5)
    .map((row) => mapCampaign(row.campaign, row.sourceTitle));
  const summary = {
    sourceCount: sources.length,
    campaignCount: campaigns.length,
    needsReviewCount: campaigns.filter(
      (row) => row.campaign.status === "needs_review",
    ).length,
    approvedCount: campaigns.filter(
      (row) => row.campaign.status === "approved",
    ).length,
    recentCampaigns,
  };
  res.json(GetDashboardResponse.parse(summary));
});

router.get("/providers", (_req, res): void => {
  res.json(ListProvidersResponse.parse(providers));
});

export default router;
