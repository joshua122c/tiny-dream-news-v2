import { mkdir, writeFile } from "node:fs/promises";
import { XMLParser } from "fast-xml-parser";

const RUNTIME_DIR = new URL("../data/runtime/", import.meta.url);
const FETCH_TIMEOUT_MS = 20000;
const MAX_ITEMS_PER_SOURCE = 30;

const SOURCES = [
  {
    name: "CNBC",
    language: "en",
    section: "Top News",
    type: "rss",
    urls: ["https://www.cnbc.com/id/100003114/device/rss/rss.html"],
  },
  {
    name: "MarketWatch",
    language: "en",
    section: "Top Stories",
    type: "rss",
    urls: ["https://feeds.content.dowjones.io/public/rss/mw_topstories"],
  },
  {
    name: "Yahoo Finance",
    language: "en",
    section: "Finance News",
    type: "rss",
    urls: ["https://finance.yahoo.com/news/rssindex"],
  },
  {
    name: "TechCrunch",
    language: "en",
    section: "Technology",
    type: "rss",
    urls: ["https://techcrunch.com/feed/"],
  },
  {
    name: "The Verge",
    language: "en",
    section: "Technology",
    type: "rss",
    urls: ["https://www.theverge.com/rss/index.xml"],
  },
  {
    name: "華爾街見聞",
    language: "zh",
    section: "Global",
    type: "wallstreetcn-json",
    urls: ["https://api-one.wallstcn.com/apiv1/content/articles?channel=global&limit=30"],
  },
];

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  trimValues: true,
});

function nowIso() {
  return new Date().toISOString();
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function textValue(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return textValue(value[0]);
  if (typeof value === "object") {
    return textValue(value["#text"] ?? value["@_href"] ?? value.href ?? value.url ?? "");
  }
  return "";
}

function decodeEntities(value) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function cleanText(value) {
  return decodeEntities(textValue(value))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseDate(value) {
  if (!value) return null;
  if (typeof value === "number") return new Date(value * 1000).toISOString();
  const parsed = new Date(textValue(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeUrl(value) {
  const raw = textValue(value).trim();
  if (!raw) return "";

  try {
    const url = new URL(raw);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith("utm_") || key === "guccounter") {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    return raw;
  }
}

function atomLink(entry) {
  const links = asArray(entry.link);
  const alternate = links.find((link) => link?.["@_rel"] === "alternate") ?? links[0];
  return textValue(alternate?.["@_href"] ?? alternate);
}

function rssLink(item) {
  return textValue(item.link ?? item.guid ?? item.id);
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, application/json, text/html;q=0.8",
        "user-agent": "TinyDreamNewsV2/0.1 (+https://github.com/joshua122c/tiny-dream-news-v2)",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function parseRssItems(xmlText, source) {
  const parsed = xmlParser.parse(xmlText);
  const channel = parsed.rss?.channel;
  const rssItems = asArray(channel?.item);
  const atomEntries = asArray(parsed.feed?.entry);
  const sourceTitle = cleanText(channel?.title ?? parsed.feed?.title ?? source.section);

  const items = rssItems.length > 0 ? rssItems : atomEntries;
  return items.slice(0, MAX_ITEMS_PER_SOURCE).map((item, index) => {
    const isAtom = atomEntries.length > 0 && rssItems.length === 0;
    return {
      source: source.name,
      source_feed_url: source.activeUrl,
      source_feed_title: sourceTitle,
      language: source.language,
      section: source.section,
      source_position: index + 1,
      title: cleanText(item.title),
      url: normalizeUrl(isAtom ? atomLink(item) : rssLink(item)),
      published_at: parseDate(item.pubDate ?? item.published ?? item.updated ?? item["dc:date"]),
      snippet: cleanText(item.description ?? item.summary ?? item.content ?? item["content:encoded"]),
      raw_item: item,
    };
  });
}

function parseWallStreetCnItems(jsonText, source) {
  const parsed = JSON.parse(jsonText);
  const items = asArray(parsed?.data?.items);

  return items.slice(0, MAX_ITEMS_PER_SOURCE).map((item, index) => ({
    source: source.name,
    source_feed_url: source.activeUrl,
    source_feed_title: "華爾街見聞 Global",
    language: source.language,
    section: source.section,
    source_position: index + 1,
    title: cleanText(item.title),
    url: normalizeUrl(item.uri),
    published_at: parseDate(item.display_time),
    snippet: cleanText(item.content_short ?? item.subtitle),
    raw_item: item,
  }));
}

async function fetchSource(source) {
  const errors = [];

  for (const url of source.urls) {
    try {
      const fetchedAt = nowIso();
      const text = await fetchText(url);
      const activeSource = { ...source, activeUrl: url };
      const articles =
        source.type === "wallstreetcn-json"
          ? parseWallStreetCnItems(text, activeSource)
          : parseRssItems(text, activeSource);

      const usableArticles = articles.filter((article) => article.title && article.url);
      if (usableArticles.length === 0) {
        throw new Error("No usable articles found in response");
      }

      return {
        status: {
          source: source.name,
          status: "success",
          article_count: usableArticles.length,
          error_message: "",
          fetched_at: fetchedAt,
        },
        rawArticles: usableArticles,
      };
    } catch (error) {
      errors.push(`${url}: ${error.message}`);
    }
  }

  return {
    status: {
      source: source.name,
      status: "failed",
      article_count: 0,
      error_message: errors.join(" | "),
      fetched_at: nowIso(),
    },
    rawArticles: [],
  };
}

function normalizeArticle(rawArticle, fetchedAt) {
  return {
    source: rawArticle.source,
    language: rawArticle.language,
    title: rawArticle.title,
    url: rawArticle.url,
    published_at: rawArticle.published_at,
    snippet: rawArticle.snippet,
    source_position: rawArticle.source_position,
    section: rawArticle.section,
    fetched_at: fetchedAt,
  };
}

function dedupeByUrl(articles) {
  const seen = new Set();
  const deduped = [];

  for (const article of articles) {
    const key = normalizeUrl(article.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push({ ...article, url: key });
  }

  return deduped;
}

async function writeJson(filename, data) {
  await mkdir(RUNTIME_DIR, { recursive: true });
  await writeFile(new URL(filename, RUNTIME_DIR), `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function main() {
  const runStartedAt = nowIso();
  const results = [];

  for (const source of SOURCES) {
    results.push(await fetchSource(source));
  }

  const rawArticles = results.flatMap((result) => result.rawArticles);
  const normalizedArticles = dedupeByUrl(
    rawArticles.map((article) => normalizeArticle(article, runStartedAt)),
  );
  const sourceStatus = results.map((result) => result.status);

  await writeJson("raw_articles.json", {
    fetched_at: runStartedAt,
    article_count: rawArticles.length,
    articles: rawArticles,
  });
  await writeJson("normalized_articles.json", {
    fetched_at: runStartedAt,
    article_count: normalizedArticles.length,
    articles: normalizedArticles,
  });
  await writeJson("source_status.json", {
    fetched_at: runStartedAt,
    sources: sourceStatus,
  });

  const successCount = sourceStatus.filter((source) => source.status === "success").length;
  const failedCount = sourceStatus.length - successCount;
  console.log(
    JSON.stringify(
      {
        fetched_at: runStartedAt,
        sources_successful: successCount,
        sources_failed: failedCount,
        raw_article_count: rawArticles.length,
        normalized_article_count: normalizedArticles.length,
        outputs: [
          "data/runtime/raw_articles.json",
          "data/runtime/normalized_articles.json",
          "data/runtime/source_status.json",
        ],
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
