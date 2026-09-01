import { Router, type IRouter } from "express";
import {
  CancelPublishJobParams,
  CancelPublishJobResponse,
  CreatePublishJobBody,
  CreatePublishJobResponse,
  GetPublishJobParams,
  GetPublishJobResponse,
  ListPublishJobsQueryParams,
  ListPublishJobsResponse,
} from "@workspace/api-zod";
import { and, desc, eq } from "drizzle-orm";
import {
  articlesTable,
  db,
  publishJobsTable,
} from "@workspace/db";
import {
  requireUuid,
  sendError,
  sendValidationError,
} from "../lib/http";

const router: IRouter = Router();

router.get("/publish-jobs", async (req, res) => {
  const parsedQuery = ListPublishJobsQueryParams.safeParse(req.query);
  if (!parsedQuery.success) {
    sendValidationError(res, parsedQuery.error);
    return;
  }

  const { status, limit } = parsedQuery.data;
  const rows = await db
    .select()
    .from(publishJobsTable)
    .where(status ? eq(publishJobsTable.status, status) : undefined)
    .orderBy(desc(publishJobsTable.createdAt))
    .limit(limit);

  res.json(ListPublishJobsResponse.parse(rows));
});

router.post("/publish-jobs", async (req, res) => {
  const parsedBody = CreatePublishJobBody.safeParse(req.body);
  if (!parsedBody.success) {
    sendValidationError(res, parsedBody.error);
    return;
  }
  if (!requireUuid(res, parsedBody.data.articleId, "articleId")) return;

  const job = await db.transaction(async (tx) => {
    const [article] = await tx
      .select()
      .from(articlesTable)
      .where(eq(articlesTable.id, parsedBody.data.articleId))
      .limit(1);

    if (!article) return null;
    if (article.status !== "draft" && article.status !== "failed") {
      return "locked" as const;
    }

    const [createdJob] = await tx
      .insert(publishJobsTable)
      .values({
        articleId: article.id,
        target: parsedBody.data.target ?? "note",
        scheduledAt: parsedBody.data.scheduledAt ?? null,
      })
      .returning();

    await tx
      .update(articlesTable)
      .set({
        status: "queued",
        scheduledAt: parsedBody.data.scheduledAt ?? null,
        updatedAt: new Date(),
      })
      .where(eq(articlesTable.id, article.id));

    return createdJob;
  });

  if (job === null) {
    sendError(res, 404, "not_found", "Article not found");
    return;
  }
  if (job === "locked") {
    sendError(
      res,
      400,
      "article_locked",
      "Only draft or failed articles can be queued",
    );
    return;
  }

  res.status(201).json(CreatePublishJobResponse.parse(job));
});

router.get("/publish-jobs/:jobId", async (req, res) => {
  const parsedParams = GetPublishJobParams.safeParse(req.params);
  if (!parsedParams.success) {
    sendValidationError(res, parsedParams.error);
    return;
  }
  if (!requireUuid(res, parsedParams.data.jobId, "jobId")) return;

  const [job] = await db
    .select()
    .from(publishJobsTable)
    .where(eq(publishJobsTable.id, parsedParams.data.jobId))
    .limit(1);

  if (!job) {
    sendError(res, 404, "not_found", "Publish job not found");
    return;
  }

  res.json(GetPublishJobResponse.parse(job));
});

router.post("/publish-jobs/:jobId", async (req, res) => {
  const parsedParams = CancelPublishJobParams.safeParse(req.params);
  if (!parsedParams.success) {
    sendValidationError(res, parsedParams.error);
    return;
  }
  if (!requireUuid(res, parsedParams.data.jobId, "jobId")) return;

  const result = await db.transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(publishJobsTable)
      .where(eq(publishJobsTable.id, parsedParams.data.jobId))
      .limit(1);

    if (!job) return null;
    if (job.status !== "queued") return "locked" as const;

    const [cancelledJob] = await tx
      .update(publishJobsTable)
      .set({ status: "cancelled", finishedAt: new Date() })
      .where(
        and(
          eq(publishJobsTable.id, parsedParams.data.jobId),
          eq(publishJobsTable.status, "queued"),
        ),
      )
      .returning();

    await tx
      .update(articlesTable)
      .set({
        status: "draft",
        scheduledAt: null,
        updatedAt: new Date(),
      })
      .where(eq(articlesTable.id, job.articleId));

    return cancelledJob;
  });

  if (result === null) {
    sendError(res, 404, "not_found", "Publish job not found");
    return;
  }
  if (result === "locked") {
    sendError(
      res,
      400,
      "job_locked",
      "Only queued publishing jobs can be cancelled",
    );
    return;
  }

  res.json(CancelPublishJobResponse.parse(result));
});

export default router;