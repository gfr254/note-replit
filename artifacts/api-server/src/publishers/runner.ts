import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { articlesTable, db, publishJobsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { publishToHatena } from "./hatena";
import { publishToNote } from "./note";
import type { PublishContext, Publisher } from "./types";

const pollIntervalMs = Math.max(
  5_000,
  Number(process.env["PUBLISHER_POLL_INTERVAL_MS"] ?? 30_000),
);

function publisherFor(target: "note" | "hatena"): Publisher {
  return target === "hatena" ? publishToHatena : publishToNote;
}

async function claimNextJob() {
  const now = new Date();
  return db.transaction(async (tx) => {
    const [candidate] = await tx
      .select({
        job: publishJobsTable,
        article: articlesTable,
      })
      .from(publishJobsTable)
      .innerJoin(articlesTable, eq(articlesTable.id, publishJobsTable.articleId))
      .where(
        and(
          eq(publishJobsTable.status, "queued"),
          or(isNull(publishJobsTable.scheduledAt), lte(publishJobsTable.scheduledAt, now)),
        ),
      )
      .orderBy(asc(publishJobsTable.createdAt))
      .limit(1);

    if (!candidate) return null;

    const [job] = await tx
      .update(publishJobsTable)
      .set({
        status: "running",
        attempts: sql`${publishJobsTable.attempts} + 1`,
        startedAt: now,
        errorMessage: null,
      })
      .where(
        and(
          eq(publishJobsTable.id, candidate.job.id),
          eq(publishJobsTable.status, "queued"),
        ),
      )
      .returning();

    if (!job) return null;

    const [article] = await tx
      .update(articlesTable)
      .set({ status: "publishing", updatedAt: now })
      .where(
        and(
          eq(articlesTable.id, candidate.article.id),
          eq(articlesTable.status, "queued"),
        ),
      )
      .returning();

    return {
      job,
      article: article ?? candidate.article,
    };
  });
}

async function finishJob(
  context: PublishContext,
  result: { publishedUrl: string },
) {
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(publishJobsTable)
      .set({ status: "succeeded", finishedAt: now, errorMessage: null })
      .where(eq(publishJobsTable.id, context.job.id));
    await tx
      .update(articlesTable)
      .set({
        status: "published",
        publishedUrl: result.publishedUrl,
        noteUrl: context.job.target === "note" ? result.publishedUrl : null,
        publishedAt: now,
        updatedAt: now,
      })
      .where(eq(articlesTable.id, context.article.id));
  });
}

async function failJob(context: PublishContext, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(publishJobsTable)
      .set({ status: "failed", finishedAt: now, errorMessage: message.slice(0, 2_000) })
      .where(eq(publishJobsTable.id, context.job.id));
    await tx
      .update(articlesTable)
      .set({ status: "failed", updatedAt: now })
      .where(eq(articlesTable.id, context.article.id));
  });
  logger.error({ jobId: context.job.id, target: context.job.target, err: message }, "Publish job failed");
}

export async function runPublisherOnce() {
  const claimed = await claimNextJob();
  if (!claimed) return false;

  const context: PublishContext = claimed;
  try {
    const result = await publisherFor(context.job.target)(context);
    await finishJob(context, result);
    logger.info(
      { jobId: context.job.id, articleId: context.article.id, target: context.job.target },
      "Publish job succeeded",
    );
  } catch (error) {
    await failJob(context, error);
  }
  return true;
}

export function startPublisher() {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      while (await runPublisherOnce()) {
        // Drain all jobs that are already due before waiting for the next poll.
      }
    } catch (error) {
      logger.error({ err: error }, "Publisher poll failed");
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), pollIntervalMs);
  timer.unref();
  logger.info({ pollIntervalMs }, "Publisher started");
}