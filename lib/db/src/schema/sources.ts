import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const sourcesTable = pgTable("research_sources", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  sourceUrl: text("source_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSourceSchema = createInsertSchema(sourcesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertSource = z.infer<typeof insertSourceSchema>;
export type ContentSource = typeof sourcesTable.$inferSelect;
