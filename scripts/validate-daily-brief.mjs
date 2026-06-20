import { access, readFile, readdir } from "node:fs/promises";
import { hasBadUserFacingText, hasCommonSimplifiedChars, isBadUserFacingHeadline } from "./user-facing-copy.mjs";

const DAILY_FILE = new URL("../data/daily/latest.json", import.meta.url);
const ARCHIVE_DIR = new URL("../data/archive/", import.meta.url);
const ARCHIVE_INDEX_FILE = new URL("../data/archive/index.json", import.meta.url);
const ARCHIVE_SEARCH_INDEX_FILE = new URL("../data/search/archive-search-index.json", import.meta.url);
const CATEGORY_INDEX_FILE = new URL("../data/archive/category-index.json", import.meta.url);
const REPORT_FILE = new URL("../data/runtime/daily_brief_report.json", import.meta.url);
const AI_REPORT_FILE = new URL("../data/runtime/daily_brief_ai_report.json", import.meta.url);
const AI_PROMPT_SAMPLE_FILE = new URL("../data/runtime/daily_brief_ai_prompt_sample.json", import.meta.url);
const GENERATOR_FILE = new URL("./generate-daily-brief.mjs", import.meta.url);
const VALID_MARKET_MOODS = new Set(["risk_on", "risk_off", "neutral", "mixed"]);
const VALID_DAILY_BRIEF_AI_STATUSES = new Set(["mock", "success", "failed_fallback_used"]);
const COMMON_SIMPLIFIED_CHARS = /[这为与发后业东个会来时们国对称产经见实现过涨亿万广气报团际质证龙门车网]/;
const INVESTMENT_ADVICE_PATTERN =
  /(買入|賣出|持有|加倉|減倉|建議買|建議賣|投資建議|目標價|price target|buy rating|sell rating|hold rating|should buy|should sell)/i;
const PRICE_PREDICTION_PATTERN =
  /(將上升|將下跌|會升至|會跌至|上望|下望|看漲至|看跌至|will rise|will fall|could rise to|could fall to|target price)/i;
const GENERIC_AI_OUTPUT_PATTERN = /(placeholder|lorem ipsum|測試資料流程|正式摘要會在)/i;

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--date") {
      args.date = argv[index + 1];
      index += 1;
    } else if (argv[index] === "--run-time") {
      args.runTime = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

async function exists(url) {
  try {
    await access(url);
    return true;
  } catch {
    return false;
  }
}

async function readJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

async function archiveHasDateSubfolder() {
  const entries = await readdir(ARCHIVE_DIR, { withFileTypes: true });
  return entries.some((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name));
}

function isSortedByHeat(clusters) {
  return clusters.every((cluster, index) => index === 0 || Number(clusters[index - 1].heat_score ?? 0) >= Number(cluster.heat_score ?? 0));
}

function hasDisplayFields(cluster) {
  return Boolean(
    cluster.headline_zh_hant &&
      cluster.what_happened_zh_hant &&
      cluster.why_it_matters_zh_hant &&
      cluster.watch_next_zh_hant,
  );
}

function officialHeadlineDoesNotUseCandidate(cluster) {
  const candidate = cluster.debug?.cluster_title_candidate;
  return !candidate || cluster.headline_zh_hant !== candidate;
}

async function generatorHasNoAiCall() {
  const content = await readFile(GENERATOR_FILE, "utf8");
  return !/(Cloudflare|CLOUDFLARE|AI\.run|fetch\(|Authorization|api\.cloudflare\.com)/i.test(content);
}

function promptSampleExcludesRawArticleData(promptSample) {
  const text = JSON.stringify(promptSample.prompt_payload ?? {});
  return !/"articles"\s*:|source_links|source_links|published_at|url|snippet|source_title/i.test(text);
}

function dailyUserFacingValues(latest) {
  return [
    latest.morning_brief_zh_hant,
    latest.market_mood_label_zh_hant,
    ...((latest.top_five ?? []).map((item) => item.headline_zh_hant).filter(Boolean)),
    ...((latest.top_five ?? []).map((item) => item.brief_reason_zh_hant).filter(Boolean)),
    ...((latest.clusters ?? []).map((cluster) => cluster.headline_zh_hant).filter(Boolean)),
  ].map((value) => String(value ?? ""));
}

function validateDailyUserFacingText(latest, errors) {
  const values = dailyUserFacingValues(latest);
  const combined = values.join("\n");
  if (!latest.morning_brief_zh_hant?.trim()) errors.push("latest.json missing or empty morning_brief_zh_hant");
  if (latest.morning_brief_zh_hant && latest.morning_brief_zh_hant.length < 40) {
    errors.push("morning_brief_zh_hant is too short to be useful");
  }
  if (!values.every((value) => !value || /[\u3400-\u9fff]/.test(value))) {
    errors.push("daily user-facing fields must contain Traditional Chinese text");
  }
  if (values.some(hasCommonSimplifiedChars)) {
    errors.push("daily user-facing fields contain Simplified Chinese characters");
  }
  if (values.some(hasBadUserFacingText)) {
    errors.push("daily user-facing fields contain fallback labels or mojibake");
  }
  if (INVESTMENT_ADVICE_PATTERN.test(combined)) {
    errors.push("daily user-facing fields contain investment advice language");
  }
  if (PRICE_PREDICTION_PATTERN.test(combined)) {
    errors.push("daily user-facing fields contain price prediction language");
  }
  if (latest.daily_brief_ai_status !== "mock" && GENERIC_AI_OUTPUT_PATTERN.test(combined)) {
    errors.push("daily user-facing fields contain generic placeholder text");
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const errors = [];

  if (!(await exists(DAILY_FILE))) errors.push("data/daily/latest.json does not exist");
  if (!(await exists(ARCHIVE_INDEX_FILE))) errors.push("data/archive/index.json does not exist");
  if (!(await exists(ARCHIVE_SEARCH_INDEX_FILE))) errors.push("data/search/archive-search-index.json does not exist");
  if (!(await exists(CATEGORY_INDEX_FILE))) errors.push("data/archive/category-index.json does not exist");
  if (!(await exists(REPORT_FILE))) errors.push("data/runtime/daily_brief_report.json does not exist");

  if (errors.length > 0) throw new Error(errors.join("\n"));

  const latest = await readJson(DAILY_FILE);
  const date = args.date ?? latest.date;
  const runTime = args.runTime ?? latest.run_time_hkt;
  const archiveId = latest.archive_id ?? (date && runTime ? `${date}-${runTime}` : null);
  const timestampedArchiveFile = archiveId ? new URL(`${archiveId}.json`, ARCHIVE_DIR) : null;
  const archiveAliasFile = new URL(`${date}.json`, ARCHIVE_DIR);

  if (!archiveId) errors.push("latest.json missing archive_id");
  if (!latest.run_time_hkt) errors.push("latest.json missing run_time_hkt");
  if (archiveId && !/^\d{4}-\d{2}-\d{2}-\d{4}$/.test(archiveId)) errors.push("latest.json archive_id must use YYYY-MM-DD-HHmm format");
  if (latest.run_time_hkt && !/^\d{4}$/.test(latest.run_time_hkt)) errors.push("latest.json run_time_hkt must use HHmm format");
  if (timestampedArchiveFile && !(await exists(timestampedArchiveFile))) errors.push(`data/archive/${archiveId}.json does not exist`);
  if (!(await exists(archiveAliasFile))) errors.push(`data/archive/${date}.json does not exist`);
  if (!latest.date) errors.push("latest.json missing date");
  if (!latest.generated_at) errors.push("latest.json missing generated_at");
  if (latest.timezone !== "Asia/Hong_Kong") errors.push("latest.json timezone must be Asia/Hong_Kong");
  if (!latest.morning_brief_zh_hant) errors.push("latest.json missing morning_brief_zh_hant");
  if (!VALID_MARKET_MOODS.has(latest.market_mood)) errors.push("latest.json has invalid market_mood");
  if (!latest.market_mood_label_zh_hant) errors.push("latest.json missing market_mood_label_zh_hant");
  if (!Array.isArray(latest.top_five)) errors.push("latest.json missing top_five");
  if (!latest.stats) errors.push("latest.json missing stats");
  if (!Array.isArray(latest.clusters)) errors.push("latest.json missing clusters");
  validateDailyUserFacingText(latest, errors);

  if (Array.isArray(latest.clusters) && Array.isArray(latest.top_five)) {
    if (latest.clusters.length >= 5 && latest.top_five.length !== 5) {
      errors.push("top_five must contain exactly 5 items when at least 5 clusters exist");
    }
    for (const item of latest.top_five) {
      if (!item.headline_zh_hant) {
        errors.push(`${item.cluster_id}: top_five item missing headline_zh_hant`);
      }
      if (isBadUserFacingHeadline(item.headline_zh_hant, item)) {
        errors.push(`${item.cluster_id}: top_five headline_zh_hant is a fallback label, category/entity concatenation, or mojibake`);
      }
      if ("daily_brief_ai_status" in latest && !item.brief_reason_zh_hant) {
        errors.push(`${item.cluster_id}: top_five item missing brief_reason_zh_hant`);
      }
    }

    if (!isSortedByHeat(latest.clusters)) errors.push("clusters are not sorted by heat_score descending");

    for (const cluster of latest.clusters) {
      if (!hasDisplayFields(cluster)) {
        errors.push(`${cluster.cluster_id}: missing required display field`);
      }
      if (!Array.isArray(cluster.source_links) || cluster.source_links.length === 0) {
        errors.push(`${cluster.cluster_id}: source links were removed`);
      }
      if (!officialHeadlineDoesNotUseCandidate(cluster)) {
        errors.push(`${cluster.cluster_id}: headline_zh_hant falls back to cluster_title_candidate`);
      }
      if (isBadUserFacingHeadline(cluster.headline_zh_hant, cluster)) {
        errors.push(`${cluster.cluster_id}: headline_zh_hant is a fallback label, category/entity concatenation, or mojibake`);
      }
    }
  }

  const archiveIndex = await readJson(ARCHIVE_INDEX_FILE);
  const archiveItems = Array.isArray(archiveIndex.items) ? archiveIndex.items : [];
  const currentArchiveIndexItem = archiveItems.find((item) => item.archive_id === archiveId);
  if (!currentArchiveIndexItem) {
    errors.push(`archive/index.json missing archive_id ${archiveId}`);
  } else {
    if (currentArchiveIndexItem.path !== `/archive/${archiveId}.json`) {
      errors.push(`archive/index.json path must use flat filename /archive/${archiveId}.json`);
    }
    if (currentArchiveIndexItem.date !== date) errors.push("archive/index.json current item date mismatch");
    if (currentArchiveIndexItem.run_time_hkt !== runTime) errors.push("archive/index.json current item run_time_hkt mismatch");
    if (!currentArchiveIndexItem.label_zh_hant) errors.push("archive/index.json current item missing label_zh_hant");
    if (!("market_mood" in currentArchiveIndexItem)) errors.push("archive/index.json current item missing market_mood");
    if (!currentArchiveIndexItem.market_mood_label_zh_hant) errors.push("archive/index.json current item missing market_mood_label_zh_hant");
    if (!Array.isArray(currentArchiveIndexItem.top_five_headlines)) errors.push("archive/index.json current item missing top_five_headlines");
    if (!Array.isArray(currentArchiveIndexItem.categories)) errors.push("archive/index.json current item missing categories");
    if (!Array.isArray(currentArchiveIndexItem.related_assets)) errors.push("archive/index.json current item missing related_assets");
    if (!("source_count" in currentArchiveIndexItem)) errors.push("archive/index.json current item missing source_count");
    if (!("article_count" in currentArchiveIndexItem)) errors.push("archive/index.json current item missing article_count");
    if (!("cluster_count" in currentArchiveIndexItem)) errors.push("archive/index.json current item missing cluster_count");
    if (!("ai_summary_count" in currentArchiveIndexItem)) errors.push("archive/index.json current item missing ai_summary_count");
  }
  if (
    archiveItems.some(
      (item, index) => index > 0 && String(archiveItems[index - 1].generated_at ?? "") < String(item.generated_at ?? ""),
    )
  ) {
    errors.push("archive/index.json items are not sorted by generated_at descending");
  }
  if (await archiveHasDateSubfolder()) {
    errors.push("data/archive must not contain YYYY-MM-DD date subfolders");
  }

  const archiveSearchIndex = await readJson(ARCHIVE_SEARCH_INDEX_FILE);
  const archiveSearchItems = Array.isArray(archiveSearchIndex.items) ? archiveSearchIndex.items : [];
  const currentSearchItems = archiveSearchItems.filter((item) => item.archive_id === archiveId);
  if (Array.isArray(latest.clusters) && currentSearchItems.length !== latest.clusters.length) {
    errors.push(`archive-search-index.json should include ${latest.clusters.length} items for ${archiveId}, found ${currentSearchItems.length}`);
  }
  for (const item of currentSearchItems) {
    for (const field of [
      "archive_id",
      "date",
      "run_time_hkt",
      "cluster_id",
      "headline_zh_hant",
      "summary_zh_hant",
      "what_happened_zh_hant",
      "why_it_matters_zh_hant",
      "watch_next_zh_hant",
      "heat_level",
      "archive_path",
    ]) {
      if (!(field in item)) errors.push(`archive-search-index.json item ${item.cluster_id} missing ${field}`);
    }
    if (!Array.isArray(item.categories)) errors.push(`archive-search-index.json item ${item.cluster_id} missing categories`);
    if (!Array.isArray(item.related_assets)) errors.push(`archive-search-index.json item ${item.cluster_id} missing related_assets`);
    if (!Array.isArray(item.source_names)) errors.push(`archive-search-index.json item ${item.cluster_id} missing source_names`);
    if (!Array.isArray(item.source_urls) || item.source_urls.length === 0) errors.push(`archive-search-index.json item ${item.cluster_id} missing source_urls`);
    if (!Array.isArray(item.keywords)) errors.push(`archive-search-index.json item ${item.cluster_id} missing keywords`);
    if (typeof item.heat_score !== "number") errors.push(`archive-search-index.json item ${item.cluster_id} missing numeric heat_score`);
  }

  const categoryIndex = await readJson(CATEGORY_INDEX_FILE);
  const categoryEntries = Array.isArray(categoryIndex.categories) ? categoryIndex.categories : [];
  if (categoryEntries.length === 0 && currentSearchItems.length > 0) errors.push("category-index.json has no category entries");
  const categoryItemKeys = new Set(
    categoryEntries.flatMap((entry) => (Array.isArray(entry.items) ? entry.items : []).map((item) => `${item.archive_id}:${item.cluster_id}`)),
  );
  for (const item of currentSearchItems.filter((searchItem) => searchItem.categories.length > 0)) {
    if (!categoryItemKeys.has(`${item.archive_id}:${item.cluster_id}`)) {
      errors.push(`category-index.json missing ${item.archive_id}:${item.cluster_id}`);
    }
  }

  const report = await readJson(REPORT_FILE);
  if (report.date !== date) errors.push("daily_brief_report.json date does not match latest.json");
  if (report.archive_id !== archiveId) errors.push("daily_brief_report.json archive_id does not match latest.json");
  if (Number(report.archive_index_count ?? 0) < Number(report.archive_index_previous_count ?? 0)) {
    errors.push("archive/index.json appears to have removed previous archive entries");
  }
  if (Number(report.search_index_count ?? 0) < Number(report.search_index_previous_count ?? 0)) {
    errors.push("archive-search-index.json appears to have removed previous search entries");
  }
  if (!(await generatorHasNoAiCall())) errors.push("generate-daily-brief.mjs appears to contain AI or Cloudflare call code");

  if ("daily_brief_ai_status" in latest) {
    if (!VALID_DAILY_BRIEF_AI_STATUSES.has(latest.daily_brief_ai_status)) {
      errors.push("latest.json has invalid daily_brief_ai_status");
    }
    if (!latest.daily_brief_ai_model) errors.push("latest.json missing daily_brief_ai_model");
    if (!latest.daily_brief_ai_generated_at) errors.push("latest.json missing daily_brief_ai_generated_at");
    if (!(await exists(AI_REPORT_FILE))) errors.push("data/runtime/daily_brief_ai_report.json does not exist");
    if (!(await exists(AI_PROMPT_SAMPLE_FILE))) errors.push("data/runtime/daily_brief_ai_prompt_sample.json does not exist");

    if (await exists(AI_PROMPT_SAMPLE_FILE)) {
      const aiPromptSample = await readJson(AI_PROMPT_SAMPLE_FILE);
      if (!promptSampleExcludesRawArticleData(aiPromptSample)) {
        errors.push("daily_brief_ai_prompt_sample.json appears to include raw article data or source URLs");
      }
      const promptClusterCount = aiPromptSample.prompt_payload?.top_clusters?.length ?? 0;
      if (promptClusterCount > 10) errors.push("daily_brief_ai_prompt_sample.json includes more than 10 clusters");
    }
  }

  if (errors.length > 0) throw new Error(errors.join("\n"));

  console.log(
    JSON.stringify(
      {
        status: "passed",
        date,
        run_time_hkt: runTime,
        archive_id: archiveId,
        cluster_count: latest.clusters.length,
        top_five_count: latest.top_five.length,
        archive_index_count: archiveItems.length,
        archive_search_index_count: archiveSearchItems.length,
        category_index_count: categoryEntries.length,
        no_ai_call_in_generator: true,
        daily_brief_ai_status: latest.daily_brief_ai_status ?? null,
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
