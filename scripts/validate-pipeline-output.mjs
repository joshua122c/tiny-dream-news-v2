import { spawn } from "node:child_process";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = new URL("../", import.meta.url);
const REQUIRED_FILES = [
  "data/runtime/raw_articles.json",
  "data/runtime/normalized_articles.json",
  "data/runtime/clean_articles.json",
  "data/runtime/news_clusters.json",
  "data/runtime/scored_clusters.json",
  "data/runtime/summarized_clusters.json",
  "data/daily/latest.json",
  "data/archive/index.json",
  "data/search/archive-search-index.json",
  "data/archive/category-index.json",
  "data/runtime/pipeline_report.json",
];

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

async function exists(relativePath) {
  try {
    await access(new URL(`../${relativePath}`, import.meta.url));
    return true;
  } catch {
    return false;
  }
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8"));
}

async function archiveHasDateSubfolder() {
  const entries = await readdir(new URL("../data/archive/", import.meta.url), { withFileTypes: true });
  return entries.some((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name));
}

function isSortedByHeat(clusters) {
  return clusters.every((cluster, index) => index === 0 || Number(clusters[index - 1].heat_score ?? 0) >= Number(cluster.heat_score ?? 0));
}

function hasRequiredDisplayFields(cluster) {
  return Boolean(
    cluster.headline_zh_hant &&
      cluster.summary_zh_hant &&
      cluster.what_happened_zh_hant &&
      cluster.why_it_matters_zh_hant &&
      cluster.watch_next_zh_hant,
  );
}

function sourceLinksPreserved(cluster) {
  return Array.isArray(cluster.source_links) && cluster.source_links.every((source) => source.source && source.url);
}

async function runBuild() {
  const env = {
    ...process.env,
    ASTRO_TELEMETRY_DISABLED: "1",
  };
  const nodeDir = path.dirname(process.execPath);
  env.Path = `${nodeDir}${path.delimiter}${env.Path ?? env.PATH ?? ""}`;
  env.PATH = env.Path;
  const command = process.platform === "win32" ? "cmd.exe" : "./node_modules/.bin/astro";
  const args = process.platform === "win32" ? ["/c", ".\\node_modules\\.bin\\astro.CMD", "build"] : ["build"];

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: fileURLToPath(ROOT_DIR),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stdout.on("data", (chunk) => process.stdout.write(chunk));
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      process.stderr.write(chunk);
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Website build failed with exit code ${code}: ${stderr.slice(-1200)}`));
    });
    child.on("error", reject);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const errors = [];

  for (const file of REQUIRED_FILES) {
    if (!(await exists(file))) errors.push(`Missing required output: ${file}`);
  }

  if (errors.length > 0) throw new Error(errors.join("\n"));

  const latest = await readJson("data/daily/latest.json");
  const date = args.date ?? latest.date;
  const runTime = args.runTime ?? latest.run_time_hkt;
  const archiveId = latest.archive_id ?? (date && runTime ? `${date}-${runTime}` : null);
  const timestampedArchivePath = archiveId ? `data/archive/${archiveId}.json` : null;
  const archiveAliasPath = `data/archive/${date}.json`;

  if (!archiveId) errors.push("latest.json missing archive_id");
  if (!latest.run_time_hkt) errors.push("latest.json missing run_time_hkt");
  if (archiveId && !/^\d{4}-\d{2}-\d{2}-\d{4}$/.test(archiveId)) errors.push("archive_id must use YYYY-MM-DD-HHmm format");
  if (timestampedArchivePath && !(await exists(timestampedArchivePath))) errors.push(`Missing archive JSON: ${timestampedArchivePath}`);
  if (!(await exists(archiveAliasPath))) errors.push(`Missing archive alias JSON: ${archiveAliasPath}`);
  if (await archiveHasDateSubfolder()) errors.push("data/archive must not contain YYYY-MM-DD date subfolders");
  if (!Array.isArray(latest.top_five) || latest.top_five.length === 0) errors.push("latest.json missing top_five");
  if (!Array.isArray(latest.clusters) || latest.clusters.length === 0) errors.push("latest.json missing clusters");
  if (Array.isArray(latest.clusters)) {
    if (!isSortedByHeat(latest.clusters)) errors.push("clusters are not sorted by heat_score descending");
    for (const cluster of latest.clusters) {
      if (!hasRequiredDisplayFields(cluster)) errors.push(`${cluster.cluster_id}: missing user-facing Traditional Chinese fields`);
      if (!sourceLinksPreserved(cluster)) errors.push(`${cluster.cluster_id}: source links missing or incomplete`);
    }
  }

  const report = await readJson("data/runtime/pipeline_report.json");
  if (report.date !== date) errors.push("pipeline_report.json date does not match latest.json");
  if (report.archive_id !== archiveId) errors.push("pipeline_report.json archive_id does not match latest.json");
  if (!report.latest_json_generated) errors.push("pipeline_report.json says latest.json was not generated");
  if (!report.archive_json_generated) errors.push("pipeline_report.json says archive JSON was not generated");

  const archiveIndex = await readJson("data/archive/index.json");
  const archiveItems = Array.isArray(archiveIndex.items) ? archiveIndex.items : [];
  const currentArchiveIndexItem = archiveItems.find((item) => item.archive_id === archiveId);
  if (!currentArchiveIndexItem) errors.push(`archive/index.json missing archive_id ${archiveId}`);
  else if (currentArchiveIndexItem.path !== `/archive/${archiveId}.json`) {
    errors.push(`archive/index.json path must use flat filename /archive/${archiveId}.json`);
  }
  if (currentArchiveIndexItem) {
    for (const field of [
      "market_mood",
      "market_mood_label_zh_hant",
      "top_five_headlines",
      "categories",
      "related_assets",
      "ai_summary_count",
    ]) {
      if (!(field in currentArchiveIndexItem)) errors.push(`archive/index.json current item missing ${field}`);
    }
  }

  const archiveSearchIndex = await readJson("data/search/archive-search-index.json");
  const archiveSearchItems = Array.isArray(archiveSearchIndex.items) ? archiveSearchIndex.items : [];
  const currentSearchItems = archiveSearchItems.filter((item) => item.archive_id === archiveId);
  if (Array.isArray(latest.clusters) && currentSearchItems.length !== latest.clusters.length) {
    errors.push(`archive-search-index.json should include ${latest.clusters.length} items for ${archiveId}, found ${currentSearchItems.length}`);
  }
  for (const item of currentSearchItems) {
    if (!Array.isArray(item.source_urls) || item.source_urls.length === 0) {
      errors.push(`archive-search-index.json item ${item.cluster_id} missing source_urls`);
    }
    if (typeof item.heat_score !== "number") {
      errors.push(`archive-search-index.json item ${item.cluster_id} missing numeric heat_score`);
    }
  }

  const categoryIndex = await readJson("data/archive/category-index.json");
  const categoryEntries = Array.isArray(categoryIndex.categories) ? categoryIndex.categories : [];
  if (categoryEntries.length === 0 && currentSearchItems.length > 0) errors.push("category-index.json has no category entries");

  if (errors.length > 0) throw new Error(errors.join("\n"));

  await runBuild();

  console.log(
    JSON.stringify(
      {
        status: "passed",
        date,
        run_time_hkt: runTime,
        archive_id: archiveId,
        cluster_count: latest.clusters.length,
        top_five_count: latest.top_five.length,
        archive_search_index_count: archiveSearchItems.length,
        category_index_count: categoryEntries.length,
        website_build_status: "success",
        required_outputs_checked: REQUIRED_FILES.length + 1,
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
