import { readFile, writeFile, mkdir } from "node:fs/promises";
import { buildCategoryIndex, mergeArchiveIndex, mergeArchiveSearchIndex } from "./archive-indexes.mjs";
import {
  buildBriefReason,
  buildMorningBrief,
  ensureEditorialHeadline,
  hasBadUserFacingText,
  hasCommonSimplifiedChars,
} from "./user-facing-copy.mjs";

const DAILY_FILE = new URL("../data/daily/latest.json", import.meta.url);
const ARCHIVE_DIR = new URL("../data/archive/", import.meta.url);
const SEARCH_DIR = new URL("../data/search/", import.meta.url);
const RUNTIME_DIR = new URL("../data/runtime/", import.meta.url);
const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";
const MOCK_MODEL_NAME = "mock-daily-brief-editorial-zh-hant";
const VALID_MARKET_MOODS = new Set(["risk_on", "risk_off", "neutral", "mixed"]);
const MAX_PROMPT_CLUSTERS = 10;
const MAX_AI_REQUESTS = 2;

const SUMMARY_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    morning_brief_zh_hant: { type: "string" },
    market_mood: { type: "string", enum: ["risk_on", "risk_off", "neutral", "mixed"] },
    market_mood_label_zh_hant: { type: "string" },
    top_five_brief_reasons: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          cluster_id: { type: "string" },
          brief_reason_zh_hant: { type: "string" },
        },
        required: ["cluster_id", "brief_reason_zh_hant"],
      },
    },
  },
  required: ["morning_brief_zh_hant", "market_mood", "market_mood_label_zh_hant", "top_five_brief_reasons"],
};

const COMMON_SIMPLIFIED_CHARS = /[这为与发后业东个会来时们国对称产经见实现过涨亿万广气报团际质证龙门车网]/;
const INVESTMENT_ADVICE_PATTERN =
  /(買入|賣出|持有|加倉|減倉|建議買|建議賣|投資建議|目標價|price target|buy rating|sell rating|hold rating|should buy|should sell)/i;
const PRICE_PREDICTION_PATTERN =
  /(將上升|將下跌|會升至|會跌至|上望|下望|看漲至|看跌至|will rise|will fall|could rise to|could fall to|target price)/i;
const GENERIC_AI_OUTPUT_PATTERN = /(mock|placeholder|lorem ipsum|測試資料流程|正式摘要會在)/i;

const SIMPLIFIED_TO_TRADITIONAL = new Map([
  ["这", "這"],
  ["测", "測"],
  ["试", "試"],
  ["资", "資"],
  ["讯", "訊"],
  ["数", "數"],
  ["据", "據"],
  ["为", "為"],
  ["会", "會"],
  ["后", "後"],
  ["关", "關"],
  ["联", "聯"],
  ["储", "儲"],
  ["鲍", "鮑"],
  ["胀", "脹"],
  ["债", "債"],
  ["经", "經"],
  ["济", "濟"],
  ["贸", "貿"],
  ["币", "幣"],
  ["国", "國"],
  ["产", "產"],
  ["发", "發"],
  ["现", "現"],
  ["点", "點"],
  ["简", "簡"],
  ["体", "體"],
  ["与", "與"],
  ["将", "將"],
  ["观", "觀"],
  ["导", "導"],
  ["称", "稱"],
  ["类", "類"],
  ["来", "來"],
  ["对", "對"],
  ["应", "應"],
  ["响", "響"],
  ["时", "時"],
  ["间", "間"],
  ["较", "較"],
  ["场", "場"],
  ["题", "題"],
  ["报", "報"],
  ["显", "顯"],
]);

function nowIso() {
  return new Date().toISOString();
}

function parseBoolean(value, fallback) {
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function toZhHant(value) {
  return String(value ?? "")
    .split("")
    .map((char) => SIMPLIFIED_TO_TRADITIONAL.get(char) ?? char)
    .join("");
}

function userFacingStringsFromDailyBrief(result) {
  return [
    result.morning_brief_zh_hant,
    result.market_mood_label_zh_hant,
    ...asArray(result.top_five_brief_reasons).map((item) => item.brief_reason_zh_hant),
  ].map((value) => String(value ?? ""));
}

function hasCjk(text) {
  return /[\u3400-\u9fff]/.test(String(text ?? ""));
}

function validateUserFacingDailyBrief(result, { allowMockText = false } = {}) {
  const values = userFacingStringsFromDailyBrief(result);
  const combined = values.join("\n");

  for (const [index, value] of values.entries()) {
    if (!value.trim()) throw new Error(`Daily brief user-facing field ${index + 1} is empty`);
  }
  if (!values.every(hasCjk)) {
    throw new Error("Daily brief user-facing fields must contain Traditional Chinese text");
  }
  if (COMMON_SIMPLIFIED_CHARS.test(combined)) {
    throw new Error("Daily brief user-facing fields contain common Simplified Chinese characters");
  }
  if (INVESTMENT_ADVICE_PATTERN.test(combined)) {
    throw new Error("Daily brief user-facing fields contain investment advice language");
  }
  if (PRICE_PREDICTION_PATTERN.test(combined)) {
    throw new Error("Daily brief user-facing fields contain price prediction language");
  }
  if (!allowMockText && GENERIC_AI_OUTPUT_PATTERN.test(combined)) {
    throw new Error("Daily brief user-facing fields contain generic placeholder or mock text");
  }
}

function usageEstimate(payload, outputTokens = 360) {
  const inputTokens = Math.ceil(JSON.stringify(payload).length / 4);
  return {
    estimated_input_tokens: inputTokens,
    estimated_output_tokens: outputTokens,
    estimated_total_tokens: inputTokens + outputTokens,
    source: "estimated",
  };
}

function sourceNames(cluster) {
  return unique(asArray(cluster.source_links).map((source) => source.source));
}

function compactCluster(cluster) {
  return {
    cluster_id: cluster.cluster_id,
    rank: cluster.rank,
    headline_zh_hant: ensureEditorialHeadline(cluster),
    heat_score: cluster.heat_score,
    heat_level: cluster.heat_level,
    categories: cluster.categories,
    related_assets: cluster.related_assets,
    summary_zh_hant: cluster.summary_zh_hant,
    what_happened_zh_hant: cluster.what_happened_zh_hant,
    key_points_zh_hant: cluster.key_points_zh_hant,
    why_it_matters_zh_hant: cluster.why_it_matters_zh_hant,
    watch_next_zh_hant: cluster.watch_next_zh_hant,
    heat_reasons: cluster.heat_reasons,
    source_names: sourceNames(cluster),
  };
}

function promptInstructions() {
  return [
    "All user-facing output must be written in Traditional Chinese.",
    "Translate and synthesize English source content into Traditional Chinese.",
    "Convert or rewrite Simplified Chinese source content into Traditional Chinese.",
    "Do not output Simplified Chinese.",
    "Do not repeat raw fallback labels such as 重點主題, cluster_title_candidate, or category/entity concatenations.",
    "If a supplied headline looks like a fallback label, rewrite the morning brief around the actual event or market theme.",
    "Top 5 brief reasons must be one short Traditional Chinese sentence explaining why the story matters.",
    "Keep a neutral and factual financial news tone.",
    "Do not provide investment advice.",
    "Do not make price predictions.",
    "Do not include buy, sell, hold, target price, upside, downside, or trading-action language.",
    "Do not add facts that are not supported by the provided cluster summaries, categories, heat reasons, related assets, and source names.",
    "If information is limited, clearly say 「目前公開資訊有限」.",
    "Avoid generic filler. The morning brief must identify the concrete mainline across the top clusters.",
    "Company names, tickers, product names, and source names may remain in English where appropriate.",
    "Return valid JSON only.",
    "Do not include Markdown.",
    "Do not include explanations outside JSON.",
    "所有面向使用者的內容必須使用繁體中文。",
    "英文來源內容需要翻譯並綜合為繁體中文。",
    "簡體中文來源內容需要轉換或改寫為繁體中文。",
    "不要輸出簡體中文。",
    "保持中立、factual 的新聞語氣。",
    "不要提供投資建議。",
    "不要作價格預測。",
    "不要輸出買入、賣出、持有、目標價、上望、下望或任何交易行動建議。",
    "不要加入來源資料沒有支持的事實。",
    "只可根據提供的 cluster headline、summary、categories、heat reasons、related assets、source names 進行總結。",
    "如果資料不足，請明確寫出「目前公開資訊有限」。",
    "避免空泛模板句；晨報主線必須綜合前列 clusters 的具體共通主題。",
    "只輸出 valid JSON。",
    "不要輸出 Markdown。",
    "不要在 JSON 外加入任何說明。",
  ];
}

function buildPromptPayload(brief) {
  const topClusters = asArray(brief.clusters).slice(0, MAX_PROMPT_CLUSTERS).map(compactCluster);
  return {
    task: "Generate only the high-level daily morning brief editorial fields. Do not rewrite individual cluster summaries.",
    date: brief.date,
    timezone: brief.timezone,
    current_market_mood: brief.market_mood,
    current_market_mood_label_zh_hant: brief.market_mood_label_zh_hant,
    current_morning_brief_zh_hant: brief.morning_brief_zh_hant,
    instructions: promptInstructions(),
    allowed_market_mood_values: ["risk_on", "risk_off", "neutral", "mixed"],
    output_schema: {
      morning_brief_zh_hant: "string, 3 to 5 concise Traditional Chinese sentences",
      market_mood: "risk_on | risk_off | neutral | mixed",
      market_mood_label_zh_hant: "string",
      top_five_brief_reasons: [{ cluster_id: "string", brief_reason_zh_hant: "string" }],
    },
    top_clusters: topClusters,
    top_five_cluster_ids: asArray(brief.top_five).map((item) => item.cluster_id),
  };
}

function cloudflareRequestBody(promptPayload) {
  const systemPrompt = [
    "You are a cautious financial and technology morning-brief editor.",
    "Return JSON only. Do not include Markdown. Do not include explanations outside JSON.",
    ...promptInstructions(),
  ].join("\n");

  return {
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: JSON.stringify(promptPayload, null, 2) },
    ],
    response_format: {
      type: "json_schema",
      json_schema: SUMMARY_JSON_SCHEMA,
    },
    temperature: 0.2,
    max_tokens: 700,
  };
}

function mockAiResult(brief) {
  const topFive = asArray(brief.top_five);
  return {
    morning_brief_zh_hant: buildMorningBrief(asArray(brief.clusters).slice(0, MAX_PROMPT_CLUSTERS), brief.market_mood_label_zh_hant),
    market_mood: brief.market_mood,
    market_mood_label_zh_hant: brief.market_mood_label_zh_hant,
    top_five_brief_reasons: topFive.map((item) => ({
      cluster_id: item.cluster_id,
      brief_reason_zh_hant: buildBriefReason(item),
    })),
  };
  const categories = unique(topFive.flatMap((item) => asArray(item.categories))).slice(0, 6);
  const headlines = topFive.map((item) => item.headline_zh_hant).filter(Boolean).slice(0, 3);
  const moodLabel = brief.market_mood_label_zh_hant || "市場訊號分化";

  return {
    morning_brief_zh_hant: toZhHant(
      `今日全球財經科技焦點集中在${categories.join("、") || "主要市場主題"}。排名較前的主題包括${headlines.join("、") || "高熱度市場主題"}，顯示投資者仍在評估宏觀變化與科技成長之間的關係。整體市場訊號為${moodLabel}，後續可留意高熱度主題是否獲更多來源確認，以及相關資產與政策訊號是否有新的公開資訊。`,
    ),
    market_mood: brief.market_mood,
    market_mood_label_zh_hant: moodLabel,
    top_five_brief_reasons: topFive.map((item) => ({
      cluster_id: item.cluster_id,
      brief_reason_zh_hant: toZhHant(
        `此主題排名第 ${item.rank}，heat score 為 ${item.heat_score}，主要涉及 ${asArray(item.categories).slice(0, 3).join("、") || "市場"}，因此列入今日 Top 5。`,
      ),
    })),
  };
}

function validateAiResult(result, topFiveIds) {
  if (!result || typeof result !== "object") throw new Error("AI result is not an object");
  if (!result.morning_brief_zh_hant) throw new Error("AI result missing morning_brief_zh_hant");
  if (!VALID_MARKET_MOODS.has(result.market_mood)) throw new Error("AI result has invalid market_mood");
  if (!result.market_mood_label_zh_hant) throw new Error("AI result missing market_mood_label_zh_hant");
  if (!Array.isArray(result.top_five_brief_reasons)) throw new Error("AI result missing top_five_brief_reasons");

  const reasonIds = new Set(result.top_five_brief_reasons.map((item) => item.cluster_id));
  for (const id of topFiveIds) {
    if (!reasonIds.has(id)) throw new Error(`AI result missing brief reason for ${id}`);
  }
}

function parseJsonLoose(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  const text = String(value ?? "").trim();
  if (!text) throw new Error("AI response was empty");

  if (!text.startsWith("{") || !text.endsWith("}")) {
    throw new Error("AI response included text outside JSON");
  }

  return JSON.parse(text);
}

function responseContent(cloudflareResponse) {
  const result = cloudflareResponse?.result ?? cloudflareResponse;
  if (result?.response != null) return result.response;
  if (result?.text != null) return result.text;
  if (result?.output_text != null) return result.output_text;
  if (result?.content != null) return result.content;
  return result;
}

function cloudflareEndpoint(env) {
  return `${CLOUDFLARE_API_BASE}/accounts/${encodeURIComponent(env.accountId)}/ai/run/${env.model}`;
}

async function callCloudflare(requestBody, env) {
  const response = await fetch(cloudflareEndpoint(env), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });
  const text = await response.text();
  let parsed = null;

  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    const message = parsed?.errors?.[0]?.message ?? text.slice(0, 500) ?? response.statusText;
    throw new Error(`Cloudflare AI HTTP ${response.status}: ${message}`);
  }

  if (parsed?.success === false) {
    const message = parsed.errors?.map((error) => error.message).join("; ") || "Cloudflare AI returned success=false";
    throw new Error(message);
  }

  return parsed ?? { result: { response: text } };
}

function normalizeAiResult(result, brief) {
  const topFiveIds = asArray(brief.top_five).map((item) => item.cluster_id);
  validateAiResult(result, topFiveIds);
  const normalized = {
    morning_brief_zh_hant: toZhHant(result.morning_brief_zh_hant),
    market_mood: result.market_mood,
    market_mood_label_zh_hant: toZhHant(result.market_mood_label_zh_hant),
    top_five_brief_reasons: result.top_five_brief_reasons.map((item) => ({
      cluster_id: item.cluster_id,
      brief_reason_zh_hant: toZhHant(item.brief_reason_zh_hant),
    })),
  };
  if (hasBadUserFacingText(normalized.morning_brief_zh_hant) || hasCommonSimplifiedChars(normalized.morning_brief_zh_hant)) {
    throw new Error("AI result morning_brief_zh_hant contains fallback labels, mojibake, or Simplified Chinese");
  }
  for (const item of normalized.top_five_brief_reasons) {
    if (hasBadUserFacingText(item.brief_reason_zh_hant) || hasCommonSimplifiedChars(item.brief_reason_zh_hant)) {
      throw new Error(`${item.cluster_id}: AI result brief_reason_zh_hant contains fallback labels, mojibake, or Simplified Chinese`);
    }
  }
  validateUserFacingDailyBrief(normalized);
  return normalized;
}

function applyEnhancement(brief, aiResult, status, model, generatedAt, warning = null) {
  const reasonMap = new Map(aiResult.top_five_brief_reasons.map((item) => [item.cluster_id, item.brief_reason_zh_hant]));
  const warnings = unique([...(brief.warnings ?? []), ...(warning ? [warning] : [])]);

  return {
    ...brief,
    morning_brief_zh_hant: aiResult.morning_brief_zh_hant,
    market_mood: aiResult.market_mood,
    market_mood_label_zh_hant: aiResult.market_mood_label_zh_hant,
    daily_brief_ai_status: status,
    daily_brief_ai_model: model,
    daily_brief_ai_generated_at: generatedAt,
    top_five: asArray(brief.top_five).map((item) => ({
      ...item,
      brief_reason_zh_hant:
        reasonMap.get(item.cluster_id) ??
        item.brief_reason_zh_hant ??
        `此主題在今日熱度排名第 ${item.rank}，因此列入 Top 5。`,
    })),
    warnings,
  };
}

function envConfig() {
  return {
    mockMode: parseBoolean(process.env.DAILY_BRIEF_AI_MOCK_MODE, true),
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
    apiToken: process.env.CLOUDFLARE_API_TOKEN ?? "",
    model: process.env.CLOUDFLARE_AI_MODEL ?? "",
  };
}

async function readJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
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

async function writeErrors(errors) {
  if (errors.length === 0) return;
  await writeJson(new URL("daily_brief_ai_errors.json", RUNTIME_DIR), {
    generated_at: nowIso(),
    error_count: errors.length,
    errors,
  });
}

async function runRealMode(promptPayload, requestBody, brief, env, errors) {
  const topFiveIds = asArray(brief.top_five).map((item) => item.cluster_id);
  let requestCount = 0;
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_AI_REQUESTS; attempt += 1) {
    requestCount += 1;
    try {
      const response = await callCloudflare(requestBody, env);
      const parsed = parseJsonLoose(responseContent(response));
      const normalized = normalizeAiResult(parsed, brief);
      return {
        aiResult: normalized,
        requestCount,
        usage: usageEstimate(promptPayload),
        status: "success",
        error: null,
      };
    } catch (error) {
      lastError = error;
      errors.push({
        stage: attempt === 1 ? "cloudflare_request_or_json_parse" : "cloudflare_json_retry",
        attempt,
        message: error.message,
        occurred_at: nowIso(),
      });

      if (attempt >= MAX_AI_REQUESTS || !String(error.message).toLowerCase().includes("json")) break;
      requestBody.messages.push({
        role: "user",
        content: "The previous response was invalid. Return valid JSON only. Do not include Markdown or explanations outside JSON.",
      });
    }
  }

  return {
    aiResult: null,
    requestCount,
    usage: usageEstimate(promptPayload),
    status: "failed_fallback_used",
    error: lastError ?? new Error("Cloudflare AI failed"),
  };
}

async function main() {
  const generatedAt = nowIso();
  const brief = await readJson(DAILY_FILE);
  const archiveId = brief.archive_id ?? `${brief.date}-${brief.run_time_hkt ?? "0000"}`;
  const archiveFile = new URL(`${archiveId}.json`, ARCHIVE_DIR);
  const archiveAliasFile = new URL(`${brief.date}.json`, ARCHIVE_DIR);
  const archiveIndexFile = new URL("index.json", ARCHIVE_DIR);
  const archiveSearchIndexFile = new URL("archive-search-index.json", SEARCH_DIR);
  const categoryIndexFile = new URL("category-index.json", ARCHIVE_DIR);
  const env = envConfig();
  const promptPayload = buildPromptPayload(brief);
  const requestBody = cloudflareRequestBody(promptPayload);
  const errors = [];
  let requestCount = 0;
  let status = "mock";
  let model = MOCK_MODEL_NAME;
  let aiResult = null;
  let warning = null;
  let usage = usageEstimate(promptPayload, 360);

  if (env.mockMode) {
    aiResult = mockAiResult(brief);
  } else if (!env.accountId || !env.apiToken || !env.model) {
    status = "failed_fallback_used";
    model = env.model || "missing-cloudflare-model";
    warning = "Daily brief AI enhancement failed; deterministic Phase 7A brief was kept.";
    errors.push({
      stage: "environment",
      message: "DAILY_BRIEF_AI_MOCK_MODE=false requires CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, and CLOUDFLARE_AI_MODEL.",
      occurred_at: generatedAt,
    });
  } else {
    model = env.model;
    const result = await runRealMode(promptPayload, requestBody, brief, env, errors);
    requestCount = result.requestCount;
    usage = result.usage;
    status = result.status;
    aiResult = result.aiResult;
    if (result.error) {
      warning = "Daily brief AI enhancement failed; deterministic Phase 7A brief was kept.";
    }
  }

  const outputBrief =
    aiResult != null
      ? applyEnhancement(brief, normalizeAiResult(aiResult, brief), status, model, generatedAt)
      : {
          ...brief,
          daily_brief_ai_status: status,
          daily_brief_ai_model: model,
          daily_brief_ai_generated_at: generatedAt,
          top_five: asArray(brief.top_five).map((item) => ({
            ...item,
            brief_reason_zh_hant:
              item.brief_reason_zh_hant ??
              `此主題在今日熱度排名第 ${item.rank}，因此列入 Top 5。`,
          })),
          warnings: unique([...(brief.warnings ?? []), ...(warning ? [warning] : [])]),
        };

  const report = {
    generated_at: generatedAt,
    date: brief.date,
    mock_mode: env.mockMode,
    status,
    model,
    request_count: requestCount,
    prompt_cluster_count: promptPayload.top_clusters.length,
    top_five_cluster_ids: asArray(brief.top_five).map((item) => item.cluster_id),
    updated_fields: [
      "morning_brief_zh_hant",
      "market_mood",
      "market_mood_label_zh_hant",
      "top_five[*].brief_reason_zh_hant",
      "daily_brief_ai_status",
      "daily_brief_ai_model",
      "daily_brief_ai_generated_at",
    ],
    estimated_usage: {
      ...usage,
      credits_consumed: !env.mockMode && status === "success",
    },
    warnings: outputBrief.warnings ?? [],
  };

  const promptSample = {
    generated_at: generatedAt,
    mock_mode: env.mockMode,
    prompt_payload: promptPayload,
    cloudflare_request_body: requestBody,
    note: "Phase 7B prompt only includes top clusters and excludes raw article bodies, full source links, and all lower-ranked clusters.",
  };

  await writeJson(DAILY_FILE, outputBrief);
  await writeJson(archiveFile, outputBrief);
  await writeJson(archiveAliasFile, outputBrief);
  const archiveIndex = mergeArchiveIndex(await readJsonIfExists(archiveIndexFile, { items: [] }), outputBrief);
  const archiveSearchIndex = mergeArchiveSearchIndex(await readJsonIfExists(archiveSearchIndexFile, { items: [] }), outputBrief);
  const categoryIndex = buildCategoryIndex(archiveSearchIndex);
  await writeJson(archiveIndexFile, archiveIndex);
  await writeJson(archiveSearchIndexFile, archiveSearchIndex);
  await writeJson(categoryIndexFile, categoryIndex);
  await writeJson(new URL("daily_brief_ai_report.json", RUNTIME_DIR), report);
  await writeJson(new URL("daily_brief_ai_prompt_sample.json", RUNTIME_DIR), promptSample);
  await writeErrors(errors);

  console.log(
    JSON.stringify(
      {
        generated_at: generatedAt,
        date: brief.date,
        mock_mode: env.mockMode,
        status,
        model,
        request_count: requestCount,
        prompt_cluster_count: promptPayload.top_clusters.length,
        error_count: errors.length,
        outputs: [
          "data/daily/latest.json",
          `data/archive/${archiveId}.json`,
          `data/archive/${brief.date}.json`,
          "data/archive/index.json",
          "data/search/archive-search-index.json",
          "data/archive/category-index.json",
          "data/runtime/daily_brief_ai_report.json",
          "data/runtime/daily_brief_ai_prompt_sample.json",
          ...(errors.length > 0 ? ["data/runtime/daily_brief_ai_errors.json"] : []),
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
