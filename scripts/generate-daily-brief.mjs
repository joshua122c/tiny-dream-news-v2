import { readFile, writeFile, mkdir } from "node:fs/promises";
import { buildCategoryIndex, mergeArchiveIndex, mergeArchiveSearchIndex } from "./archive-indexes.mjs";
import { buildBriefReason, buildEditorialHeadline, buildMorningBrief, isBadUserFacingHeadline } from "./user-facing-copy.mjs";

const SUMMARY_FILE = new URL("../data/runtime/summarized_clusters.json", import.meta.url);
const SOURCE_STATUS_FILE = new URL("../data/runtime/source_status.json", import.meta.url);
const AI_SUMMARY_REPORT_FILE = new URL("../data/runtime/ai_summary_report.json", import.meta.url);
const SCORE_REPORT_FILE = new URL("../data/runtime/score_report.json", import.meta.url);
const DAILY_DIR = new URL("../data/daily/", import.meta.url);
const ARCHIVE_DIR = new URL("../data/archive/", import.meta.url);
const SEARCH_DIR = new URL("../data/search/", import.meta.url);
const RUNTIME_DIR = new URL("../data/runtime/", import.meta.url);

const MOOD_LABELS = {
  risk_on: "風險偏好較強",
  risk_off: "風險偏好轉弱",
  neutral: "市場氣氛中性",
  mixed: "市場訊號分化",
};

function nowIso() {
  return new Date().toISOString();
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--date") {
      args.date = argv[index + 1];
      index += 1;
    } else if (item === "--run-time") {
      args.runTime = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

function hongKongDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function hongKongRunTime() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Hong_Kong",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.hour}${values.minute}`;
}

function validateRunTime(runTime) {
  if (!/^\d{4}$/.test(runTime)) {
    throw new Error("--run-time must use HHmm format, for example 0815.");
  }
  const hour = Number(runTime.slice(0, 2));
  const minute = Number(runTime.slice(2, 4));
  if (hour > 23 || minute > 59) {
    throw new Error("--run-time must be a valid Hong Kong time in HHmm format.");
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

async function readJsonIfExists(url, fallback = null) {
  try {
    return JSON.parse(await readFile(url, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(url, data) {
  await mkdir(new URL("./", url), { recursive: true });
  await writeFile(url, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function sortByHeat(clusters) {
  return [...clusters].sort((left, right) => {
    if (Number(right.heat_score ?? 0) !== Number(left.heat_score ?? 0)) {
      return Number(right.heat_score ?? 0) - Number(left.heat_score ?? 0);
    }
    return String(right.latest_published_at ?? "").localeCompare(String(left.latest_published_at ?? ""));
  });
}

function fallbackHeadline(cluster) {
  return buildEditorialHeadline(cluster);
}

function displayHeadline(cluster, warnings, shouldWarn = true) {
  if (cluster.headline_zh_hant && !isBadUserFacingHeadline(cluster.headline_zh_hant, cluster)) return cluster.headline_zh_hant;
  if (shouldWarn) warnings.push(`${cluster.cluster_id}: missing or invalid headline_zh_hant; deterministic editorial headline used`);
  return fallbackHeadline(cluster);
}

function displayText(cluster, field, fallback, warnings, shouldWarn = true) {
  if (cluster[field]) return cluster[field];
  if (shouldWarn) warnings.push(`${cluster.cluster_id}: missing ${field}; deterministic placeholder used`);
  return fallback;
}

function sourceLinks(cluster) {
  return asArray(cluster.articles).map((article) => ({
    source: article.source,
    title: article.title ?? "",
    url: article.url ?? "",
    published_at: article.published_at ?? null,
  }));
}

function finalCluster(cluster, rank, warnings) {
  const categories = asArray(cluster.categories);
  const relatedMarkets = asArray(cluster.related_markets).length > 0 ? cluster.related_markets : categories;
  const relatedAssets = asArray(cluster.related_assets);
  const summaryType = cluster.summary_type ?? "none";
  const notSummarized = summaryType === "none";
  const shouldWarnForMissingDisplayFields = !notSummarized;
  const headline = displayHeadline(cluster, warnings, shouldWarnForMissingDisplayFields);

  return {
    cluster_id: cluster.cluster_id,
    rank,
    headline_zh_hant: headline,
    summary_zh_hant: displayText(
      cluster,
      "summary_zh_hant",
      notSummarized ? "此主題暫未進入本輪 AI 摘要範圍，僅保留分類、熱度與來源連結供參考。" : "目前公開資訊有限。",
      warnings,
      shouldWarnForMissingDisplayFields,
    ),
    what_happened_zh_hant: displayText(
      cluster,
      "what_happened_zh_hant",
      notSummarized ? "此主題未被選入前 30 個摘要項目；目前只提供來源連結與熱度資訊。" : "目前公開資訊有限。",
      warnings,
      shouldWarnForMissingDisplayFields,
    ),
    key_points_zh_hant:
      asArray(cluster.key_points_zh_hant).length > 0
        ? cluster.key_points_zh_hant
        : [
            `分類：${categories.join("、") || "未分類"}`,
            `熱度分數：${Number(cluster.heat_score ?? 0)}`,
          ],
    why_it_matters_zh_hant: displayText(
      cluster,
      "why_it_matters_zh_hant",
      "此主題的重要性目前以熱度分數、來源數量與分類結果作初步判斷；詳細解讀需等待正式摘要。",
      warnings,
      shouldWarnForMissingDisplayFields,
    ),
    watch_next_zh_hant: displayText(
      cluster,
      "watch_next_zh_hant",
      "後續可觀察是否有更多來源跟進或提供新的公開資訊。",
      warnings,
      shouldWarnForMissingDisplayFields,
    ),
    summary_type: summaryType,
    heat_score: Number(cluster.heat_score ?? 0),
    heat_level: cluster.heat_level ?? "very_low",
    heat_reasons: asArray(cluster.heat_reasons),
    categories,
    related_markets: relatedMarkets,
    related_assets: relatedAssets,
    source_count: Number(cluster.source_count ?? unique(asArray(cluster.articles).map((article) => article.source)).length),
    source_links: sourceLinks(cluster),
    ai_status: cluster.ai_status ?? "unknown",
    ai_model: cluster.ai_model ?? null,
    ai_usage_estimate: cluster.ai_usage_estimate ?? null,
    summary_quality_flags: asArray(cluster.summary_quality_flags),
    debug: {
      cluster_title_candidate: cluster.cluster_title_candidate ?? null,
      latest_published_at: cluster.latest_published_at ?? null,
    },
  };
}

function determineMarketMood(clusters) {
  const top = clusters.slice(0, 10);
  const topCategories = top.flatMap((cluster) => asArray(cluster.categories));
  const riskOnScore = topCategories.filter((category) =>
    ["AI", "半導體", "科技公司", "美股", "中概", "港股", "加密"].includes(category),
  ).length;
  const riskOffScore = topCategories.filter((category) =>
    ["宏觀", "外匯", "商品", "地緣政治"].includes(category),
  ).length;
  const highHeatCount = top.filter((cluster) => ["very_high", "high"].includes(cluster.heat_level)).length;

  if (riskOnScore >= riskOffScore + 3 && highHeatCount > 0) return "risk_on";
  if (riskOffScore >= riskOnScore + 3 && highHeatCount > 0) return "risk_off";
  if (Math.abs(riskOnScore - riskOffScore) <= 2 && top.length > 0) return "mixed";
  return "neutral";
}

function morningBrief(topClusters, mood) {
  return buildMorningBrief(topClusters, MOOD_LABELS[mood]);
}

function sourceStatusList(sourceStatusData) {
  return asArray(sourceStatusData?.sources).map((item) => ({
    source: item.source,
    status: item.status,
    article_count: Number(item.article_count ?? 0),
    error_message: item.error_message ?? "",
    fetched_at: item.fetched_at ?? null,
  }));
}

function stats({ sourceStatus, clusters, aiReport, generatedAt }) {
  const sourceCount = sourceStatus.length || unique(clusters.flatMap((cluster) => asArray(cluster.source_links).map((link) => link.source))).length;
  const articleCount =
    sourceStatus.length > 0
      ? sourceStatus.reduce((sum, item) => sum + Number(item.article_count ?? 0), 0)
      : clusters.reduce((sum, cluster) => sum + asArray(cluster.source_links).length, 0);

  return {
    source_count: sourceCount,
    article_count: articleCount,
    cluster_count: clusters.length,
    summarized_cluster_count: clusters.filter((cluster) => cluster.summary_type !== "none").length,
    detailed_summary_count: Number(aiReport?.detailed_summary_count ?? clusters.filter((cluster) => cluster.summary_type === "detailed").length),
    brief_summary_count: Number(aiReport?.brief_summary_count ?? clusters.filter((cluster) => cluster.summary_type === "brief").length),
    skipped_cluster_count: clusters.filter((cluster) => cluster.summary_type === "none").length,
    very_high_heat_count: clusters.filter((cluster) => cluster.heat_level === "very_high").length,
    high_heat_count: clusters.filter((cluster) => cluster.heat_level === "high").length,
    generated_at: generatedAt,
  };
}

function labelForRun(date, runTime) {
  const hourMinute = Number(runTime);
  let period = "早報";
  if (hourMinute >= 1100 && hourMinute <= 1459) period = "午報";
  else if (hourMinute >= 1500 && hourMinute <= 1859) period = "午後更新";
  else if (hourMinute >= 1900) period = "晚報";

  const [year, month, day] = date.split("-");
  return `${year}年${month}月${day}日${period}`;
}

function updateArchiveIndex(existingIndex, entry) {
  const existingItems = asArray(existingIndex?.items ?? existingIndex?.archives);
  const withoutCurrent = existingItems.filter((item) => item.archive_id && item.archive_id !== entry.archive_id);
  return {
    generated_at: nowIso(),
    items: [entry, ...withoutCurrent].sort((left, right) => String(right.archive_id).localeCompare(String(left.archive_id))),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const date = args.date ?? hongKongDate();
  const runTime = args.runTime ?? hongKongRunTime();
  validateRunTime(runTime);
  const archiveId = `${date}-${runTime}`;
  const generatedAt = nowIso();
  const warnings = [];
  const summaryData = await readJsonIfExists(SUMMARY_FILE);
  const sourceStatusData = await readJsonIfExists(SOURCE_STATUS_FILE, { sources: [] });
  const aiReport = await readJsonIfExists(AI_SUMMARY_REPORT_FILE, null);
  const scoreReport = await readJsonIfExists(SCORE_REPORT_FILE, null);

  if (!summaryData) {
    throw new Error("Missing data/runtime/summarized_clusters.json. Run the Phase 6 summarization step first.");
  }

  const sortedInputClusters = sortByHeat(asArray(summaryData.clusters));
  const clusters = sortedInputClusters.map((cluster, index) => finalCluster(cluster, index + 1, warnings));
  const topFive = clusters.slice(0, 5).map((cluster, index) => ({
    rank: index + 1,
    headline_zh_hant: cluster.headline_zh_hant,
    brief_reason_zh_hant: buildBriefReason(cluster),
    heat_score: cluster.heat_score,
    categories: cluster.categories,
    related_assets: cluster.related_assets,
    cluster_id: cluster.cluster_id,
  }));
  const mood = determineMarketMood(clusters);
  const sourceStatus = sourceStatusList(sourceStatusData);

  const brief = {
    date,
    run_time_hkt: runTime,
    archive_id: archiveId,
    generated_at: generatedAt,
    timezone: "Asia/Hong_Kong",
    site_title: "Tiny Dream News V2",
    market_mood: mood,
    market_mood_label_zh_hant: MOOD_LABELS[mood],
    morning_brief_zh_hant: morningBrief(clusters.slice(0, 10), mood),
    top_five: topFive,
    stats: stats({ sourceStatus, clusters, aiReport, generatedAt }),
    clusters,
    source_status: sourceStatus,
    ai_usage: aiReport?.estimated_total_ai_usage ?? null,
    warnings: unique([...(aiReport?.warnings ?? []), ...warnings]),
  };

  const latestUrl = new URL("latest.json", DAILY_DIR);
  const archiveUrl = new URL(`${archiveId}.json`, ARCHIVE_DIR);
  const archiveAliasUrl = new URL(`${date}.json`, ARCHIVE_DIR);
  const archiveIndexUrl = new URL("index.json", ARCHIVE_DIR);
  const archiveSearchIndexUrl = new URL("archive-search-index.json", SEARCH_DIR);
  const categoryIndexUrl = new URL("category-index.json", ARCHIVE_DIR);
  const reportUrl = new URL("daily_brief_report.json", RUNTIME_DIR);
  const existingArchiveIndex = await readJsonIfExists(archiveIndexUrl, { items: [] });
  const existingArchiveSearchIndex = await readJsonIfExists(archiveSearchIndexUrl, { items: [] });
  const archiveIndex = mergeArchiveIndex(existingArchiveIndex, brief);
  const archiveSearchIndex = mergeArchiveSearchIndex(existingArchiveSearchIndex, brief);
  const categoryIndex = buildCategoryIndex(archiveSearchIndex);
  const archiveIndexPreviousCount = asArray(existingArchiveIndex?.items ?? existingArchiveIndex?.archives).length;
  const searchIndexPreviousCount = asArray(existingArchiveSearchIndex?.items).length;

  const validationResults = {
    latest_has_required_fields: Boolean(brief.date && brief.generated_at && brief.morning_brief_zh_hant && brief.top_five && brief.stats && brief.clusters),
    top_five_count: topFive.length,
    clusters_sorted_by_heat_score: clusters.every((cluster, index) => index === 0 || clusters[index - 1].heat_score >= cluster.heat_score),
    official_headlines_use_zh_hant: clusters.every((cluster) => Boolean(cluster.headline_zh_hant)),
    source_score_report_available: Boolean(scoreReport),
  };

  const report = {
    generated_at: generatedAt,
    date,
    run_time_hkt: runTime,
    archive_id: archiveId,
    input_cluster_count: sortedInputClusters.length,
    output_cluster_count: clusters.length,
    archive_path: `data/archive/${archiveId}.json`,
    archive_alias_path: `data/archive/${date}.json`,
    latest_path: "data/daily/latest.json",
    archive_index_path: "data/archive/index.json",
    archive_search_index_path: "data/search/archive-search-index.json",
    category_index_path: "data/archive/category-index.json",
    archive_index_previous_count: archiveIndexPreviousCount,
    archive_index_count: archiveIndex.items.length,
    search_index_previous_count: searchIndexPreviousCount,
    search_index_count: archiveSearchIndex.items.length,
    category_index_category_count: categoryIndex.categories.length,
    top_five_cluster_ids: topFive.map((item) => item.cluster_id),
    warnings: brief.warnings,
    validation_results: validationResults,
  };

  await mkdir(DAILY_DIR, { recursive: true });
  await mkdir(ARCHIVE_DIR, { recursive: true });
  await mkdir(SEARCH_DIR, { recursive: true });
  await mkdir(RUNTIME_DIR, { recursive: true });
  await writeJson(latestUrl, brief);
  await writeJson(archiveUrl, brief);
  await writeJson(archiveAliasUrl, brief);
  await writeJson(archiveIndexUrl, archiveIndex);
  await writeJson(archiveSearchIndexUrl, archiveSearchIndex);
  await writeJson(categoryIndexUrl, categoryIndex);
  await writeJson(reportUrl, report);

  console.log(
    JSON.stringify(
      {
        generated_at: generatedAt,
        date,
        run_time_hkt: runTime,
        archive_id: archiveId,
        output_cluster_count: clusters.length,
        top_five_cluster_ids: report.top_five_cluster_ids,
        market_mood: mood,
        outputs: [
          "data/daily/latest.json",
          `data/archive/${archiveId}.json`,
          `data/archive/${date}.json`,
          "data/archive/index.json",
          "data/search/archive-search-index.json",
          "data/archive/category-index.json",
          "data/runtime/daily_brief_report.json",
        ],
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
