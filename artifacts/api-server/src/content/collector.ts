export type TopicSource = {
  title: string;
  url: string;
  summary: string;
  publishedAt: string | null;
};

const defaultFeedUrl =
  "https://news.google.com/rss/search?q=%E7%A9%BA%E5%86%B7%20%E3%83%93%E3%83%BC%E3%83%88%E3%83%AB%20OR%20%E3%83%95%E3%82%A9%E3%83%AB%E3%82%AF%E3%82%B9%E3%83%AF%E3%83%BC%E3%82%B2%E3%83%B3%20%E3%82%BF%E3%82%A4%E3%83%97%201&hl=ja&gl=JP&ceid=JP:ja";

function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

function tagValue(block: string, tag: string) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return match ? decodeXml(match[1]) : "";
}

function configuredFeedUrls() {
  const configured = process.env["CONTENT_RSS_URLS"]
    ?.split(",")
    .map((url) => url.trim())
    .filter(Boolean);
  return configured?.length ? configured : [defaultFeedUrl];
}

async function fetchFeed(url: string) {
  const response = await fetch(url, {
    headers: { accept: "application/rss+xml, application/xml, text/xml" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`RSS feed returned HTTP ${response.status}`);
  return response.text();
}

function parseFeed(xml: string): TopicSource[] {
  return xml
    .split(/<item\b/i)
    .slice(1)
    .map((block) => ({
      title: tagValue(block, "title"),
      url: tagValue(block, "link"),
      summary: tagValue(block, "description").slice(0, 1_000),
      publishedAt: tagValue(block, "pubDate") || null,
    }))
    .filter((item) => item.title && item.url);
}

export async function collectTopics(topic: string) {
  const urls = configuredFeedUrls().map((url) =>
    url.replaceAll("{query}", encodeURIComponent(topic)),
  );
  const collected: TopicSource[] = [];

  for (const url of urls) {
    try {
      collected.push(...parseFeed(await fetchFeed(url)));
    } catch (error) {
      console.warn(
        `[content] RSS collection failed for ${url}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  const seen = new Set<string>();
  return collected
    .filter((item) => {
      const key = item.url || item.title;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
}