import { readFile, writeFile, mkdir } from "node:fs/promises";

const INPUT_FILE = new URL("../data/runtime/news_clusters.json", import.meta.url);
const OUTPUT_DIR = new URL("../data/runtime/", import.meta.url);
const SOURCE_WEIGHTS_FILE = new URL("../config/source-weights.json", import.meta.url);
const TOPIC_WEIGHTS_FILE = new URL("../config/topic-weights.json", import.meta.url);
const MARKET_IMPACT_RULES_FILE = new URL("../config/market-impact-rules.json", import.meta.url);

const SCORE_CAPS = {
  source_count_score: 25,
  source_quality_score: 20,
  topic_weight_score: 15,
  market_impact_score: 20,
  recency_score: 10,
  homepage_position_score: 10,
};

function nowIso() {
  return new Date().toISOString();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function roundScore(value) {
  return Number(value.toFixed(2));
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function sourceCountScore(sourceCount) {
  if (sourceCount >= 4) return 25;
  if (sourceCount === 3) return 18;
  if (sourceCount === 2) return 12;
  if (sourceCount === 1) return 5;
  return 0;
}

function sourceQualityScore(sources, sourceWeights, warnings, clusterId) {
  const unknownSources = sources.filter((source) => sourceWeights[source] == null);
  for (const source of unknownSources) {
    warnings.push(`${clusterId}: missing source weight for ${source}`);
  }

  const rawScore = sources.reduce((sum, source) => sum + Number(sourceWeights[source] ?? 0.75) * 5, 0);
  return roundScore(clamp(rawScore, 0, SCORE_CAPS.source_quality_score));
}

function topicWeightScore(categories, topicWeights, warnings, clusterId) {
  const unknownCategories = categories.filter((category) => topicWeights[category] == null);
  for (const category of unknownCategories) {
    warnings.push(`${clusterId}: missing topic weight for ${category}`);
  }

  const rawScore = categories.reduce((sum, category) => sum + Number(topicWeights[category] ?? 0.75) * 4, 0);
  return roundScore(clamp(rawScore, 0, SCORE_CAPS.topic_weight_score));
}

function searchableText(cluster) {
  const articleText = (cluster.articles ?? [])
    .map((article) =>
      [
        article.title,
        article.snippet,
        article.normalized_title,
        article.section,
        ...(article.detected_entities ?? []).flatMap((entity) => [entity.name, entity.matched_alias]),
      ]
        .filter(Boolean)
        .join(" "),
    )
    .join(" ");

  return [
    cluster.cluster_title_candidate,
    ...(cluster.categories ?? []),
    ...(cluster.detected_entities ?? []).map((entity) => entity.name),
    articleText,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function keywordMatches(text, keywords) {
  return keywords.filter((keyword) => text.includes(String(keyword).toLowerCase()));
}

function marketImpactScore(cluster, marketImpactRules) {
  const text = searchableText(cluster);
  const groups = [];
  let rawScore = 0;

  for (const [groupName, rule] of Object.entries(marketImpactRules)) {
    const matchedKeywords = uniqueSorted(keywordMatches(text, rule.keywords ?? []));
    if (matchedKeywords.length === 0) continue;

    const groupScore = matchedKeywords.length * Number(rule.score_per_match ?? 1);
    rawScore += groupScore;
    groups.push({
      group: groupName,
      matched_keywords: matchedKeywords,
      raw_score: roundScore(groupScore),
    });
  }

  return {
    score: roundScore(clamp(rawScore, 0, SCORE_CAPS.market_impact_score)),
    matched_groups: groups,
  };
}

function recencyScore(cluster, generatedAt, warnings) {
  const timestamp = cluster.latest_published_at;
  const publishedMs = Date.parse(timestamp ?? "");
  const generatedMs = Date.parse(generatedAt);

  if (!timestamp || Number.isNaN(publishedMs)) {
    warnings.push(`${cluster.cluster_id}: missing latest_published_at`);
    return {
      score: 3,
      hours_old: null,
      missing_timestamp: true,
    };
  }

  const hoursOld = Math.max(0, (generatedMs - publishedMs) / 36e5);
  let score = 1;
  if (hoursOld <= 3) score = 10;
  else if (hoursOld <= 6) score = 8;
  else if (hoursOld <= 12) score = 6;
  else if (hoursOld <= 24) score = 4;

  return {
    score,
    hours_old: roundScore(hoursOld),
    missing_timestamp: false,
  };
}

function homepagePositionScore(cluster) {
  const positions = (cluster.articles ?? [])
    .map((article) => Number(article.source_position))
    .filter((position) => Number.isFinite(position) && position > 0);

  if (positions.length === 0) {
    return {
      score: 0,
      best_source_position: null,
    };
  }

  const best = Math.min(...positions);
  let score = 0;
  if (best <= 3) score = 10;
  else if (best <= 10) score = 7;
  else if (best <= 20) score = 4;

  return {
    score,
    best_source_position: best,
  };
}

function heatLevel(score) {
  if (score >= 85) return "very_high";
  if (score >= 70) return "high";
  if (score >= 50) return "medium";
  if (score >= 30) return "low";
  return "very_low";
}

function topWeightedSources(sources, sourceWeights) {
  return [...sources]
    .sort((left, right) => Number(sourceWeights[right] ?? 0) - Number(sourceWeights[left] ?? 0))
    .slice(0, 2);
}

function topMarketTerms(marketImpact) {
  return uniqueSorted(marketImpact.matched_groups.flatMap((group) => group.matched_keywords)).slice(0, 4);
}

function buildHeatReasons(cluster, breakdown, sourceWeights, recency, homepagePosition, marketImpact) {
  const reasons = [];
  const sourceCount = cluster.source_count ?? cluster.sources?.length ?? 0;

  if (sourceCount >= 2) {
    reasons.push(`同一主題被 ${sourceCount} 個來源報導`);
  } else {
    reasons.push("目前主要由單一來源報導");
  }

  const weightedSources = topWeightedSources(cluster.sources ?? [], sourceWeights);
  if (weightedSources.length > 0) {
    reasons.push(`包含高權重來源 ${weightedSources.join(" 與 ")}`);
  }

  const highPriorityCategories = (cluster.categories ?? []).filter((category) => breakdown.topic_weights[category] >= 1.15);
  if (highPriorityCategories.length > 0) {
    reasons.push(`涉及 ${highPriorityCategories.slice(0, 3).join("、")} 等高關注主題`);
  } else if ((cluster.categories ?? []).length > 0) {
    reasons.push(`涵蓋 ${cluster.categories.slice(0, 3).join("、")} 類別`);
  }

  const marketTerms = topMarketTerms(marketImpact);
  if (marketTerms.length > 0) {
    reasons.push(`涉及 ${marketTerms.join("、")} 等重要市場關鍵詞`);
  }

  if (recency.missing_timestamp) {
    reasons.push("缺少發布時間，已使用保守時效分");
  } else if (recency.hours_old <= 6) {
    reasons.push("新聞發布時間較新");
  }

  if (homepagePosition.best_source_position != null && homepagePosition.best_source_position <= 10) {
    reasons.push("來源首頁位置較前");
  }

  if (reasons.length < 2) {
    reasons.push("分數由來源、主題、時間與位置等非 AI 規則計算");
  }

  return reasons.slice(0, 6);
}

function scoreCluster(cluster, configs, generatedAt, warnings) {
  const sources = uniqueSorted(cluster.sources ?? (cluster.articles ?? []).map((article) => article.source));
  const categories = uniqueSorted(cluster.categories ?? []);
  const sourceCount = cluster.source_count ?? sources.length;
  const sourceCountComponent = sourceCountScore(sourceCount);
  const sourceQualityComponent = sourceQualityScore(sources, configs.sourceWeights, warnings, cluster.cluster_id);
  const topicComponent = topicWeightScore(categories, configs.topicWeights, warnings, cluster.cluster_id);
  const marketImpact = marketImpactScore(cluster, configs.marketImpactRules);
  const recency = recencyScore(cluster, generatedAt, warnings);
  const homepagePosition = homepagePositionScore(cluster);

  const scoreBreakdown = {
    source_count_score: sourceCountComponent,
    source_quality_score: sourceQualityComponent,
    topic_weight_score: topicComponent,
    market_impact_score: marketImpact.score,
    recency_score: recency.score,
    homepage_position_score: homepagePosition.score,
    source_weights: Object.fromEntries(sources.map((source) => [source, configs.sourceWeights[source] ?? 0.75])),
    topic_weights: Object.fromEntries(categories.map((category) => [category, configs.topicWeights[category] ?? 0.75])),
    market_impact_matches: marketImpact.matched_groups,
    recency_hours_old: recency.hours_old,
    best_source_position: homepagePosition.best_source_position,
    component_caps: SCORE_CAPS,
  };

  const heatScore = roundScore(
    clamp(
      sourceCountComponent +
        sourceQualityComponent +
        topicComponent +
        marketImpact.score +
        recency.score +
        homepagePosition.score,
      0,
      100,
    ),
  );

  return {
    ...cluster,
    heat_score: heatScore,
    heat_level: heatLevel(heatScore),
    heat_reasons: buildHeatReasons(cluster, scoreBreakdown, configs.sourceWeights, recency, homepagePosition, marketImpact),
    score_breakdown: scoreBreakdown,
  };
}

function compareClusters(left, right) {
  if (right.heat_score !== left.heat_score) return right.heat_score - left.heat_score;
  const rightTime = Date.parse(right.latest_published_at ?? "") || 0;
  const leftTime = Date.parse(left.latest_published_at ?? "") || 0;
  return rightTime - leftTime;
}

function scoreDistribution(scoredClusters) {
  return {
    very_high: scoredClusters.filter((cluster) => cluster.heat_level === "very_high").length,
    high: scoredClusters.filter((cluster) => cluster.heat_level === "high").length,
    medium: scoredClusters.filter((cluster) => cluster.heat_level === "medium").length,
    low: scoredClusters.filter((cluster) => cluster.heat_level === "low").length,
    very_low: scoredClusters.filter((cluster) => cluster.heat_level === "very_low").length,
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
  const clusters = Array.isArray(input.clusters) ? input.clusters : [];
  const configs = {
    sourceWeights: await readJson(SOURCE_WEIGHTS_FILE),
    topicWeights: await readJson(TOPIC_WEIGHTS_FILE),
    marketImpactRules: await readJson(MARKET_IMPACT_RULES_FILE),
  };
  const warnings = [];

  if (clusters.length === 0) warnings.push("No clusters found in data/runtime/news_clusters.json");

  const scoredClusters = clusters
    .map((cluster) => scoreCluster(cluster, configs, generatedAt, warnings))
    .sort(compareClusters);

  const scoreReport = {
    generated_at: generatedAt,
    input_file: "data/runtime/news_clusters.json",
    input_cluster_count: clusters.length,
    output_cluster_count: scoredClusters.length,
    top_10_clusters: scoredClusters.slice(0, 10).map((cluster) => ({
      cluster_id: cluster.cluster_id,
      title: cluster.cluster_title_candidate,
      heat_score: cluster.heat_score,
      heat_level: cluster.heat_level,
    })),
    score_distribution: scoreDistribution(scoredClusters),
    warnings: uniqueSorted(warnings),
    config_files_used: [
      "config/source-weights.json",
      "config/topic-weights.json",
      "config/market-impact-rules.json",
    ],
  };

  await writeJson("scored_clusters.json", {
    generated_at: generatedAt,
    input_cluster_count: clusters.length,
    cluster_count: scoredClusters.length,
    clusters: scoredClusters,
  });
  await writeJson("score_report.json", scoreReport);

  console.log(
    JSON.stringify(
      {
        generated_at: generatedAt,
        input_cluster_count: clusters.length,
        output_cluster_count: scoredClusters.length,
        top_cluster: scoreReport.top_10_clusters[0] ?? null,
        score_distribution: scoreReport.score_distribution,
        warning_count: scoreReport.warnings.length,
        outputs: ["data/runtime/scored_clusters.json", "data/runtime/score_report.json"],
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
