import { access, readFile } from "node:fs/promises";

const SUMMARY_FILE = new URL("../data/runtime/summarized_clusters.json", import.meta.url);
const REPORT_FILE = new URL("../data/runtime/ai_summary_report.json", import.meta.url);
const PROMPT_SAMPLES_FILE = new URL("../data/runtime/ai_prompt_samples.json", import.meta.url);
const CONFIG_FILE = new URL("../config/ai-summary-config.json", import.meta.url);

const USER_FACING_FIELDS = [
  "headline_zh_hant",
  "summary_zh_hant",
  "what_happened_zh_hant",
  "key_points_zh_hant",
  "why_it_matters_zh_hant",
  "watch_next_zh_hant",
];
const COMMON_SIMPLIFIED_CHARS = /[这测试资讯数据为会后关联储鲍胀债经济贸币国产发现点简体与将观导称类来对应响时间较场题报显]/;
const VALID_SUMMARIZED_STATUSES = new Set(["mock_generated", "success", "failed_fallback_used"]);
const VALID_SKIPPED_STATUSES = new Set(["skipped_not_top_ranked", "skipped_budget_limit"]);

async function fileExists(url) {
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

function flattenUserFacingValues(cluster) {
  const values = [];

  for (const field of USER_FACING_FIELDS) {
    const value = cluster[field];
    if (Array.isArray(value)) values.push(...value);
    else if (value != null) values.push(value);
  }

  for (const link of cluster.source_links ?? []) {
    if (link.label_zh_hant) values.push(link.label_zh_hant);
  }

  return values.map((value) => String(value));
}

function hasCommonSimplifiedText(values) {
  return values.some((value) => COMMON_SIMPLIFIED_CHARS.test(value));
}

async function main() {
  const errors = [];
  const summaryExists = await fileExists(SUMMARY_FILE);
  const reportExists = await fileExists(REPORT_FILE);
  const promptSamplesExists = await fileExists(PROMPT_SAMPLES_FILE);

  if (!summaryExists) errors.push("data/runtime/summarized_clusters.json does not exist");
  if (!reportExists) errors.push("data/runtime/ai_summary_report.json does not exist");
  if (!promptSamplesExists) errors.push("data/runtime/ai_prompt_samples.json does not exist");

  if (!summaryExists || !reportExists || !promptSamplesExists) {
    throw new Error(errors.join("\n"));
  }

  const config = await readJson(CONFIG_FILE);
  const summaryData = await readJson(SUMMARY_FILE);
  const report = await readJson(REPORT_FILE);
  const promptSamples = await readJson(PROMPT_SAMPLES_FILE);
  const clusters = Array.isArray(summaryData.clusters) ? summaryData.clusters : [];
  const summarizedClusters = clusters.filter((cluster) => cluster.summary_type !== "none");
  const skippedClusters = clusters.filter((cluster) => cluster.summary_type === "none");
  const maxTotalSummaries = Number(process.env.AI_MAX_TOTAL_SUMMARIES ?? config.max_total_summaries);

  if (summarizedClusters.length > maxTotalSummaries) {
    errors.push(`More than max_total_summaries were summarized: ${summarizedClusters.length}`);
  }

  for (const cluster of summarizedClusters) {
    for (const field of USER_FACING_FIELDS) {
      if (!(field in cluster)) errors.push(`${cluster.cluster_id}: missing ${field}`);
    }

    if (!cluster.headline_zh_hant) errors.push(`${cluster.cluster_id}: missing headline_zh_hant`);
    if (!cluster.what_happened_zh_hant) errors.push(`${cluster.cluster_id}: missing what_happened_zh_hant`);
    if (!cluster.why_it_matters_zh_hant) errors.push(`${cluster.cluster_id}: missing why_it_matters_zh_hant`);
    if (!cluster.watch_next_zh_hant) errors.push(`${cluster.cluster_id}: missing watch_next_zh_hant`);
    if (!Array.isArray(cluster.key_points_zh_hant) || cluster.key_points_zh_hant.length === 0) {
      errors.push(`${cluster.cluster_id}: key_points_zh_hant must be a non-empty array`);
    }
    if (!Array.isArray(cluster.source_links)) errors.push(`${cluster.cluster_id}: source_links must be an array`);
    if (!VALID_SUMMARIZED_STATUSES.has(cluster.ai_status)) {
      errors.push(`${cluster.cluster_id}: invalid summarized ai_status ${cluster.ai_status}`);
    }

    if (hasCommonSimplifiedText(flattenUserFacingValues(cluster))) {
      errors.push(`${cluster.cluster_id}: user-facing fields contain common Simplified Chinese characters`);
    }
  }

  for (const cluster of skippedClusters) {
    if (!VALID_SKIPPED_STATUSES.has(cluster.ai_status)) {
      errors.push(`${cluster.cluster_id}: skipped cluster has invalid ai_status`);
    }
  }

  if (typeof report.mock_mode !== "boolean") errors.push("ai_summary_report.json mock_mode must be boolean");
  if (!report.model) errors.push("ai_summary_report.json missing model");
  if (!report.estimated_total_ai_usage) errors.push("ai_summary_report.json missing estimated_total_ai_usage");
  if (report.detailed_summary_count + report.brief_summary_count !== summarizedClusters.length) {
    errors.push("ai_summary_report.json summary counts do not match summarized clusters");
  }
  if (report.skipped_count !== skippedClusters.length) {
    errors.push("ai_summary_report.json skipped_count does not match skipped clusters");
  }
  if (!Array.isArray(promptSamples.samples) || promptSamples.samples.length < 2) {
    errors.push("ai_prompt_samples.json must contain at least one detailed and one brief prompt sample");
  }

  const sampleTypes = new Set((promptSamples.samples ?? []).map((sample) => sample.sample_type));
  if (!sampleTypes.has("detailed")) errors.push("ai_prompt_samples.json missing detailed prompt sample");
  if (!sampleTypes.has("brief")) errors.push("ai_prompt_samples.json missing brief prompt sample");

  for (const sample of promptSamples.samples ?? []) {
    const instructions = sample.prompt_payload?.instructions ?? [];
    const zhHantRequirements = sample.prompt_payload?.zh_hant_requirements ?? [];
    const combinedInstructionText = [...instructions, ...zhHantRequirements].join("\n");

    if (!Array.isArray(zhHantRequirements) || zhHantRequirements.length === 0) {
      errors.push(`${sample.sample_type}: missing Traditional Chinese instruction block`);
    }
    if (!combinedInstructionText.includes("Return valid JSON only")) {
      errors.push(`${sample.sample_type}: missing Return valid JSON only instruction`);
    }
    if (!combinedInstructionText.includes("Do not include Markdown") && !combinedInstructionText.includes("不要輸出 Markdown")) {
      errors.push(`${sample.sample_type}: missing no Markdown instruction`);
    }
    if (!combinedInstructionText.includes("Do not include explanations outside the JSON") && !combinedInstructionText.includes("不要在 JSON 外加入任何說明")) {
      errors.push(`${sample.sample_type}: missing no extra explanation instruction`);
    }
    if (!combinedInstructionText.includes("不要輸出簡體中文")) {
      errors.push(`${sample.sample_type}: missing no Simplified Chinese Traditional Chinese instruction`);
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  console.log(
    JSON.stringify(
      {
        status: "passed",
        cluster_count: clusters.length,
        summarized_count: summarizedClusters.length,
        detailed_count: report.detailed_summary_count,
        brief_count: report.brief_summary_count,
        skipped_count: skippedClusters.length,
        mock_mode: report.mock_mode,
        model: report.model,
        prompt_sample_count: promptSamples.samples.length,
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
