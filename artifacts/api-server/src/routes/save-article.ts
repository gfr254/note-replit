import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Router, type IRouter } from "express";
import {
  SaveArticleBody,
  SaveArticleResponse,
} from "@workspace/api-zod";
import { eq } from "drizzle-orm";
import { articlesTable, db } from "@workspace/db";
import { sendError, sendValidationError } from "../lib/http";
import { requireSaveArticleApiKey } from "../lib/api-key";

const router: IRouter = Router();
const maxImageBytes = 8 * 1024 * 1024;

function isValidCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function decodeBase64Image(value: string) {
  const payload = value.replace(/^data:image\/png;base64,/, "");
  if (
    payload.length === 0 ||
    payload.length % 4 === 1 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(payload)
  ) {
    throw new Error("image must be valid base64 data");
  }

  const image = Buffer.from(payload, "base64");
  if (image.length === 0 || image.length > maxImageBytes) {
    throw new Error("image must be between 1 byte and 8 MB");
  }
  return image;
}

router.post("/saveArticle", requireSaveArticleApiKey, async (req, res) => {
  const parsedBody = SaveArticleBody.safeParse(req.body);
  if (!parsedBody.success) {
    sendValidationError(res, parsedBody.error);
    return;
  }

  const { date, title, body, image } = parsedBody.data;
  if (!isValidCalendarDate(date)) {
    sendError(res, 400, "invalid_date", "date must be a valid YYYY-MM-DD date");
    return;
  }

  let imageBuffer: Buffer | undefined;
  try {
    if (image) imageBuffer = decodeBase64Image(image);
  } catch (error) {
    sendError(
      res,
      400,
      "invalid_image",
      error instanceof Error ? error.message : "image must be valid base64 data",
    );
    return;
  }

  const [existing] = await db
    .select()
    .from(articlesTable)
    .where(eq(articlesTable.sourceDate, date))
    .limit(1);

  if (existing && existing.status !== "draft" && existing.status !== "failed") {
    sendError(
      res,
      400,
      "article_locked",
      "Only draft or failed articles can be overwritten",
    );
    return;
  }

  const articleDirectory = path.resolve(
    process.env["ARTICLES_DATA_DIR"] ?? path.join(process.cwd(), "data", "articles"),
  );
  const markdownPath = path.join(articleDirectory, `${date}.md`);
  const imagePath = path.join(articleDirectory, `${date}.png`);

  await mkdir(articleDirectory, { recursive: true });
  await writeFile(markdownPath, body, "utf8");
  if (imageBuffer) {
    await writeFile(imagePath, imageBuffer);
  }

  if (existing) {
    await db
      .update(articlesTable)
      .set({
        title,
        body,
        status: "draft",
        imagePath: imageBuffer ? imagePath : existing.imagePath,
        noteUrl: null,
        scheduledAt: null,
        publishedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(articlesTable.id, existing.id));
  } else {
    await db.insert(articlesTable).values({
      sourceDate: date,
      title,
      body,
      imagePath: imageBuffer ? imagePath : null,
    });
  }

  res.json(SaveArticleResponse.parse({ status: "saved" }));
});

export default router;