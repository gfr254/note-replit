import { unlink } from "node:fs/promises";
import path from "node:path";

const apiBaseUrl = (process.env["SAVE_ARTICLE_API_URL"] ?? "http://localhost:80/api").replace(
  /\/$/,
  "",
);
const apiKey = process.env["SAVE_ARTICLE_API_KEY"];
const candidateDates = ["2099-12-31", "2099-12-30", "2099-12-29"];
const testTitle = "Workers integration test article";

type Article = {
  id: string;
  sourceDate: string | null;
  title: string;
};

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  let data: unknown = null;
  if (text) data = JSON.parse(text);
  return { response, data };
}

const existing = await request("/articles?status=draft&limit=100");
if (!existing.response.ok || !Array.isArray(existing.data)) {
  throw new Error(`Could not list articles: ${existing.response.status}`);
}

const usedDates = new Set(
  (existing.data as Article[])
    .map((article) => article.sourceDate)
    .filter((date): date is string => date !== null),
);
const testDate = candidateDates.find((date) => !usedDates.has(date));
if (!testDate) {
  throw new Error("No unused test date is available");
}

let articleId: string | undefined;
try {
  const saved = await request("/saveArticle", {
    method: "POST",
    body: JSON.stringify({
      date: testDate,
      title: testTitle,
      body: "This article verifies the Workers to Replit save contract.",
      image: "aGVsbG8=",
    }),
  });

  if (
    saved.response.status !== 200 ||
    !saved.data ||
    (saved.data as { status?: string }).status !== "saved"
  ) {
    throw new Error(`saveArticle failed: ${saved.response.status} ${JSON.stringify(saved.data)}`);
  }

  const listed = await request("/articles?status=draft&limit=100");
  if (!listed.response.ok || !Array.isArray(listed.data)) {
    throw new Error(`Could not verify saved article: ${listed.response.status}`);
  }

  const article = (listed.data as Article[]).find(
    (candidate) => candidate.sourceDate === testDate && candidate.title === testTitle,
  );
  if (!article) {
    throw new Error("Saved article was not returned by the articles API");
  }
  articleId = article.id;
  console.log(`saveArticle integration test passed for ${testDate}`);
} finally {
  if (!articleId) {
    const pending = await request("/articles?status=draft&limit=100");
    if (pending.response.ok && Array.isArray(pending.data)) {
      const article = (pending.data as Article[]).find(
        (candidate) => candidate.sourceDate === testDate && candidate.title === testTitle,
      );
      articleId = article?.id;
    }
  }

  if (articleId) {
    const deleted = await request(`/articles/${articleId}`, { method: "DELETE" });
    if (!deleted.response.ok && deleted.response.status !== 204) {
      throw new Error(`Could not clean up integration test article: ${deleted.response.status}`);
    }
  }

  const articleDirectory = path.resolve(
    process.env["ARTICLES_DATA_DIR"] ?? path.join(process.cwd(), "data", "articles"),
  );
  await Promise.all(
    [path.join(articleDirectory, `${testDate}.md`), path.join(articleDirectory, `${testDate}.png`)].map(
      async (filePath) => {
        try {
          await unlink(filePath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      },
    ),
  );
}