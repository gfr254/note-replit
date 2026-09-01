import { Router, type IRouter } from "express";
import {
  CreateArticleBody,
  CreateArticleResponse,
  DeleteArticleParams,
  GetArticleParams,
  GetArticleResponse,
  ListArticlesQueryParams,
  ListArticlesResponse,
  UpdateArticleBody,
  UpdateArticleParams,
  UpdateArticleResponse,
} from "@workspace/api-zod";
import { and, desc, eq } from "drizzle-orm";
import { articlesTable, db } from "@workspace/db";
import {
  requireUuid,
  sendError,
  sendValidationError,
} from "../lib/http";

const router: IRouter = Router();

router.get("/articles", async (req, res) => {
  const parsedQuery = ListArticlesQueryParams.safeParse(req.query);
  if (!parsedQuery.success) {
    sendValidationError(res, parsedQuery.error);
    return;
  }

  const { status, limit } = parsedQuery.data;
  const rows = await db
    .select()
    .from(articlesTable)
    .where(status ? eq(articlesTable.status, status) : undefined)
    .orderBy(desc(articlesTable.createdAt))
    .limit(limit);

  res.json(ListArticlesResponse.parse(rows));
});

router.post("/articles", async (req, res) => {
  const parsedBody = CreateArticleBody.safeParse(req.body);
  if (!parsedBody.success) {
    sendValidationError(res, parsedBody.error);
    return;
  }

  const [article] = await db
    .insert(articlesTable)
    .values({
      title: parsedBody.data.title,
      body: parsedBody.data.body,
      hashtags: parsedBody.data.hashtags ?? [],
    })
    .returning();

  res.status(201).json(CreateArticleResponse.parse(article));
});

router.get("/articles/:articleId", async (req, res) => {
  const parsedParams = GetArticleParams.safeParse(req.params);
  if (!parsedParams.success) {
    sendValidationError(res, parsedParams.error);
    return;
  }
  if (!requireUuid(res, parsedParams.data.articleId, "articleId")) return;

  const [article] = await db
    .select()
    .from(articlesTable)
    .where(eq(articlesTable.id, parsedParams.data.articleId))
    .limit(1);

  if (!article) {
    sendError(res, 404, "not_found", "Article not found");
    return;
  }

  res.json(GetArticleResponse.parse(article));
});

router.patch("/articles/:articleId", async (req, res) => {
  const parsedParams = UpdateArticleParams.safeParse(req.params);
  const parsedBody = UpdateArticleBody.safeParse(req.body);
  if (!parsedParams.success) {
    sendValidationError(res, parsedParams.error);
    return;
  }
  if (!parsedBody.success) {
    sendValidationError(res, parsedBody.error);
    return;
  }
  if (!requireUuid(res, parsedParams.data.articleId, "articleId")) return;

  if (Object.keys(parsedBody.data).length === 0) {
    sendError(res, 400, "validation_error", "At least one field is required");
    return;
  }

  const [existing] = await db
    .select({ status: articlesTable.status })
    .from(articlesTable)
    .where(eq(articlesTable.id, parsedParams.data.articleId))
    .limit(1);

  if (!existing) {
    sendError(res, 404, "not_found", "Article not found");
    return;
  }
  if (existing.status !== "draft" && existing.status !== "failed") {
    sendError(
      res,
      400,
      "article_locked",
      "Only draft or failed articles can be edited",
    );
    return;
  }

  const [article] = await db
    .update(articlesTable)
    .set({
      ...parsedBody.data,
      updatedAt: new Date(),
    })
    .where(eq(articlesTable.id, parsedParams.data.articleId))
    .returning();

  res.json(UpdateArticleResponse.parse(article));
});

router.delete("/articles/:articleId", async (req, res) => {
  const parsedParams = DeleteArticleParams.safeParse(req.params);
  if (!parsedParams.success) {
    sendValidationError(res, parsedParams.error);
    return;
  }
  if (!requireUuid(res, parsedParams.data.articleId, "articleId")) return;

  const deleted = await db
    .delete(articlesTable)
    .where(
      and(
        eq(articlesTable.id, parsedParams.data.articleId),
        eq(articlesTable.status, "draft"),
      ),
    )
    .returning({ id: articlesTable.id });

  if (deleted.length === 0) {
    const [article] = await db
      .select({ id: articlesTable.id, status: articlesTable.status })
      .from(articlesTable)
      .where(eq(articlesTable.id, parsedParams.data.articleId))
      .limit(1);

    if (!article) {
      sendError(res, 404, "not_found", "Article not found");
    } else {
      sendError(
        res,
        400,
        "article_locked",
        "Only draft articles can be deleted",
      );
    }
    return;
  }

  res.status(204).send();
});

export default router;