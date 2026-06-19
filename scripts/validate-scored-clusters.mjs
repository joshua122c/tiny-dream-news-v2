import { access, readFile } from "node:fs/promises";

const SCORED_CLUSTERS_FILE = new URL("../data/runtime/scored_clusters.json", import.meta.url);
const SCORE_REPORT_FILE = new URL("../data/runtime/score_report.json", import.meta.url);

const REQUIRED_CLUSTER_FIELDS = ["heat_score", "heat_level", "heat_reasons", "score_breakdown"];
const VALID_HEAT_LEVELS = new Set(["very_high", "high", "medium", "low", "very_low"]);

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

function isSortedByHeatScore(clusters) {
  for (let index = 1; index < clusters.length; index += 1) {
    const previous = clusters[index - 1];
    const current = clusters[index];
    if (previous.heat_score < current.heat_score) return false;

    if (previous.heat_score === current.heat_score) {
      const previousTime = Date.parse(previous.latest_published_at ?? "") || 0;
      const currentTime = Date.parse(current.latest_published_at ?? "") || 0;
      if (previousTime < currentTime) return false;
    }
  }

  return true;
}

async function main() {
  const errors = [];
  const scoredClustersExists = await fileExists(SCORED_CLUSTERS_FILE);
  const scoreReportExists = await fileExists(SCORE_REPORT_FILE);

  if (!scoredClustersExists) errors.push("data/runtime/scored_clusters.json does not exist");
  if (!scoreReportExists) errors.push("data/runtime/score_report.json does not exist");

  if (!scoredClustersExists || !scoreReportExists) {
    throw new Error(errors.join("\n"));
  }

  const scoredClustersData = await readJson(SCORED_CLUSTERS_FILE);
  const scoreReport = await readJson(SCORE_REPORT_FILE);
  const clusters = Array.isArray(scoredClustersData.clusters) ? scoredClustersData.clusters : [];

  if (clusters.length === 0) errors.push("scored_clusters.json has no clusters");

  for (const cluster of clusters) {
    for (const field of REQUIRED_CLUSTER_FIELDS) {
      if (!(field in cluster)) errors.push(`${cluster.cluster_id}: missing ${field}`);
    }

    if (typeof cluster.heat_score !== "number" || cluster.heat_score < 0 || cluster.heat_score > 100) {
      errors.push(`${cluster.cluster_id}: heat_score is outside 0-100`);
    }

    if (!VALID_HEAT_LEVELS.has(cluster.heat_level)) {
      errors.push(`${cluster.cluster_id}: invalid heat_level`);
    }

    if (!Array.isArray(cluster.heat_reasons) || cluster.heat_reasons.length === 0) {
      errors.push(`${cluster.cluster_id}: heat_reasons must be a non-empty array`);
    }

    if (typeof cluster.score_breakdown !== "object" || cluster.score_breakdown == null) {
      errors.push(`${cluster.cluster_id}: score_breakdown must be an object`);
    }
  }

  if (!isSortedByHeatScore(clusters)) {
    errors.push("clusters are not sorted by heat_score descending and latest_published_at descending");
  }

  if (!scoreReport.generated_at) errors.push("score_report.json missing generated_at");
  if (scoreReport.output_cluster_count !== clusters.length) {
    errors.push("score_report.json output_cluster_count does not match scored cluster count");
  }

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  console.log(
    JSON.stringify(
      {
        status: "passed",
        scored_cluster_count: clusters.length,
        score_report_exists: true,
        sorted_by_heat_score: true,
        top_cluster: clusters[0]
          ? {
              cluster_id: clusters[0].cluster_id,
              heat_score: clusters[0].heat_score,
              heat_level: clusters[0].heat_level,
            }
          : null,
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
