import { readFile, writeFile, mkdir } from "node:fs/promises";

const INPUT_FILE = new URL("../data/runtime/clean_articles.json", import.meta.url);
const OUTPUT_DIR = new URL("../data/runtime/", import.meta.url);
const SAME_EVENT_TIME_WINDOW_HOURS = 36;
const BROAD_TOPIC_TIME_WINDOW_HOURS = 18;

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
  "than",
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
  "amid",
  "into",
  "over",
  "under",
  "more",
  "less",
  "new",
]);

const TOKEN_NORMALIZATION = new Map([
  ["fed", "federal_reserve"],
  ["feds", "federal_reserve"],
  ["federal", "federal_reserve"],
  ["rate", "rates"],
  ["hike", "hikes"],
  ["hiking", "hikes"],
  ["sink", "decline"],
  ["sinks", "decline"],
  ["slip", "decline"],
  ["slips", "decline"],
  ["fell", "decline"],
  ["fall", "decline"],
  ["falls", "decline"],
  ["slide", "decline"],
  ["slides", "decline"],
  ["drop", "decline"],
  ["drops", "decline"],
  ["declines", "decline"],
  ["jump", "rise"],
  ["jumps", "rise"],
  ["climb", "rise"],
  ["climbs", "rise"],
  ["soar", "rise"],
  ["soars", "rise"],
  ["rises", "rise"],
]);

const GENERIC_TITLE_TOKENS = new Set([
  "stock",
  "stocks",
  "share",
  "shares",
  "market",
  "markets",
  "company",
  "companies",
  "price",
  "prices",
  "buyer",
  "buyers",
  "buy",
  "sell",
  "year",
  "day",
  "top",
  "best",
  "target",
  "expected",
  "one",
]);

const TITLE_HINT_RULES = [
  { pattern: /沃什|warsh/i, tokens: ["warsh"] },
  { pattern: /放鹰|放鷹|hawkish/i, tokens: ["hawkish"] },
  { pattern: /美元|dollar/i, tokens: ["dollar"] },
  { pattern: /美联储|美聯儲|聯儲|联储|\bfed\b/i, tokens: ["federal_reserve"] },
  { pattern: /利率|加息|減息|减息|降息|interest rate|rates/i, tokens: ["rates"] },
  { pattern: /日元|日圓|yen/i, tokens: ["yen"] },
  { pattern: /霍尔木兹|霍爾木茲|hormuz/i, tokens: ["hormuz"] },
  { pattern: /原油|石油|\boil\b/i, tokens: ["oil"] },
];

const ENTITY_TYPES_ALLOWED_FOR_TOPIC_GROUPING = new Set(["company", "asset", "macro", "index"]);

function nowIso() {
  return new Date().toISOString();
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

function titleTokens(article) {
  const normalized = article.normalized_title || normalizeTitle(article.title);
  const baseTokens = normalized
    .split(/\s+/)
    .map((token) => TOKEN_NORMALIZATION.get(token.trim()) ?? token.trim())
    .filter((token) => token.length >= 2 && !TITLE_STOP_WORDS.has(token));
  const rawTitle = `${article.title ?? ""} ${article.normalized_title ?? ""}`;
  const hintTokens = TITLE_HINT_RULES.flatMap((rule) => (rule.pattern.test(rawTitle) ? rule.tokens : []));

  return [...baseTokens, ...hintTokens];
}

function distinctiveTitleTokens(article) {
  return article.__tokens.filter((token) => token.length >= 3 && !GENERIC_TITLE_TOKENS.has(token));
}

function jaccard(leftValues, rightValues) {
  const left = new Set(leftValues);
  const right = new Set(rightValues);
  if (left.size === 0 || right.size === 0) return 0;

  let intersection = 0;
  for (const value of left) {
    if (right.has(value)) intersection += 1;
  }

  const union = new Set([...left, ...right]).size;
  return union === 0 ? 0 : intersection / union;
}

function publishedMs(article) {
  const time = Date.parse(article.published_at ?? "");
  return Number.isNaN(time) ? null : time;
}

function hoursBetween(leftArticle, rightArticle) {
  const left = publishedMs(leftArticle);
  const right = publishedMs(rightArticle);
  if (left == null || right == null) return Infinity;
  return Math.abs(left - right) / 36e5;
}

function entityNames(article) {
  return (article.detected_entities ?? [])
    .filter((entity) => ENTITY_TYPES_ALLOWED_FOR_TOPIC_GROUPING.has(entity.type))
    .map((entity) => entity.name);
}

function sharedValues(left, right) {
  const rightSet = new Set(right);
  return [...new Set(left)].filter((value) => rightSet.has(value));
}

function sourceSet(articles) {
  return [...new Set(articles.map((article) => article.source))].sort();
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function articlePublicId(article, index) {
  return `article-${String(index + 1).padStart(4, "0")}`;
}

function decorateArticles(articles) {
  return articles.map((article, index) => ({
    ...article,
    article_id: articlePublicId(article, index),
    __tokens: titleTokens(article),
    __entity_names: entityNames(article),
  }));
}

function pairDecision(left, right) {
  const titleSimilarity = jaccard(left.__tokens, right.__tokens);
  const sharedTitleTokens = sharedValues(distinctiveTitleTokens(left), distinctiveTitleTokens(right));
  const tokenContainment =
    Math.min(new Set(left.__tokens).size, new Set(right.__tokens).size) === 0
      ? 0
      : sharedValues(left.__tokens, right.__tokens).length /
        Math.min(new Set(left.__tokens).size, new Set(right.__tokens).size);
  const categoryOverlap = jaccard(left.categories ?? [], right.categories ?? []);
  const sharedEntities = sharedValues(left.__entity_names, right.__entity_names);
  const timeHours = hoursBetween(left, right);
  const crossLanguage = left.language !== right.language;
  const sameSource = left.source === right.source;

  const reasons = [];
  let confidence = 0;
  let shouldGroup = false;

  if (titleSimilarity >= 0.78) {
    shouldGroup = true;
    confidence = Math.max(confidence, 0.92);
    reasons.push("high_title_similarity");
  }

  if (titleSimilarity >= 0.62 && categoryOverlap >= 0.34 && timeHours <= SAME_EVENT_TIME_WINDOW_HOURS) {
    shouldGroup = true;
    confidence = Math.max(confidence, 0.82);
    reasons.push("similar_title_category_time_window");
  }

  if (sharedTitleTokens.length >= 3 && categoryOverlap >= 0.34 && timeHours <= SAME_EVENT_TIME_WINDOW_HOURS) {
    shouldGroup = true;
    confidence = Math.max(confidence, 0.8);
    reasons.push("shared_distinctive_title_terms_category_time_window");
  }

  if (
    sharedTitleTokens.length >= 2 &&
    sharedEntities.length > 0 &&
    categoryOverlap >= 0.5 &&
    timeHours <= SAME_EVENT_TIME_WINDOW_HOURS
  ) {
    shouldGroup = true;
    confidence = Math.max(confidence, 0.76);
    reasons.push("shared_entity_and_distinctive_title_terms");
  }

  if (
    sharedEntities.length > 0 &&
    categoryOverlap >= 0.4 &&
    titleSimilarity >= 0.35 &&
    timeHours <= SAME_EVENT_TIME_WINDOW_HOURS
  ) {
    shouldGroup = true;
    confidence = Math.max(confidence, 0.78);
    reasons.push("shared_entity_category_time_window");
  }

  if (
    crossLanguage &&
    (sharedTitleTokens.length >= 2 || (sharedEntities.length >= 2 && sharedTitleTokens.length >= 1)) &&
    categoryOverlap >= 0.4 &&
    timeHours <= SAME_EVENT_TIME_WINDOW_HOURS
  ) {
    shouldGroup = true;
    confidence = Math.max(confidence, 0.76);
    reasons.push("cross_language_multi_entity_category_time_window");
  }

  if (
    sharedEntities.length > 0 &&
    categoryOverlap >= 0.67 &&
    (titleSimilarity >= 0.25 || tokenContainment >= 0.28) &&
    timeHours <= BROAD_TOPIC_TIME_WINDOW_HOURS &&
    !sameSource
  ) {
    shouldGroup = true;
    confidence = Math.max(confidence, 0.68);
    reasons.push("shared_entity_broad_topic_short_window");
  }

  const hasSpecificEvidence = sharedTitleTokens.length >= 2 || (crossLanguage && sharedEntities.length >= 2);

  if (sharedEntities.length > 0 && titleSimilarity < 0.25 && categoryOverlap < 0.67 && !hasSpecificEvidence) {
    shouldGroup = false;
    confidence = 0;
    reasons.push("prevented_overmerge_shared_entity_only");
  }

  if (timeHours > SAME_EVENT_TIME_WINDOW_HOURS && titleSimilarity < 0.78) {
    shouldGroup = false;
    confidence = 0;
    reasons.push("prevented_overmerge_time_window");
  }

  return {
    shouldGroup,
    confidence: Number(confidence.toFixed(3)),
    title_similarity: Number(titleSimilarity.toFixed(3)),
    token_containment: Number(tokenContainment.toFixed(3)),
    shared_title_tokens: sharedTitleTokens,
    category_overlap: Number(categoryOverlap.toFixed(3)),
    shared_entities: sharedEntities,
    time_window_hours: Number.isFinite(timeHours) ? Number(timeHours.toFixed(2)) : null,
    cross_language: crossLanguage,
    reasons,
  };
}

function evaluateArticleAgainstCluster(article, clusterArticles) {
  let best = {
    shouldGroup: false,
    confidence: 0,
    reasons: [],
    matched_article_id: null,
    title_similarity: 0,
    token_containment: 0,
    shared_title_tokens: [],
    category_overlap: 0,
    shared_entities: [],
    time_window_hours: null,
    cross_language: false,
  };

  for (const existing of clusterArticles) {
    const decision = pairDecision(article, existing);
    if (decision.confidence > best.confidence) {
      best = {
        ...decision,
        matched_article_id: existing.article_id,
      };
    }
  }

  return best;
}

function clusterArticles(articles) {
  const sorted = [...articles].sort((left, right) => {
    const leftTime = publishedMs(left) ?? 0;
    const rightTime = publishedMs(right) ?? 0;
    return rightTime - leftTime;
  });
  const clusters = [];
  const decisions = [];

  for (const article of sorted) {
    let bestCluster = null;
    let bestDecision = null;

    for (const cluster of clusters) {
      const decision = evaluateArticleAgainstCluster(article, cluster.articles);
      if (decision.shouldGroup && (!bestDecision || decision.confidence > bestDecision.confidence)) {
        bestCluster = cluster;
        bestDecision = decision;
      }
    }

    if (bestCluster && bestDecision) {
      bestCluster.articles.push(article);
      bestCluster.decisions.push({
        article_id: article.article_id,
        matched_article_id: bestDecision.matched_article_id,
        confidence: bestDecision.confidence,
        reasons: bestDecision.reasons,
        title_similarity: bestDecision.title_similarity,
        token_containment: bestDecision.token_containment,
        shared_title_tokens: bestDecision.shared_title_tokens,
        category_overlap: bestDecision.category_overlap,
        shared_entities: bestDecision.shared_entities,
        time_window_hours: bestDecision.time_window_hours,
        cross_language: bestDecision.cross_language,
      });
      decisions.push({
        article_id: article.article_id,
        assigned_cluster_id: bestCluster.internal_id,
        decision: "grouped",
        ...bestDecision,
      });
    } else {
      const internalId = `cluster-${String(clusters.length + 1).padStart(3, "0")}`;
      clusters.push({
        internal_id: internalId,
        articles: [article],
        decisions: [
          {
            article_id: article.article_id,
            matched_article_id: null,
            confidence: 1,
            reasons: ["seed_article"],
            title_similarity: 1,
            category_overlap: 1,
            shared_entities: [],
            time_window_hours: 0,
            cross_language: false,
          },
        ],
      });
      decisions.push({
        article_id: article.article_id,
        assigned_cluster_id: internalId,
        decision: "seed",
        confidence: 1,
        reasons: ["seed_article"],
      });
    }
  }

  return { clusters, decisions };
}

function chooseTitleCandidate(clusterArticles) {
  const sorted = [...clusterArticles].sort((left, right) => {
    const sourceCountDelta = Number(right.source_position ?? 9999) - Number(left.source_position ?? 9999);
    if (clusterArticles.length > 1) {
      const entityDelta = (right.detected_entities?.length ?? 0) - (left.detected_entities?.length ?? 0);
      if (entityDelta !== 0) return entityDelta;
    }
    const titleLengthDelta = String(left.title).length - String(right.title).length;
    if (titleLengthDelta !== 0) return titleLengthDelta;
    return sourceCountDelta;
  });

  return sorted[0]?.title ?? "Untitled cluster";
}

function confidenceForCluster(cluster) {
  if (cluster.articles.length === 1) return 0.5;
  const groupedDecisions = cluster.decisions.filter((decision) => !decision.reasons.includes("seed_article"));
  if (groupedDecisions.length === 0) return 0.5;
  const average = groupedDecisions.reduce((sum, decision) => sum + decision.confidence, 0) / groupedDecisions.length;
  return Number(Math.min(0.99, average).toFixed(3));
}

function summarizeClusterReasons(cluster) {
  const reasons = new Set();
  if (cluster.articles.length === 1) reasons.add("single_article_no_related_match");

  for (const decision of cluster.decisions) {
    for (const reason of decision.reasons) {
      reasons.add(reason);
    }
  }

  return [...reasons].filter((reason) => reason !== "seed_article");
}

function toPublicArticle(article) {
  const {
    __tokens,
    __entity_names,
    ...publicArticle
  } = article;

  return publicArticle;
}

function toPublicCluster(cluster, index) {
  const articles = cluster.articles.map(toPublicArticle);
  const publishedTimes = articles
    .map((article) => article.published_at)
    .filter(Boolean)
    .sort();
  const detectedEntityMap = new Map();

  for (const article of articles) {
    for (const entity of article.detected_entities ?? []) {
      if (!detectedEntityMap.has(entity.name)) {
        detectedEntityMap.set(entity.name, {
          name: entity.name,
          type: entity.type,
        });
      }
    }
  }

  return {
    cluster_id: `news-cluster-${String(index + 1).padStart(3, "0")}`,
    cluster_title_candidate: chooseTitleCandidate(articles),
    articles,
    categories: uniqueSorted(articles.flatMap((article) => article.categories ?? [])),
    detected_entities: [...detectedEntityMap.values()].sort((left, right) => left.name.localeCompare(right.name)),
    source_count: sourceSet(articles).length,
    sources: sourceSet(articles),
    earliest_published_at: publishedTimes[0] ?? null,
    latest_published_at: publishedTimes[publishedTimes.length - 1] ?? null,
    cluster_confidence: confidenceForCluster(cluster),
    cluster_reasons: summarizeClusterReasons(cluster),
  };
}

async function readJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

async function writeJson(filename, data) {
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(new URL(filename, OUTPUT_DIR), `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function main() {
  const generatedAt = nowIso();
  const input = await readJson(INPUT_FILE);
  const inputArticles = Array.isArray(input.articles) ? input.articles : [];
  const decoratedArticles = decorateArticles(inputArticles);
  const { clusters, decisions } = clusterArticles(decoratedArticles);
  const publicClusters = clusters.map(toPublicCluster);
  const articleAssignments = new Map();

  for (const cluster of publicClusters) {
    for (const article of cluster.articles) {
      articleAssignments.set(article.article_id, cluster.cluster_id);
    }
  }

  const clusterReport = {
    generated_at: generatedAt,
    input_file: "data/runtime/clean_articles.json",
    input_article_count: inputArticles.length,
    cluster_count: publicClusters.length,
    multi_article_cluster_count: publicClusters.filter((cluster) => cluster.articles.length > 1).length,
    single_article_cluster_count: publicClusters.filter((cluster) => cluster.articles.length === 1).length,
    all_articles_assigned_once: articleAssignments.size === inputArticles.length,
    clustering_rules: {
      same_event_time_window_hours: SAME_EVENT_TIME_WINDOW_HOURS,
      broad_topic_time_window_hours: BROAD_TOPIC_TIME_WINDOW_HOURS,
      embedding_based_approach_enabled: false,
    },
    article_assignments: [...articleAssignments.entries()].map(([article_id, cluster_id]) => ({
      article_id,
      cluster_id,
    })),
    grouping_decisions: decisions,
    clusters: publicClusters.map((cluster) => ({
      cluster_id: cluster.cluster_id,
      article_count: cluster.articles.length,
      sources: cluster.sources,
      categories: cluster.categories,
      detected_entities: cluster.detected_entities,
      cluster_confidence: cluster.cluster_confidence,
      cluster_reasons: cluster.cluster_reasons,
      source_urls: cluster.articles.map((article) => article.url),
    })),
  };

  await writeJson("news_clusters.json", {
    generated_at: generatedAt,
    input_article_count: inputArticles.length,
    cluster_count: publicClusters.length,
    clusters: publicClusters,
  });
  await writeJson("cluster_report.json", clusterReport);

  console.log(
    JSON.stringify(
      {
        generated_at: generatedAt,
        input_article_count: inputArticles.length,
        cluster_count: publicClusters.length,
        multi_article_cluster_count: clusterReport.multi_article_cluster_count,
        single_article_cluster_count: clusterReport.single_article_cluster_count,
        all_articles_assigned_once: clusterReport.all_articles_assigned_once,
        outputs: ["data/runtime/news_clusters.json", "data/runtime/cluster_report.json"],
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
