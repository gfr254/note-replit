import type { Publisher } from "./types";

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function categoryXml(hashtags: string[]) {
  return hashtags
    .map((hashtag) => hashtag.replace(/^#/, "").trim())
    .filter(Boolean)
    .map((hashtag) => `<category term="${escapeXml(hashtag)}" />`)
    .join("");
}

function getEndpoint(userId: string, blogId: string) {
  const configured = process.env["HATENA_ATOM_ENDPOINT"]?.trim();
  if (configured) return configured;
  return `https://blog.hatena.ne.jp/${encodeURIComponent(userId)}/${encodeURIComponent(blogId)}/atom/entry`;
}

function getPublishedUrl(location: string | null) {
  if (!location) throw new Error("Hatena did not return a published entry URL");
  return location;
}

export const publishToHatena: Publisher = async ({ article }) => {
  const userId = requiredEnv("HATENA_USER_ID");
  const blogId = requiredEnv("HATENA_BLOG_ID");
  const apiKey = requiredEnv("HATENA_API_KEY");
  const auth = Buffer.from(`${userId}:${apiKey}`).toString("base64");
  const now = new Date().toISOString();
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<entry xmlns="http://www.w3.org/2005/Atom"
       xmlns:app="http://www.w3.org/2007/app">
  <title>${escapeXml(article.title)}</title>
  <author><name>${escapeXml(userId)}</name></author>
  <content type="text/plain">${escapeXml(article.body)}</content>
  <updated>${now}</updated>
  ${categoryXml(article.hashtags)}
  <app:control>
    <app:draft>no</app:draft>
    <app:preview>no</app:preview>
  </app:control>
</entry>`;

  const response = await fetch(getEndpoint(userId, blogId), {
    method: "POST",
    headers: {
      accept: "application/atom+xml, application/xml",
      authorization: `Basic ${auth}`,
      "content-type": "application/atom+xml;type=entry",
      "user-agent": "note-auto-publisher/1.0",
    },
    body: xml,
  });

  if (!response.ok) {
    const details = (await response.text()).slice(0, 500);
    throw new Error(`Hatena publish failed with HTTP ${response.status}: ${details}`);
  }

  return { publishedUrl: getPublishedUrl(response.headers.get("location")) };
};