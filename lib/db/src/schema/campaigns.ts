import {
  integer,
  jsonb,
  pgTable,
  real,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sourcesTable } from "./sources";

export type PlatformDraft = {
  platform: string;
  content: string;
  hashtags: string[];
  characterCount: number;
  characterLimit: number;
};

export const campaignsTable = pgTable("social_campaigns", {
  id: serial("id").primaryKey(),
  sourceId: integer("source_id")
    .notNull()
    .references(() => sourcesTable.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  status: text("status").notNull().default("needs_review"),
  tone: text("tone").notNull(),
  platforms: text("platforms").array().notNull(),
  outputs: jsonb("outputs").$type<PlatformDraft[]>().notNull(),
  estimatedCostUsd: real("estimated_cost_usd").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCampaignSchema = createInsertSchema(campaignsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCampaign = z.infer<typeof insertCampaignSchema>;
export type Campaign = typeof campaignsTable.$inferSelect;
