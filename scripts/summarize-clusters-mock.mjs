import { readFile, writeFile, mkdir } from "node:fs/promises";

const INPUT_FILE = new URL("../data/runtime/scored_clusters.json", import.meta.url);
const CONFIG_FILE = new URL("../config/ai-summary-config.json", import.meta.url);
const OUTPUT_DIR = new URL("../data/runtime/", import.meta.url);

const MOCK_MODEL_NAME = "mock-local-deterministic-zh-hant";
const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";
const MAX_AI_ATTEMPTS = 2;
const JSON_REASK_ATTEMPTS = 1;
const RETRY_BACKOFF_MS = 1200;

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

const SUMMARY_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headline_zh_hant: { type: "string" },
    summary_zh_hant: { type: "string" },
    what_happened_zh_hant: { type: "string" },
    key_points_zh_hant: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 5 },
    why_it_matters_zh_hant: { type: "string" },
    related_markets: { type: "array", items: { type: "string" } },
    related_assets: { type: "array", items: { type: "string" } },
    watch_next_zh_hant: { type: "string" },
    summary_quality_flags: { type: "array", items: { type: "string" } },
  },
  required: [
    "headline_zh_hant",
    "summary_zh_hant",
    "what_happened_zh_hant",
    "key_points_zh_hant",
    "why_it_matters_zh_hant",
    "related_markets",
    "related_assets",
    "watch_next_zh_hant",
    "summary_quality_flags",
  ],
};

function nowIso() {
  return new Date().toISOString();
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function parseBoolean(value, fallback) {
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function parseOptionalNumber(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toZhHant(value) {
  return String(value ?? "")
    .split("")
    .map((char) => SIMPLIFIED_TO_TRADITIONAL.get(char) ?? char)
    .join("");
}

function toRank(index) {
  return index + 1;
}

function summaryTypeForRank(rank, config) {
  if (rank <= config.max_detailed_summaries) return "detailed";
  if (rank <= config.max_total_summaries) return "brief";
  return "none";
}

function topEntities(cluster, limit = 4) {
  return asArray(cluster.detected_entities)
    .map((entity) => entity.name)
    .filter(Boolean)
    .slice(0, limit);
}

function relatedAssets(cluster) {
  const entityAssets = asArray(cluster.detected_entities)
    .filter((entity) => ["asset", "company", "index", "macro"].includes(entity.type))
    .map((entity) => entity.name);
  const articleAssets = asArray(cluster.articles).flatMap((article) =>
    asArray(article.detected_entities)
      .filter((entity) => ["asset", "company", "index", "macro"].includes(entity.type))
      .map((entity) => entity.name),
  );

  return uniqueSorted([...entityAssets, ...articleAssets]).slice(0, 12);
}

function relatedMarkets(cluster) {
  return uniqueSorted(cluster.categories ?? []).slice(0, 8);
}

function headlineZhHant(cluster) {
  const categories = relatedMarkets(cluster).slice(0, 3);
  const entities = topEntities(cluster, 3);
  const left = categories.length > 0 ? categories.join("、") : "市場";
  const right = entities.length > 0 ? `｜${entities.join("、")}` : "";
  return toZhHant(`重點主題：${left}${right}`);
}

function sourceLinks(cluster) {
  return asArray(cluster.articles).map((article, index) => ({
    source: article.source,
    url: article.url,
    label_zh_hant: toZhHant(`來源 ${index + 1}：${article.source}`),
    published_at: article.published_at ?? null,
  }));
}

function estimateUsage(cluster, summaryType, mockMode) {
  if (summaryType === "none") {
    return {
      mock_mode: mockMode,
      estimated_input_tokens: 0,
      estimated_output_tokens: 0,
      estimated_total_tokens: 0,
      estimated_neurons: 0,
      credits_consumed: false,
      source: "not_summarized",
    };
  }

  const serializedCluster = JSON.stringify(compactClusterForPrompt(cluster));
  const estimatedInputTokens = Math.ceil(serializedCluster.length / 4);
  const estimatedOutputTokens = summaryType === "detailed" ? 420 : 180;

  return {
    mock_mode: mockMode,
    estimated_input_tokens: estimatedInputTokens,
    estimated_output_tokens: estimatedOutputTokens,
    estimated_total_tokens: estimatedInputTokens + estimatedOutputTokens,
    estimated_neurons: estimatedInputTokens + estimatedOutputTokens,
    credits_consumed: !mockMode,
    source: "estimated",
  };
}

function keyPointsZhHant(cluster, summaryType) {
  const categories = relatedMarkets(cluster);
  const sources = uniqueSorted(cluster.sources ?? []);
  const heatScore = Number(cluster.heat_score ?? 0);
  const points = [
    `此 mock 摘要根據 ${sources.length || 1} 個來源與 ${categories.length || 1} 個分類建立，用於測試資料流程。`,
    `目前 heat score 為 ${heatScore}，正式排序仍以非 AI heat scoring 結果為準。`,
  ];

  if (asArray(cluster.heat_reasons).length > 0) {
    points.push(`主要熱度原因包括：${cluster.heat_reasons.slice(0, 2).map(toZhHant).join("；")}。`);
  }

  return (summaryType === "brief" ? points.slice(0, 2) : points.slice(0, 3)).map(toZhHant);
}

function whyItMattersZhHant(cluster) {
  const reasons = asArray(cluster.heat_reasons).slice(0, 3);
  if (reasons.length === 0) {
    return "此主題的市場重要性將在正式摘要階段根據來源內容進一步說明；目前僅以 mock 模式保留流程結構。";
  }

  return toZhHant(`此主題值得關注，因為${reasons.map(toZhHant).join("，並且")}。以上為 mock 說明，正式版本會只根據來源文章生成。`);
}

function qualityFlags(cluster, summaryType, config, extraFlags = []) {
  const flags = [];
  if (config.mock_mode) flags.push("mock_summary", "no_real_ai_call");
  if (summaryType === "brief") flags.push("brief_summary_only");
  if (asArray(cluster.articles).length <= 1) flags.push("single_source_cluster");
  return uniqueSorted([...flags, ...extraFlags]);
}

function mockSummaryFields(cluster, summaryType, config) {
  const categories = relatedMarkets(cluster);
  const assets = relatedAssets(cluster);
  const sources = uniqueSorted(cluster.sources ?? []);
  const sourcePhrase = sources.length > 0 ? sources.join("、") : "已收集來源";

  return {
    summary_type: summaryType,
    headline_zh_hant: headlineZhHant(cluster),
    summary_zh_hant:
      summaryType === "detailed"
        ? toZhHant(`這是 mock 摘要，用於測試資料流程。此主題涵蓋 ${categories.join("、") || "市場"}，來源包括 ${sourcePhrase}。正式摘要會在 Cloudflare AI 接入後生成，並保持中立與事實性。`)
        : "這是 mock 簡短摘要，用於測試前 30 個主題的資料流程。正式摘要會在 Cloudflare AI 接入後生成。",
    what_happened_zh_hant: "這是 mock 摘要，用於測試資料流程。正式摘要會在 Cloudflare AI 接入後生成。",
    key_points_zh_hant: keyPointsZhHant(cluster, summaryType),
    why_it_matters_zh_hant: whyItMattersZhHant(cluster),
    related_markets: categories.map(toZhHant),
    related_assets: assets.map(toZhHant),
    watch_next_zh_hant:
      summaryType === "detailed"
        ? "後續可觀察更多來源是否確認同一主題，以及相關市場、公司或資產是否出現新的公開資訊。"
        : "後續可觀察是否有更多來源跟進此主題。",
    source_links: sourceLinks(cluster),
    ai_status: "mock_generated",
    ai_model: MOCK_MODEL_NAME,
    ai_usage_estimate: estimateUsage(cluster, summaryType, true),
    summary_quality_flags: qualityFlags(cluster, summaryType, config),
  };
}

function fallbackSummaryFields(cluster, summaryType, config, model, usage, reason) {
  const categories = relatedMarkets(cluster);
  const assets = relatedAssets(cluster);

  return {
    summary_type: summaryType,
    headline_zh_hant: headlineZhHant(cluster),
    summary_zh_hant: "AI 摘要生成失敗，系統已使用備援摘要。此內容只根據已整理的來源、分類、熱度原因與連結生成，未加入額外推論。",
    what_happened_zh_hant: "目前公開資訊有限；AI 回應未能通過系統檢查，因此此處使用備援摘要保留資料流程完整性。",
    key_points_zh_hant: [
      `此主題來自 ${uniqueSorted(cluster.sources ?? []).length || 1} 個來源。`,
      `相關分類包括：${categories.join("、") || "未分類"}。`,
      `備援原因：${toZhHant(reason)}。`,
    ],
    why_it_matters_zh_hant:
      asArray(cluster.heat_reasons).length > 0
        ? toZhHant(`此主題受到關注，主要因為${cluster.heat_reasons.slice(0, 2).map(toZhHant).join("，以及")}。`)
        : "此主題的市場重要性需要等待更多公開資訊確認。",
    related_markets: categories.map(toZhHant),
    related_assets: assets.map(toZhHant),
    watch_next_zh_hant: "後續可觀察是否有更多來源補充或確認此主題的關鍵資訊。",
    source_links: sourceLinks(cluster),
    ai_status: "failed_fallback_used",
    ai_model: model,
    ai_usage_estimate: usage,
    summary_quality_flags: qualityFlags(cluster, summaryType, config, ["ai_failed_fallback_used"]),
  };
}

function skippedSummaryFields(cluster, status = "skipped_not_top_ranked", mockMode = true) {
  return {
    summary_type: "none",
    ai_status: status,
    ai_model: null,
    ai_usage_estimate: estimateUsage(cluster, "none", mockMode),
    summary_quality_flags: [status === "skipped_budget_limit" ? "budget_limit" : "not_selected_for_summary"],
  };
}

function englishInstructions() {
  return [
    "All user-facing output fields must be written in Traditional Chinese.",
    "Translate and synthesize English source content into Traditional Chinese.",
    "Convert or rewrite Simplified Chinese source content into Traditional Chinese.",
    "Do not output Simplified Chinese in user-facing fields.",
    "Keep a neutral and factual news tone.",
    "Do not provide investment advice.",
    "Do not make price predictions.",
    "Do not add facts that are not supported by the provided source data.",
    "Summarize only from the provided titles, snippets, categories, heat reasons, source names, and URLs.",
    "If information is limited, clearly say that currently available public information is limited.",
    "Company names, tickers, product names, and source names may remain in English where appropriate.",
    "Return valid JSON only.",
    "Do not include Markdown.",
    "Do not wrap the JSON in Markdown code fences.",
    "Do not include explanations outside the JSON.",
  ];
}

function zhHantRequirements() {
  return [
    "所有面向使用者的內容必須使用繁體中文。",
    "英文來源內容需要翻譯並綜合為繁體中文。",
    "簡體中文來源內容需要轉換或改寫為繁體中文。",
    "不要輸出簡體中文。",
    "保持中立、factual 的新聞語氣。",
    "不要提供投資建議。",
    "不要作價格預測。",
    "不要加入來源資料沒有支持的事實。",
    "只可根據提供的標題、摘要、分類、熱度原因、來源名稱和 URL 進行摘要。",
    "如果資料不足，請明確寫出「目前公開資訊有限」。",
    "公司名稱、股票代號、產品名稱和來源名稱可在適當情況下保留英文。",
    "只輸出 valid JSON，不要輸出 Markdown，不要在 JSON 外加入任何說明。",
  ];
}

function compactClusterForPrompt(cluster) {
  return {
    cluster_id: cluster.cluster_id,
    cluster_title_candidate: cluster.cluster_title_candidate,
    heat_score: cluster.heat_score,
    heat_level: cluster.heat_level,
    categories: cluster.categories,
    detected_entities: cluster.detected_entities,
    heat_reasons: cluster.heat_reasons,
    sources: cluster.sources,
    articles: asArray(cluster.articles).map((article) => ({
      source: article.source,
      title: article.title,
      snippet: article.snippet,
      url: article.url,
      published_at: article.published_at,
    })),
  };
}

function promptPayload(cluster, summaryType, config) {
  return {
    summary_type: summaryType,
    mock_mode: config.mock_mode,
    target_language: config.language,
    tone: config.tone,
    instructions: englishInstructions(),
    zh_hant_requirements: zhHantRequirements(),
    output_schema: {
      headline_zh_hant: "string",
      summary_zh_hant: "string",
      what_happened_zh_hant: "string",
      key_points_zh_hant: ["string"],
      why_it_matters_zh_hant: "string",
      related_markets: ["string"],
      related_assets: ["string"],
      watch_next_zh_hant: "string",
      summary_quality_flags: ["string"],
    },
    source_cluster: compactClusterForPrompt(cluster),
  };
}

function cloudflareRequestBody(cluster, summaryType, config) {
  const payload = promptPayload(cluster, summaryType, config);
  const systemPrompt = [
    "You are a cautious financial and technology news summarization engine.",
    "Return only JSON that matches the supplied schema.",
    "Do not include Markdown or any text outside JSON.",
    ...englishInstructions(),
    ...zhHantRequirements(),
  ].join("\n");

  return {
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: JSON.stringify(payload, null, 2) },
    ],
    response_format: {
      type: "json_schema",
      json_schema: SUMMARY_JSON_SCHEMA,
    },
    temperature: 0.2,
    max_tokens: summaryType === "detailed" ? 900 : 450,
  };
}

function repairRequestBody(cluster, summaryType, config, invalidOutput) {
  const body = cloudflareRequestBody(cluster, summaryType, config);
  body.messages.push({
    role: "user",
    content: [
      "The previous response was not valid JSON or did not match the schema.",
      "Repair it now. Return valid JSON only, with no Markdown and no explanation outside JSON.",
      "Previous invalid response:",
      String(invalidOutput ?? "").slice(0, 4000),
    ].join("\n"),
  });
  return body;
}

function buildPromptSamples(scoredClusters, config) {
  const detailedCluster = scoredClusters[0] ?? null;
  const briefCluster = scoredClusters[config.max_detailed_summaries] ?? scoredClusters[1] ?? null;
  const samples = [];

  if (detailedCluster) {
    samples.push({
      sample_type: "detailed",
      cluster_id: detailedCluster.cluster_id,
      prompt_payload: promptPayload(detailedCluster, "detailed", config),
      cloudflare_request_body: cloudflareRequestBody(detailedCluster, "detailed", config),
    });
  }

  if (briefCluster) {
    samples.push({
      sample_type: "brief",
      cluster_id: briefCluster.cluster_id,
      prompt_payload: promptPayload(briefCluster, "brief", config),
      cloudflare_request_body: cloudflareRequestBody(briefCluster, "brief", config),
    });
  }

  return {
    generated_at: nowIso(),
    mock_mode: config.mock_mode,
    note: config.mock_mode
      ? "These payloads are samples only. Mock mode does not call Cloudflare AI."
      : "These payloads show the Cloudflare AI request structure used by real mode.",
    samples,
  };
}

function normalizeConfig(config) {
  const configuredDetailed = Number(config.max_detailed_summaries ?? 10);
  const configuredBrief = Number(config.max_brief_summaries ?? 20);
  const configuredTotal = Number(config.max_total_summaries ?? configuredDetailed + configuredBrief);
  const envTotal = parseOptionalNumber(process.env.AI_MAX_TOTAL_SUMMARIES);
  const maxTotal = Math.max(0, Math.floor(envTotal ?? configuredTotal));
  const maxDetailed = clamp(Math.floor(configuredDetailed), 0, maxTotal);
  const maxBrief = clamp(Math.floor(configuredBrief), 0, Math.max(0, maxTotal - maxDetailed));

  return {
    ...config,
    max_detailed_summaries: maxDetailed,
    max_brief_summaries: maxBrief,
    max_total_summaries: maxTotal,
    mock_mode: parseBoolean(process.env.AI_MOCK_MODE, config.mock_mode !== false),
    language: config.language ?? "zh-Hant",
    tone: config.tone ?? "neutral",
    no_investment_advice: config.no_investment_advice !== false,
    cloudflare_account_id: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
    cloudflare_api_token: process.env.CLOUDFLARE_API_TOKEN ?? "",
    cloudflare_ai_model: process.env.CLOUDFLARE_AI_MODEL ?? "",
    daily_budget_neurons: parseOptionalNumber(process.env.AI_DAILY_BUDGET_NEURONS),
  };
}

function validateRealModeEnvironment(config) {
  if (config.mock_mode) return [];
  const missing = [];
  if (!config.cloudflare_account_id) missing.push("CLOUDFLARE_ACCOUNT_ID");
  if (!config.cloudflare_api_token) missing.push("CLOUDFLARE_API_TOKEN");
  if (!config.cloudflare_ai_model) missing.push("CLOUDFLARE_AI_MODEL");
  return missing;
}

function cloudflareEndpoint(config) {
  return `${CLOUDFLARE_API_BASE}/accounts/${encodeURIComponent(config.cloudflare_account_id)}/ai/run/${config.cloudflare_ai_model}`;
}

function estimateFromCloudflareUsage(cluster, summaryType, mockMode, usage) {
  const estimate = estimateUsage(cluster, summaryType, mockMode);
  if (!usage || typeof usage !== "object") return estimate;

  const inputTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokens ?? estimate.estimated_input_tokens);
  const outputTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? usage.completionTokens ?? estimate.estimated_output_tokens);
  const totalTokens = Number(usage.total_tokens ?? usage.totalTokens ?? inputTokens + outputTokens);
  const neurons = Number(usage.neurons ?? usage.total_neurons ?? usage.totalNeurons ?? totalTokens);

  return {
    ...estimate,
    estimated_input_tokens: inputTokens,
    estimated_output_tokens: outputTokens,
    estimated_total_tokens: totalTokens,
    estimated_neurons: neurons,
    raw_usage: usage,
    source: "provider_or_estimated",
  };
}

async function callCloudflareAi(cluster, summaryType, config, body) {
  const response = await fetch(cloudflareEndpoint(config), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.cloudflare_api_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
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

function responseContent(cloudflareResponse) {
  const result = cloudflareResponse?.result ?? cloudflareResponse;
  if (result?.response != null) return result.response;
  if (result?.text != null) return result.text;
  if (result?.output_text != null) return result.output_text;
  if (result?.content != null) return result.content;
  return result;
}

function parseJsonLoose(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  const text = String(value ?? "").trim();
  if (!text) throw new Error("AI response was empty");

  try {
    return JSON.parse(text);
  } catch {
    const withoutFence = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    try {
      return JSON.parse(withoutFence);
    } catch {
      const firstBrace = withoutFence.indexOf("{");
      const lastBrace = withoutFence.lastIndexOf("}");
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        return JSON.parse(withoutFence.slice(firstBrace, lastBrace + 1));
      }
      throw new Error("AI response was not valid JSON");
    }
  }
}

function normalizeAiSummary(summary, cluster, summaryType) {
  const requiredStrings = [
    "headline_zh_hant",
    "summary_zh_hant",
    "what_happened_zh_hant",
    "why_it_matters_zh_hant",
    "watch_next_zh_hant",
  ];
  for (const field of requiredStrings) {
    if (typeof summary[field] !== "string" || summary[field].trim() === "") {
      throw new Error(`AI JSON missing required field: ${field}`);
    }
  }

  if (!Array.isArray(summary.key_points_zh_hant) || summary.key_points_zh_hant.length === 0) {
    throw new Error("AI JSON missing required field: key_points_zh_hant");
  }

  return {
    summary_type: summaryType,
    headline_zh_hant: toZhHant(summary.headline_zh_hant),
    summary_zh_hant: toZhHant(summary.summary_zh_hant),
    what_happened_zh_hant: toZhHant(summary.what_happened_zh_hant),
    key_points_zh_hant: summary.key_points_zh_hant.map(toZhHant).slice(0, 5),
    why_it_matters_zh_hant: toZhHant(summary.why_it_matters_zh_hant),
    related_markets: asArray(summary.related_markets).map(toZhHant).slice(0, 12),
    related_assets: asArray(summary.related_assets).map(toZhHant).slice(0, 12),
    watch_next_zh_hant: toZhHant(summary.watch_next_zh_hant),
    source_links: sourceLinks(cluster),
    ai_status: "success",
    summary_quality_flags: uniqueSorted(asArray(summary.summary_quality_flags).map(toZhHant)),
  };
}

async function summarizeWithCloudflare(cluster, summaryType, config, aiErrors) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_AI_ATTEMPTS; attempt += 1) {
    try {
      const requestBody = cloudflareRequestBody(cluster, summaryType, config);
      const response = await callCloudflareAi(cluster, summaryType, config, requestBody);
      let content = responseContent(response);

      for (let repairAttempt = 0; repairAttempt <= JSON_REASK_ATTEMPTS; repairAttempt += 1) {
        try {
          const parsedSummary = parseJsonLoose(content);
          const normalized = normalizeAiSummary(parsedSummary, cluster, summaryType);
          return {
            fields: {
              ...normalized,
              ai_model: config.cloudflare_ai_model,
              ai_usage_estimate: estimateFromCloudflareUsage(cluster, summaryType, false, response?.result?.usage ?? response?.usage),
            },
            error: null,
          };
        } catch (parseError) {
          lastError = parseError;
          aiErrors.push({
            cluster_id: cluster.cluster_id,
            summary_type: summaryType,
            stage: "json_parse_or_schema",
            attempt,
            repair_attempt: repairAttempt,
            message: parseError.message,
            occurred_at: nowIso(),
          });

          if (repairAttempt >= JSON_REASK_ATTEMPTS) break;
          const repairResponse = await callCloudflareAi(cluster, summaryType, config, repairRequestBody(cluster, summaryType, config, content));
          content = responseContent(repairResponse);
        }
      }
    } catch (error) {
      lastError = error;
      aiErrors.push({
        cluster_id: cluster.cluster_id,
        summary_type: summaryType,
        stage: "cloudflare_request",
        attempt,
        message: error.message,
        occurred_at: nowIso(),
      });

      if (attempt < MAX_AI_ATTEMPTS) {
        await sleep(RETRY_BACKOFF_MS * attempt);
      }
    }
  }

  return {
    fields: null,
    error: lastError ?? new Error("Cloudflare AI request failed"),
  };
}

async function readJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

async function writeJson(filename, data) {
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(new URL(filename, OUTPUT_DIR), `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function writeAiErrors(errors) {
  if (errors.length === 0) return;
  await writeJson("ai_errors.json", {
    generated_at: nowIso(),
    error_count: errors.length,
    errors,
  });
}

function countSummaries(clusters, type) {
  return clusters.filter((cluster) => cluster.summary_type === type).length;
}

function totalUsage(clusters) {
  return clusters.reduce(
    (totals, cluster) => {
      const usage = cluster.ai_usage_estimate ?? {};
      totals.estimated_input_tokens += Number(usage.estimated_input_tokens ?? 0);
      totals.estimated_output_tokens += Number(usage.estimated_output_tokens ?? 0);
      totals.estimated_total_tokens += Number(usage.estimated_total_tokens ?? 0);
      totals.estimated_neurons += Number(usage.estimated_neurons ?? 0);
      return totals;
    },
    {
      estimated_input_tokens: 0,
      estimated_output_tokens: 0,
      estimated_total_tokens: 0,
      estimated_neurons: 0,
      credits_consumed: false,
    },
  );
}

async function main() {
  const generatedAt = nowIso();
  const input = await readJson(INPUT_FILE);
  const config = normalizeConfig(await readJson(CONFIG_FILE));
  const clusters = asArray(input.clusters);
  const warnings = [];
  const aiErrors = [];
  const missingEnv = validateRealModeEnvironment(config);

  if (missingEnv.length > 0) {
    const message = `AI_MOCK_MODE=false requires missing environment variable(s): ${missingEnv.join(", ")}`;
    aiErrors.push({
      stage: "environment",
      message,
      occurred_at: generatedAt,
    });
    await writeAiErrors(aiErrors);
    throw new Error(message);
  }

  if (config.max_total_summaries !== config.max_detailed_summaries + config.max_brief_summaries) {
    warnings.push("max_total_summaries differs from detailed plus brief limits; max_total_summaries was used as the hard cap.");
  }

  let spentNeurons = 0;
  let selectedBudgetStopped = false;
  let successfulAiCount = 0;
  let failedFallbackCount = 0;

  const summarizedClusters = [];

  for (const [index, cluster] of clusters.entries()) {
    const rank = toRank(index);
    const summaryType = summaryTypeForRank(rank, config);

    if (summaryType === "none") {
      summarizedClusters.push({
        ...cluster,
        ...skippedSummaryFields(cluster, "skipped_not_top_ranked", config.mock_mode),
      });
      continue;
    }

    const estimatedUsage = estimateUsage(cluster, summaryType, config.mock_mode);
    if (
      !config.mock_mode &&
      config.daily_budget_neurons != null &&
      (selectedBudgetStopped || spentNeurons + estimatedUsage.estimated_neurons > config.daily_budget_neurons)
    ) {
      selectedBudgetStopped = true;
      summarizedClusters.push({
        ...cluster,
        ...skippedSummaryFields(cluster, "skipped_budget_limit", config.mock_mode),
      });
      continue;
    }

    if (config.mock_mode) {
      summarizedClusters.push({
        ...cluster,
        ...mockSummaryFields(cluster, summaryType, config),
      });
      spentNeurons += estimatedUsage.estimated_neurons;
      continue;
    }

    const { fields, error } = await summarizeWithCloudflare(cluster, summaryType, config, aiErrors);
    if (fields) {
      spentNeurons += Number(fields.ai_usage_estimate?.estimated_neurons ?? estimatedUsage.estimated_neurons);
      successfulAiCount += 1;
      summarizedClusters.push({
        ...cluster,
        ...fields,
      });
    } else {
      failedFallbackCount += 1;
      const fallbackUsage = {
        ...estimatedUsage,
        source: "estimated_after_failure",
      };
      spentNeurons += fallbackUsage.estimated_neurons;
      summarizedClusters.push({
        ...cluster,
        ...fallbackSummaryFields(
          cluster,
          summaryType,
          config,
          config.cloudflare_ai_model,
          fallbackUsage,
          error?.message ?? "AI request failed",
        ),
      });
      aiErrors.push({
        cluster_id: cluster.cluster_id,
        summary_type: summaryType,
        stage: "fallback",
        message: error?.message ?? "AI request failed; fallback summary used",
        occurred_at: nowIso(),
      });
    }
  }

  const detailedCount = countSummaries(summarizedClusters, "detailed");
  const briefCount = countSummaries(summarizedClusters, "brief");
  const skippedCount = countSummaries(summarizedClusters, "none");
  const usageTotals = totalUsage(summarizedClusters);
  usageTotals.credits_consumed = !config.mock_mode && (successfulAiCount > 0 || failedFallbackCount > 0);

  if (!config.mock_mode && successfulAiCount === 0 && detailedCount + briefCount > 0) {
    warnings.push("All real AI summaries failed; fallback summaries were used.");
  }

  const report = {
    generated_at: generatedAt,
    input_file: "data/runtime/scored_clusters.json",
    input_cluster_count: clusters.length,
    detailed_summary_count: detailedCount,
    brief_summary_count: briefCount,
    skipped_count: skippedCount,
    skipped_budget_limit_count: summarizedClusters.filter((cluster) => cluster.ai_status === "skipped_budget_limit").length,
    mock_mode: config.mock_mode,
    model: config.mock_mode ? MOCK_MODEL_NAME : config.cloudflare_ai_model,
    successful_ai_summary_count: successfulAiCount,
    failed_fallback_count: failedFallbackCount,
    warnings,
    estimated_total_ai_usage: {
      ...usageTotals,
      daily_budget_neurons: config.daily_budget_neurons,
      note: config.mock_mode
        ? "Mock mode only; no Cloudflare AI call was made."
        : "Real mode records provider usage when returned, otherwise local estimates are used.",
    },
    top_summarized_clusters: summarizedClusters
      .filter((cluster) => cluster.summary_type !== "none")
      .slice(0, 10)
      .map((cluster) => ({
        cluster_id: cluster.cluster_id,
        summary_type: cluster.summary_type,
        headline_zh_hant: cluster.headline_zh_hant,
        heat_score: cluster.heat_score,
        heat_level: cluster.heat_level,
        ai_status: cluster.ai_status,
      })),
    config_files_used: ["config/ai-summary-config.json"],
  };

  const promptSamples = buildPromptSamples(clusters, config);

  await writeJson("summarized_clusters.json", {
    generated_at: generatedAt,
    input_cluster_count: clusters.length,
    cluster_count: summarizedClusters.length,
    mock_mode: config.mock_mode,
    model: report.model,
    clusters: summarizedClusters,
  });
  await writeJson("ai_summary_report.json", report);
  await writeJson("ai_prompt_samples.json", promptSamples);
  await writeAiErrors(aiErrors);

  console.log(
    JSON.stringify(
      {
        generated_at: generatedAt,
        input_cluster_count: clusters.length,
        detailed_summary_count: detailedCount,
        brief_summary_count: briefCount,
        skipped_count: skippedCount,
        mock_mode: config.mock_mode,
        model: report.model,
        successful_ai_summary_count: successfulAiCount,
        failed_fallback_count: failedFallbackCount,
        estimated_total_ai_usage: report.estimated_total_ai_usage,
        ai_error_count: aiErrors.length,
        outputs: [
          "data/runtime/summarized_clusters.json",
          "data/runtime/ai_summary_report.json",
          "data/runtime/ai_prompt_samples.json",
          ...(aiErrors.length > 0 ? ["data/runtime/ai_errors.json"] : []),
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
