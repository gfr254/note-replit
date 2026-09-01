import { and, eq, isNull, lt, ne, or } from "drizzle-orm";
import {
  articlesTable,
  db,
  publishJobsTable,
  publishSchedulesTable,
  type PublishSchedule,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { collectTopics } from "./collector";
import { generateArticle } from "./generator";

const pollIntervalMs = Math.max(
  15_000,
  Number(process.env["CONTENT_SCHEDULER_POLL_INTERVAL_MS"] ?? 30_000),
);

const retryAfterMs = 10 * 60 * 1_000;

const weeklyTopic =
  "空冷ビートルの歴史、維持、季節ごとの楽しみ方、部品選び、初心者向けの点検、オーナー同士の工夫を幅広く扱う";

const signature = "空冷かずひろです。空冷ビートルを楽しみましょう。";

function localParts(now: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(now)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return {
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
      parts.weekday,
    ),
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
  };
}

function isDue(schedule: PublishSchedule, now: Date) {
  const local = localParts(now, schedule.timeZone);

  if (local.weekday !== schedule.weekday) {
    return null;
  }

  if (
    local.hour < schedule.publishHour ||
    (local.hour === schedule.publishHour &&
      local.minute < schedule.publishMinute)
  ) {
    return null;
  }

  return local.date;
}

async function ensureSchedules() {
  await db
    .insert(publishSchedulesTable)
    .values({
      slug: "weekly-aircooled-beetle",
      target: "note",
      weekday: 0,
      publishHour: 7,
      publishMinute: 0,
      timeZone: "Asia/Tokyo",
      topic: weeklyTopic,
      signature,
    })
    .onConflictDoNothing({
      target: publishSchedulesTable.slug,
    });
}

async function claimSchedule(
  schedule: PublishSchedule,
  occurrenceDate: string,
  now: Date,
) {
  const [claimed] = await db
    .update(publishSchedulesTable)
    .set({
      lastAttemptAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(publishSchedulesTable.id, schedule.id),
        eq(publishSchedulesTable.active, true),
        or(
          isNull(publishSchedulesTable.lastOccurrenceDate),
          ne(
            publishSchedulesTable.lastOccurrenceDate,
            occurrenceDate,
          ),
        ),
        or(
          isNull(publishSchedulesTable.lastAttemptAt),
          lt(
            publishSchedulesTable.lastAttemptAt,
            new Date(now.getTime() - retryAfterMs),
          ),
        ),
      ),
    )
    .returning();

  return claimed ?? null;
}

async function queueGeneratedArticle(
  schedule: PublishSchedule,
  occurrenceDate: string,
  article: {
    title: string;
    body: string;
    hashtags: string[];
  },
) {
  await db.transaction(async (tx) => {
    let [existingArticle] = await tx
      .select()
      .from(articlesTable)
      .where(eq(articlesTable.sourceDate, occurrenceDate))
      .limit(1);

    if (!existingArticle) {
      [existingArticle] = await tx
        .insert(articlesTable)
        .values({
          sourceDate: occurrenceDate,
          title: article.title,
          body: article.body,
          hashtags: article.hashtags,
          status: "queued",
          scheduledAt: new Date(),
        })
        .returning();
    }

    const existingJobs = await tx
      .select({
        target: publishJobsTable.target,
      })
      .from(publishJobsTable)
      .where(eq(publishJobsTable.articleId, existingArticle.id));

    const existingTargets = new Set(
      existingJobs.map((job) => job.target),
    );

    if (
      existingArticle.status === "draft" ||
      existingArticle.status === "failed"
    ) {
      await tx
        .update(articlesTable)
        .set({
          status: "queued",
          scheduledAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(articlesTable.id, existingArticle.id));
    }

    for (const target of ["note", "hatena"] as const) {
      if (existingTargets.has(target)) {
        continue;
      }

      await tx.insert(publishJobsTable).values({
        articleId: existingArticle.id,
        target,
        scheduledAt: new Date(),
      });
    }
  });
}

async function processSchedule(
  schedule: PublishSchedule,
  now: Date,
) {
  const occurrenceDate = isDue(schedule, now);

  if (!occurrenceDate) {
    return false;
  }

  const claimed = await claimSchedule(
    schedule,
    occurrenceDate,
    now,
  );

  if (!claimed) {
    return false;
  }

  try {
    const sources = await collectTopics(schedule.topic);

    const article = await generateArticle({
      topic: schedule.topic,
      signature: schedule.signature,
      sources,
    });

    await queueGeneratedArticle(
      schedule,
      occurrenceDate,
      article,
    );

    await db
      .update(publishSchedulesTable)
      .set({
        lastOccurrenceDate: occurrenceDate,
        updatedAt: new Date(),
      })
      .where(eq(publishSchedulesTable.id, schedule.id));

    logger.info(
      {
        schedule: schedule.slug,
        occurrenceDate,
        sourceCount: sources.length,
      },
      "Weekly article queued",
    );

    return true;
  } catch (error) {
    logger.error(
      {
        schedule: schedule.slug,
        occurrenceDate,
        err: error,
      },
      "Weekly article generation failed; will retry",
    );

    return false;
  }
}

export async function runContentSchedulerOnce() {
  await ensureSchedules();

  const schedules = await db
    .select()
    .from(publishSchedulesTable)
    .where(eq(publishSchedulesTable.active, true));

  let processed = false;

  for (const schedule of schedules) {
    processed =
      (await processSchedule(schedule, new Date())) || processed;
  }

  return processed;
}

export function startContentScheduler() {
  let running = false;

  const tick = async () => {
    if (running) {
      return;
    }

    running = true;

    try {
      await runContentSchedulerOnce();
    } catch (error) {
      logger.error(
        { err: error },
        "Content scheduler poll failed",
      );
    } finally {
      running = false;
    }
  };

  void tick();

  const timer = setInterval(
    () => void tick(),
    pollIntervalMs,
  );

  timer.unref();

  logger.info(
    { pollIntervalMs },
    "Content scheduler started",
  );
}