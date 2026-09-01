import {
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  boolean,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const articleStatusEnum = pgEnum("article_status", [
  "draft",
  "queued",
  "publishing",
  "published",
  "failed",
]);

export const publishJobStatusEnum = pgEnum("publish_job_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);

export const publishTargetEnum = pgEnum("publish_target", [
  "note",
  "hatena",
]);

export const articlesTable = pgTable("articles", {
  id: uuid("id").defaultRandom().primaryKey(),
  sourceDate: text("source_date").unique(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  hashtags: text("hashtags").array().notNull().default([]),
  status: articleStatusEnum("status").notNull().default("draft"),
  noteUrl: text("note_url"),
  publishedUrl: text("published_url"),
  imagePath: text("image_path"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const publishJobsTable = pgTable("publish_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  articleId: uuid("article_id")
    .notNull()
    .references(() => articlesTable.id, { onDelete: "cascade" }),
  status: publishJobStatusEnum("status").notNull().default("queued"),
  target: publishTargetEnum("target").notNull().default("note"),
  attempts: integer("attempts").notNull().default(0),
  errorMessage: text("error_message"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const publishSchedulesTable = pgTable("publish_schedules", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: text("slug").notNull().unique(),
  target: publishTargetEnum("target").notNull(),
  weekday: integer("weekday").notNull().default(0),
  publishHour: integer("publish_hour").notNull().default(7),
  publishMinute: integer("publish_minute").notNull().default(0),
  timeZone: text("time_zone").notNull().default("Asia/Tokyo"),
  topic: text("topic").notNull(),
  signature: text("signature").notNull(),
  active: boolean("active").notNull().default(true),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  lastOccurrenceDate: text("last_occurrence_date"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertArticleSchema = createInsertSchema(articlesTable);
export const insertPublishJobSchema = createInsertSchema(publishJobsTable);
export const insertPublishScheduleSchema = createInsertSchema(publishSchedulesTable);

export type Article = typeof articlesTable.$inferSelect;
export type PublishJob = typeof publishJobsTable.$inferSelect;
export type PublishSchedule = typeof publishSchedulesTable.$inferSelect;