import { readFile, writeFile, mkdir } from "node:fs/promises";

const INPUT_FILE = new URL("../data/runtime/normalized_articles.json", import.meta.url);
const OUTPUT_DIR = new URL("../data/runtime/", import.meta.url);
const CATEGORY_RULES_FILE = new URL("../config/category-rules.json", import.meta.url);
const SOURCE_WEIGHTS_FILE = new URL("../config/source-weights.json", import.meta.url);

const ORIGINAL_FIELDS = [
  "source",
  "language",
  "title",
  "url",
  "published_at",
  "snippet",
  "source_position",
  "section",
  "fetched_at",
];

const TITLE_STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "for",
  "to",
  "of",
  "in",
  "on",
  "at",
  "as",
  "with",
  "from",
  "by",
  "after",
  "before",
  "is",
  "are",
  "was",
  "were",
  "be",
  "will",
  "may",
  "can",
  "could",
  "should",
  "this",
  "that",
  "these",
  "those",
  "its",
  "it",
  "their",
  "his",
  "her",
  "says",
  "said",
  "why",
  "how",
  "what",
  "here",
]);

function nowIso() {
  return new Date().toISOString();
}

function normalizeUrl(value) {
  const raw = String(value ?? "").trim();
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

function normalizeTitle(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/['’`]/g, "")
    .replace(/&[a-z]+;/g, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeTitle(normalizedTitle) {
  return normalizedTitle
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !TITLE_STOP_WORDS.has(token));
}

function jaccardSimilarity(leftTokens, rightTokens) {
  if (leftTokens.length === 0 || rightTokens.length === 0) return 0;
  const left = new Set(leftTokens);
  const right = new Set(rightTokens);
  let intersection = 0;

  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }

  const union = new Set([...left, ...right]).size;
  return union === 0 ? 0 : intersection / union;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function aliasRegex(alias) {
  const escaped = escapeRegex(alias);
  if (/^[a-z0-9 .&-]+$/i.test(alias)) {
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i");
  }
  return new RegExp(escaped, "i");
}

function includesKeyword(text, keyword) {
  return aliasRegex(keyword).test(text);
}

function classifyArticle(article, categoryRules) {
  const text = `${article.title} ${article.snippet} ${article.section}`.toLowerCase();
  const categories = [];

  for (const category of categoryRules.categories) {
    if (category.keywords.some((keyword) => includesKeyword(text, keyword.toLowerCase()))) {
      categories.push(category.name);
    }
  }

  if (categories.length === 0) {
    categories.push("宏觀");
  }

  return categories;
}

function extractEntities(article, categoryRules) {
  const text = `${article.title} ${article.snippet}`.toLowerCase();
  const entities = [];
  const seen = new Set();

  for (const entity of categoryRules.entities) {
    const matchedAlias = entity.aliases.find((alias) => includesKeyword(text, alias.toLowerCase()));
    if (matchedAlias && !seen.has(entity.name)) {
      seen.add(entity.name);
      entities.push({
        name: entity.name,
        type: entity.type,
        matched_alias: matchedAlias,
      });
    }
  }

  return entities;
}

function qualityFlags(article, categories, entities) {
  const flags = [];
  const title = String(article.title ?? "").trim();
  const snippet = String(article.snippet ?? "").trim();

  if (!article.published_at) flags.push("missing_published_at");
  if (!snippet) flags.push("missing_snippet");
  if (snippet && snippet.length < 40) flags.push("short_snippet");
  if (title.length < 12) flags.push("short_title");
  if (!/^https?:\/\//i.test(String(article.url ?? ""))) flags.push("non_http_url");
  if (categories.length === 1 && categories[0] === "宏觀" && entities.length === 0) {
    flags.push("category_fallback");
  }

  return flags;
}

function sourceWeight(article, sourceWeights) {
  return Number(sourceWeights[article.source] ?? 0);
}

function publishedTime(article) {
  const time = Date.parse(article.published_at ?? "");
  return Number.isNaN(time) ? 0 : time;
}

function chooseRepresentative(group, sourceWeights) {
  return [...group].sort((left, right) => {
    const weightDelta = sourceWeight(right, sourceWeights) - sourceWeight(left, sourceWeights);
    if (weightDelta !== 0) return weightDelta;

    const timeDelta = publishedTime(right) - publishedTime(left);
    if (timeDelta !== 0) return timeDelta;

    return Number(left.source_position ?? 9999) - Number(right.source_position ?? 9999);
  })[0];
}

function decorateArticle(article, categoryRules) {
  const normalizedTitle = normalizeTitle(article.title);
  const categories = classifyArticle(article, categoryRules);
  const detectedEntities = extractEntities(article, categoryRules);

  const cleanArticle = {};
  for (const field of ORIGINAL_FIELDS) {
    cleanArticle[field] = field === "url" ? normalizeUrl(article[field]) : article[field] ?? null;
  }

  cleanArticle.categories = categories;
  cleanArticle.detected_entities = detectedEntities;
  cleanArticle.quality_flags = qualityFlags(cleanArticle, categories, detectedEntities);
  cleanArticle.normalized_title = normalizedTitle;
  cleanArticle.duplicate_group_id = null;
  cleanArticle.__title_tokens = tokenizeTitle(normalizedTitle);

  return cleanArticle;
}

function reportMember(article, sourceWeights, reason) {
  return {
    source: article.source,
    source_weight: sourceWeight(article, sourceWeights),
    title: article.title,
    normalized_title: article.normalized_title,
    url: article.url,
    published_at: article.published_at,
    source_position: article.source_position,
    reason,
  };
}

function buildDuplicateGroup(groupId, reason, group, kept, sourceWeights, similarity = null) {
  return {
    duplicate_group_id: groupId,
    reason,
    similarity,
    kept: reportMember(kept, sourceWeights, "kept"),
    removed: group
      .filter((article) => article !== kept)
      .map((article) => reportMember(article, sourceWeights, reason)),
    source_urls: group.map((article) => article.url),
  };
}

function removeDuplicateUrls(articles, sourceWeights) {
  const byUrl = new Map();
  for (const article of articles) {
    const key = normalizeUrl(article.url);
    if (!byUrl.has(key)) byUrl.set(key, []);
    byUrl.get(key).push(article);
  }

  const kept = [];
  const groups = [];
  let groupNumber = 1;

  for (const group of byUrl.values()) {
    if (group.length === 1) {
      kept.push(group[0]);
      continue;
    }

    const representative = chooseRepresentative(group, sourceWeights);
    const groupId = `dup-url-${String(groupNumber).padStart(3, "0")}`;
    representative.duplicate_group_id = groupId;
    kept.push(representative);
    groups.push(buildDuplicateGroup(groupId, "exact_url", group, representative, sourceWeights));
    groupNumber += 1;
  }

  return { kept, groups };
}

function removeDuplicateTitles(articles, sourceWeights) {
  const byTitle = new Map();
  for (const article of articles) {
    const key = article.normalized_title;
    if (!byTitle.has(key)) byTitle.set(key, []);
    byTitle.get(key).push(article);
  }

  const kept = [];
  const groups = [];
  let groupNumber = 1;

  for (const group of byTitle.values()) {
    if (group.length === 1) {
      kept.push(group[0]);
      continue;
    }

    const representative = chooseRepresentative(group, sourceWeights);
    const groupId = `dup-title-${String(groupNumber).padStart(3, "0")}`;
    representative.duplicate_group_id = representative.duplicate_group_id ?? groupId;
    kept.push(representative);
    groups.push(buildDuplicateGroup(groupId, "exact_normalized_title", group, representative, sourceWeights));
    groupNumber += 1;
  }

  return { kept, groups };
}

function groupSimilarTitles(articles, sourceWeights) {
  const remaining = [...articles];
  const kept = [];
  const groups = [];
  let groupNumber = 1;

  while (remaining.length > 0) {
    const seed = remaining.shift();
    const group = [seed];

    for (let index = remaining.length - 1; index >= 0; index -= 1) {
      const candidate = remaining[index];
      const similarity = jaccardSimilarity(seed.__title_tokens, candidate.__title_tokens);
      const sameImportantEntity =
        seed.detected_entities.length > 0 &&
        candidate.detected_entities.some((entity) =>
          seed.detected_entities.some((seedEntity) => seedEntity.name === entity.name),
        );
      const threshold = sameImportantEntity ? 0.58 : 0.72;

      if (similarity >= threshold) {
        candidate.__similarity_to_seed = Number(similarity.toFixed(3));
        group.push(candidate);
        remaining.splice(index, 1);
      }
    }

    if (group.length === 1) {
      kept.push(seed);
      continue;
    }

    const representative = chooseRepresentative(group, sourceWeights);
    const groupId = `dup-similar-title-${String(groupNumber).padStart(3, "0")}`;
    representative.duplicate_group_id = representative.duplicate_group_id ?? groupId;
    kept.push(representative);
    groups.push(
      buildDuplicateGroup(
        groupId,
        "similar_normalized_title",
        group,
        representative,
        sourceWeights,
        Math.max(...group.map((article) => article.__similarity_to_seed ?? 1)),
      ),
    );
    groupNumber += 1;
  }

  return { kept, groups };
}

function stripInternalFields(article) {
  const { __title_tokens, __similarity_to_seed, ...publicArticle } = article;
  return publicArticle;
}

async function readJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

async function writeJson(filename, data) {
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(new URL(filename, OUTPUT_DIR), `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function main() {
  const runAt = nowIso();
  const input = await readJson(INPUT_FILE);
  const categoryRules = await readJson(CATEGORY_RULES_FILE);
  const sourceWeights = await readJson(SOURCE_WEIGHTS_FILE);
  const inputArticles = Array.isArray(input.articles) ? input.articles : [];
  const decorated = inputArticles.map((article) => decorateArticle(article, categoryRules));

  const urlPass = removeDuplicateUrls(decorated, sourceWeights);
  const titlePass = removeDuplicateTitles(urlPass.kept, sourceWeights);
  const similarPass = groupSimilarTitles(titlePass.kept, sourceWeights);

  const cleanArticles = similarPass.kept.map(stripInternalFields);
  const duplicateGroups = [...urlPass.groups, ...titlePass.groups, ...similarPass.groups];
  const removedCount = duplicateGroups.reduce((sum, group) => sum + group.removed.length, 0);

  const dedupReport = {
    generated_at: runAt,
    input_file: "data/runtime/normalized_articles.json",
    input_article_count: inputArticles.length,
    clean_article_count: cleanArticles.length,
    removed_article_count: removedCount,
    exact_url_duplicate_groups: urlPass.groups.length,
    exact_title_duplicate_groups: titlePass.groups.length,
    similar_title_duplicate_groups: similarPass.groups.length,
    all_original_source_urls: decorated.map((article) => article.url),
    duplicate_groups: duplicateGroups,
  };

  await writeJson("clean_articles.json", {
    generated_at: runAt,
    input_article_count: inputArticles.length,
    article_count: cleanArticles.length,
    articles: cleanArticles,
  });
  await writeJson("dedup_report.json", dedupReport);

  console.log(
    JSON.stringify(
      {
        generated_at: runAt,
        input_article_count: inputArticles.length,
        clean_article_count: cleanArticles.length,
        removed_article_count: removedCount,
        duplicate_groups: duplicateGroups.length,
        outputs: ["data/runtime/clean_articles.json", "data/runtime/dedup_report.json"],
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
