import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = new URL("../", import.meta.url);
const RUNTIME_DIR = new URL("../data/runtime/", import.meta.url);
const DAILY_FILE = new URL("../data/daily/latest.json", import.meta.url);
const ARCHIVE_DIR = new URL("../data/archive/", import.meta.url);
const SEARCH_DIR = new URL("../data/search/", import.meta.url);
const REPORT_FILE = new URL("../data/runtime/pipeline_report.json", import.meta.url);

function nowIso() {
  return new Date().toISOString();
}

function parseArgs(argv) {
  const args = {
    date: null,
    mockAi: true,
    realAi: false,
    skipFetch: false,
    skipBuild: false,
    runTime: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--date") {
      args.date = argv[index + 1];
      index += 1;
    } else if (item === "--mock-ai") {
      args.mockAi = true;
      args.realAi = false;
    } else if (item === "--real-ai") {
      args.realAi = true;
      args.mockAi = false;
    } else if (item === "--skip-fetch") {
      args.skipFetch = true;
    } else if (item === "--skip-build") {
      args.skipBuild = true;
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

function nodeCommand(script, args = []) {
  return {
    command: process.execPath,
    args: [script, ...args],
  };
}

function buildCommand() {
  if (process.platform === "win32") {
    return {
      command: "cmd.exe",
      args: ["/c", ".\\node_modules\\.bin\\astro.CMD", "build"],
    };
  }

  return {
    command: "./node_modules/.bin/astro",
    args: ["build"],
  };
}

function commandString(command, args) {
  return [command, ...args].join(" ");
}

async function runCommand(stepName, commandSpec, env, report) {
  const startedAt = nowIso();
  report.steps_run.push({
    step: stepName,
    command: commandString(commandSpec.command, commandSpec.args),
    started_at: startedAt,
  });

  return new Promise((resolve, reject) => {
    const child = spawn(commandSpec.command, commandSpec.args, {
      cwd: fileURLToPath(ROOT_DIR),
      env,
      shell: commandSpec.shell ?? false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      process.stderr.write(chunk);
    });
    child.on("close", (code) => {
      const finishedAt = nowIso();
      const stepResult = {
        step: stepName,
        exit_code: code,
        started_at: startedAt,
        finished_at: finishedAt,
      };

      if (code === 0) {
        report.steps_succeeded.push(stepResult);
        resolve({ stdout, stderr });
      } else {
        report.steps_failed.push({
          ...stepResult,
          stderr: stderr.slice(-4000),
        });
        reject(new Error(`${stepName} failed with exit code ${code}`));
      }
    });
    child.on("error", (error) => {
      report.steps_failed.push({
        step: stepName,
        exit_code: null,
        started_at: startedAt,
        finished_at: nowIso(),
        stderr: error.message,
      });
      reject(error);
    });
  });
}

async function backupIfExists(url, backupUrl) {
  if (!existsSync(url)) return false;
  await mkdir(new URL("./", backupUrl), { recursive: true });
  await copyFile(url, backupUrl);
  return true;
}

async function restoreIfExists(backupUrl, targetUrl) {
  if (!existsSync(backupUrl)) return;
  await mkdir(new URL("./", targetUrl), { recursive: true });
  await copyFile(backupUrl, targetUrl);
}

function validateRealAiEnv() {
  const missing = [];
  if (!process.env.CLOUDFLARE_ACCOUNT_ID) missing.push("CLOUDFLARE_ACCOUNT_ID");
  if (!process.env.CLOUDFLARE_API_TOKEN) missing.push("CLOUDFLARE_API_TOKEN");
  if (!process.env.CLOUDFLARE_AI_MODEL) missing.push("CLOUDFLARE_AI_MODEL");
  return missing;
}

async function collectMetrics(date, runTime) {
  const normalized = await readJsonIfExists(new URL("../data/runtime/normalized_articles.json", import.meta.url), {});
  const clean = await readJsonIfExists(new URL("../data/runtime/clean_articles.json", import.meta.url), {});
  const clusters = await readJsonIfExists(new URL("../data/runtime/news_clusters.json", import.meta.url), {});
  const summarized = await readJsonIfExists(new URL("../data/runtime/summarized_clusters.json", import.meta.url), {});
  const latestExists = existsSync(DAILY_FILE);
  const archiveId = `${date}-${runTime}`;
  const archiveExists = existsSync(new URL(`${archiveId}.json`, ARCHIVE_DIR));

  return {
    article_count: Array.isArray(normalized.articles) ? normalized.articles.length : 0,
    clean_article_count: Array.isArray(clean.articles) ? clean.articles.length : 0,
    cluster_count: Array.isArray(clusters.clusters) ? clusters.clusters.length : 0,
    summarized_cluster_count: Array.isArray(summarized.clusters)
      ? summarized.clusters.filter((cluster) => cluster.summary_type !== "none").length
      : 0,
    latest_json_generated: latestExists,
    archive_json_generated: archiveExists,
  };
}

async function inspectWarnings(report) {
  const sourceStatus = await readJsonIfExists(new URL("../data/runtime/source_status.json", import.meta.url), null);
  const failedSources = (sourceStatus?.sources ?? []).filter((source) => source.status === "failed");
  if (failedSources.length > 0) {
    report.warnings.push(`Source failures recorded: ${failedSources.map((source) => source.source).join(", ")}`);
  }

  const latest = await readJsonIfExists(DAILY_FILE, null);
  if (latest?.warnings?.length) {
    report.warnings.push(...latest.warnings);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const date = args.date ?? hongKongDate();
  const runTime = args.runTime ?? hongKongRunTime();
  validateRunTime(runTime);
  const archiveId = `${date}-${runTime}`;
  const mode = args.realAi ? "real-ai" : "mock-ai";
  const env = {
    ...process.env,
    ASTRO_TELEMETRY_DISABLED: "1",
    AI_MOCK_MODE: args.realAi ? "false" : "true",
    DAILY_BRIEF_AI_MOCK_MODE: args.realAi ? "false" : "true",
  };
  const nodeDir = path.dirname(process.execPath);
  env.Path = `${nodeDir}${path.delimiter}${env.Path ?? env.PATH ?? ""}`;
  env.PATH = env.Path;

  const report = {
    generated_at: nowIso(),
    date,
    run_time_hkt: runTime,
    archive_id: archiveId,
    mode,
    steps_run: [],
    steps_succeeded: [],
    steps_failed: [],
    important_output_files: [
      "data/runtime/raw_articles.json",
      "data/runtime/normalized_articles.json",
      "data/runtime/clean_articles.json",
      "data/runtime/news_clusters.json",
      "data/runtime/scored_clusters.json",
      "data/runtime/summarized_clusters.json",
      "data/daily/latest.json",
      `data/archive/${archiveId}.json`,
      `data/archive/${date}.json`,
      "data/archive/index.json",
      "data/search/archive-search-index.json",
      "data/archive/category-index.json",
      "data/runtime/pipeline_report.json",
    ],
    article_count: 0,
    clean_article_count: 0,
    cluster_count: 0,
    summarized_cluster_count: 0,
    latest_json_generated: false,
    archive_json_generated: false,
    website_build_status: args.skipBuild ? "skipped" : "not_started",
    warnings: [],
    errors: [],
  };

  await mkdir(RUNTIME_DIR, { recursive: true });

  try {
    if (args.realAi) {
      const missingEnv = validateRealAiEnv();
      if (missingEnv.length > 0) {
        throw new Error(`--real-ai requires missing environment variable(s): ${missingEnv.join(", ")}`);
      }
    }

    if (args.skipFetch) {
      report.steps_run.push({
        step: "fetch_news_and_normalize",
        command: "skipped by --skip-fetch",
        started_at: nowIso(),
      });
      report.steps_succeeded.push({
        step: "fetch_news_and_normalize",
        exit_code: 0,
        started_at: nowIso(),
        finished_at: nowIso(),
        skipped: true,
      });
      report.warnings.push("Fetch step skipped; existing runtime article files were reused.");
    } else {
      await runCommand("fetch_news_and_normalize", nodeCommand("scripts/fetch-news.mjs"), env, report);
    }

    await runCommand("clean_classify_deduplicate", nodeCommand("scripts/clean-dedupe-articles.mjs"), env, report);
    await runCommand("cluster_related_articles", nodeCommand("scripts/cluster-news.mjs"), env, report);
    await runCommand("score_clusters", nodeCommand("scripts/score-clusters.mjs"), env, report);
    await runCommand("summarize_clusters", nodeCommand("scripts/summarize-clusters-mock.mjs"), env, report);

    const backupDir = new URL("../data/runtime/pipeline-backup/", import.meta.url);
    const latestBackup = new URL("latest.backup.json", backupDir);
    const archiveUrl = new URL(`${archiveId}.json`, ARCHIVE_DIR);
    const archiveAliasUrl = new URL(`${date}.json`, ARCHIVE_DIR);
    const archiveIndexUrl = new URL("index.json", ARCHIVE_DIR);
    const archiveSearchIndexUrl = new URL("archive-search-index.json", SEARCH_DIR);
    const categoryIndexUrl = new URL("category-index.json", ARCHIVE_DIR);
    const archiveBackup = new URL(`${archiveId}.backup.json`, backupDir);
    const archiveAliasBackup = new URL(`${date}.backup.json`, backupDir);
    const archiveIndexBackup = new URL("archive-index.backup.json", backupDir);
    const archiveSearchIndexBackup = new URL("archive-search-index.backup.json", backupDir);
    const categoryIndexBackup = new URL("category-index.backup.json", backupDir);
    await backupIfExists(DAILY_FILE, latestBackup);
    await backupIfExists(archiveUrl, archiveBackup);
    await backupIfExists(archiveAliasUrl, archiveAliasBackup);
    await backupIfExists(archiveIndexUrl, archiveIndexBackup);
    await backupIfExists(archiveSearchIndexUrl, archiveSearchIndexBackup);
    await backupIfExists(categoryIndexUrl, categoryIndexBackup);

    try {
      await runCommand("generate_final_daily_brief_json", nodeCommand("scripts/generate-daily-brief.mjs", ["--date", date, "--run-time", runTime]), env, report);
    } catch (error) {
      await restoreIfExists(latestBackup, DAILY_FILE);
      await restoreIfExists(archiveBackup, archiveUrl);
      await restoreIfExists(archiveAliasBackup, archiveAliasUrl);
      await restoreIfExists(archiveIndexBackup, archiveIndexUrl);
      await restoreIfExists(archiveSearchIndexBackup, archiveSearchIndexUrl);
      await restoreIfExists(categoryIndexBackup, categoryIndexUrl);
      throw error;
    }

    await runCommand("enhance_morning_brief", nodeCommand("scripts/enhance-daily-brief-ai.mjs"), env, report);
    await runCommand("validate_final_output", nodeCommand("scripts/validate-daily-brief.mjs", ["--date", date, "--run-time", runTime]), env, report);

    if (!args.skipBuild) {
      report.website_build_status = "running";
      await runCommand("build_static_website", buildCommand(), env, report);
      report.website_build_status = "success";
    }

    Object.assign(report, await collectMetrics(date, runTime));
    await inspectWarnings(report);
  } catch (error) {
    report.errors.push({
      message: error.message,
      occurred_at: nowIso(),
    });
    if (report.website_build_status === "running") report.website_build_status = "failed";
    Object.assign(report, await collectMetrics(date, runTime));
    await writeJson(REPORT_FILE, report);
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  await writeJson(REPORT_FILE, report);
  console.log(
    JSON.stringify(
      {
        generated_at: report.generated_at,
        date,
        run_time_hkt: runTime,
        archive_id: archiveId,
        mode,
        steps_succeeded: report.steps_succeeded.length,
        steps_failed: report.steps_failed.length,
        article_count: report.article_count,
        clean_article_count: report.clean_article_count,
        cluster_count: report.cluster_count,
        summarized_cluster_count: report.summarized_cluster_count,
        website_build_status: report.website_build_status,
        report: "data/runtime/pipeline_report.json",
      },
      null,
      2,
    ),
  );
}

main();
