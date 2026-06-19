import { access, readFile } from "node:fs/promises";

const DAILY_FILE = new URL("../data/daily/latest.json", import.meta.url);
const ARCHIVE_DIR = new URL("../data/archive/", import.meta.url);
const ARCHIVE_INDEX_FILE = new URL("../data/archive/index.json", import.meta.url);
const REPORT_FILE = new URL("../data/runtime/daily_brief_report.json", import.meta.url);
const AI_REPORT_FILE = new URL("../data/runtime/daily_brief_ai_report.json", import.meta.url);
const AI_PROMPT_SAMPLE_FILE = new URL("../data/runtime/daily_brief_ai_prompt_sample.json", import.meta.url);
const GENERATOR_FILE = new URL("./generate-daily-brief.mjs", import.meta.url);
const VALID_MARKET_MOODS = new Set(["risk_on", "risk_off", "neutral", "mixed"]);
const VALID_DAILY_BRIEF_AI_STATUSES = new Set(["mock", "success", "failed_fallback_used"]);

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--date") {
      args.date = argv[index + 1];
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const errors = [];

  if (!(await exists(DAILY_FILE))) errors.push("data/daily/latest.json does not exist");
  if (!(await exists(ARCHIVE_INDEX_FILE))) errors.push("data/archive/index.json does not exist");
  if (!(await exists(REPORT_FILE))) errors.push("data/runtime/daily_brief_report.json does not exist");

  if (errors.length > 0) throw new Error(errors.join("\n"));

  const latest = await readJson(DAILY_FILE);
  const date = args.date ?? latest.date;
  const archiveFile = new URL(`${date}.json`, ARCHIVE_DIR);

  if (!(await exists(archiveFile))) errors.push(`data/archive/${date}.json does not exist`);
  if (!latest.date) errors.push("latest.json missing date");
  if (!latest.generated_at) errors.push("latest.json missing generated_at");
  if (!latest.morning_brief_zh_hant) errors.push("latest.json missing morning_brief_zh_hant");
  if (!VALID_MARKET_MOODS.has(latest.market_mood)) errors.push("latest.json has invalid market_mood");
  if (!latest.market_mood_label_zh_hant) errors.push("latest.json missing market_mood_label_zh_hant");
  if (!Array.isArray(latest.top_five)) errors.push("latest.json missing top_five");
  if (!latest.stats) errors.push("latest.json missing stats");
  if (!Array.isArray(latest.clusters)) errors.push("latest.json missing clusters");

  if (Array.isArray(latest.clusters) && Array.isArray(latest.top_five)) {
    if (latest.clusters.length >= 5 && latest.top_five.length !== 5) {
      errors.push("top_five must contain exactly 5 items when at least 5 clusters exist");
    }
    for (const item of latest.top_five) {
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
    }
  }

  const archiveIndex = await readJson(ARCHIVE_INDEX_FILE);
  const archiveItems = Array.isArray(archiveIndex.items) ? archiveIndex.items : [];
  if (!archiveItems.some((item) => item.date === date)) {
    errors.push(`archive/index.json missing date ${date}`);
  }

  const report = await readJson(REPORT_FILE);
  if (report.date !== date) errors.push("daily_brief_report.json date does not match latest.json");
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
        cluster_count: latest.clusters.length,
        top_five_count: latest.top_five.length,
        archive_index_count: archiveItems.length,
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
