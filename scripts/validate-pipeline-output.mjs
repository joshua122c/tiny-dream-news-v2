import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
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
  "data/runtime/pipeline_report.json",
];

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
  const archivePath = `data/archive/${date}.json`;

  if (!(await exists(archivePath))) errors.push(`Missing archive JSON: ${archivePath}`);
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
  if (!report.latest_json_generated) errors.push("pipeline_report.json says latest.json was not generated");
  if (!report.archive_json_generated) errors.push("pipeline_report.json says archive JSON was not generated");

  if (errors.length > 0) throw new Error(errors.join("\n"));

  await runBuild();

  console.log(
    JSON.stringify(
      {
        status: "passed",
        date,
        cluster_count: latest.clusters.length,
        top_five_count: latest.top_five.length,
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
