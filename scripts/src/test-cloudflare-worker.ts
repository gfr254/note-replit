import { unlink } from "node:fs/promises";
import path from "node:path";

const workerUrl = (process.env["CLOUDFLARE_WORKER_URL"] ?? "").replace(/\/+$/, "");
const workerApiKey = process.env["WORKER_API_KEY"];
const replitApiUrl = (process.env["SAVE_ARTICLE_API_URL"] ?? "http://localhost:80/api").replace(
  /\/$/,
  "",
);
const candidateDates = ["2099-12-28", "2099-12-27", "2099-12-26"];
const testTitle = "Cloudflare Worker integration test article";

type Article = {
  id: string;
  sourceDate: string | null;
  title: string;
};

if (!workerUrl) throw new Error("CLOUDFLARE_WORKER_URL is required");
if (!workerApiKey) throw new Error("WORKER_API_KEY is required");

async function request(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  let data: unknown = null;
  if (text) data = JSON.parse(text);
  return { response, data };
}

async function replitRequest(endpoint: string, init?: RequestInit) {
  return request(`${replitApiUrl}${endpoint}`, {
    ...init,
    headers: {
      authorization: `Bearer ${process.env["SAVE_ARTICLE_API_KEY"] ?? ""}`,
      ...(init?.headers ?? {}),
    },
  });
}

const existing = await replitRequest("/articles?status=draft&limit=100");
if (!existing.response.ok || !Array.isArray(existing.data)) {
  throw new Error(`Could not list articles: ${existing.response.status}`);
}

const usedDates = new Set(
  (existing.data as Article[])
    .map((article) => article.sourceDate)
    .filter((date): date is string => date !== null),
);
const testDate = candidateDates.find((date) => !usedDates.has(date));
if (!testDate) throw new Error("No unused test date is available");

let articleId: string | undefined;
try {
  const saved = await request(`${workerUrl}/saveArticle`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${workerApiKey}`,
    },
    body: JSON.stringify({
      date: testDate,
      title: testTitle,
      body: "This article verifies the Cloudflare Worker to Replit save contract.",
      image: "aGVsbG8=",
    }),
  });

  if (
    saved.response.status !== 200 ||
    !saved.data ||
    (saved.data as { status?: string }).status !== "saved"
  ) {
    throw new Error(`Worker saveArticle failed: ${saved.response.status} ${JSON.stringify(saved.data)}`);
  }

  const listed = await replitRequest("/articles?status=draft&limit=100");
  if (!listed.response.ok || !Array.isArray(listed.data)) {
    throw new Error(`Could not verify saved article: ${listed.response.status}`);
  }

  const article = (listed.data as Article[]).find(
    (candidate) => candidate.sourceDate === testDate && candidate.title === testTitle,
  );
  if (!article) throw new Error("Worker-saved article was not returned by the articles API");
  articleId = article.id;
  console.log(`Cloudflare Worker integration test passed for ${testDate}`);
} finally {
  if (!articleId) {
    const pending = await replitRequest("/articles?status=draft&limit=100");
    if (pending.response.ok && Array.isArray(pending.data)) {
      articleId = (pending.data as Article[]).find(
        (candidate) => candidate.sourceDate === testDate && candidate.title === testTitle,
      )?.id;
    }
  }

  if (articleId) {
    const deleted = await replitRequest(`/articles/${articleId}`, { method: "DELETE" });
    if (!deleted.response.ok && deleted.response.status !== 204) {
      throw new Error(`Could not clean up Worker integration test article: ${deleted.response.status}`);
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