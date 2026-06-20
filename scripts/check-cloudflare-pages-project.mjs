import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";

const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";

function env(name) {
  return process.env[name] ?? "";
}

function isTrue(value) {
  return String(value ?? "").toLowerCase() === "true";
}

function maskAccountId(value) {
  if (!value) return "[missing]";
  if (value.length <= 10) return "[set-but-short]";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function requiredEnv() {
  const missing = [];
  for (const name of ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_PROJECT_NAME"]) {
    if (!env(name)) missing.push(name);
  }
  return missing;
}

function setGithubEnv(name, value) {
  if (!process.env.GITHUB_ENV) return;
  appendFileSync(process.env.GITHUB_ENV, `${name}=${value}\n`, "utf8");
}

async function cloudflareJson(path, options = {}) {
  const response = await fetch(`${CLOUDFLARE_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${env("CLOUDFLARE_API_TOKEN")}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  let body = null;

  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (!response.ok || body?.success === false) {
    const cloudflareErrors = Array.isArray(body?.errors)
      ? body.errors.map((error) => error.message).filter(Boolean).join("; ")
      : "";
    const message = cloudflareErrors || text.slice(0, 500) || response.statusText;
    throw new Error(`Cloudflare API ${response.status}: ${message}`);
  }

  return body;
}

async function listPagesProjects() {
  const accountId = encodeURIComponent(env("CLOUDFLARE_ACCOUNT_ID"));
  const projects = [];
  let page = 1;
  let totalPages = 1;

  do {
    const body = await cloudflareJson(`/accounts/${accountId}/pages/projects?per_page=100&page=${page}`);
    projects.push(...(Array.isArray(body?.result) ? body.result : []));
    totalPages = Number(body?.result_info?.total_pages ?? 1);
    page += 1;
  } while (page <= totalPages);

  return projects;
}

function printProjectNames(projects, label = "Accessible Pages project names") {
  const names = projects.map((project) => project.name).filter(Boolean).sort();
  console.log(`${label}:`);
  if (names.length === 0) {
    console.log("- [none]");
  } else {
    for (const name of names) console.log(`- ${name}`);
  }
  return names;
}

function runWranglerProjectCreate(projectName) {
  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  const result = spawnSync(command, ["wrangler", "pages", "project", "create", projectName, "--production-branch", "main"], {
    stdio: "inherit",
    shell: false,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`wrangler pages project create failed with exit code ${result.status}`);
  }
}

async function assertProjectExists() {
  const projectName = env("CLOUDFLARE_PROJECT_NAME");
  const accountId = env("CLOUDFLARE_ACCOUNT_ID");
  const autoCreate = isTrue(env("AUTO_CREATE_CLOUDFLARE_PROJECT"));

  console.log("Checking Cloudflare Pages project via Cloudflare REST API.");
  console.log(`Configured Pages project: ${projectName}`);
  console.log(`Configured Cloudflare account: ${maskAccountId(accountId)}`);

  let projects = await listPagesProjects();
  let names = printProjectNames(projects);

  if (names.includes(projectName)) {
    console.log(`Cloudflare Pages project '${projectName}' exists and exactly matches an accessible project.`);
    setGithubEnv("CLOUDFLARE_PROJECT_READY", "true");
    return;
  }

  if (!autoCreate) {
    throw new Error(
      [
        `Configured project '${projectName}' was not found in the Cloudflare account accessible to this API token.`,
        `Accessible projects are: ${names.length > 0 ? names.join(", ") : "[none]"}.`,
        "Check CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN permissions, or CLOUDFLARE_PROJECT_NAME.",
        "Set AUTO_CREATE_CLOUDFLARE_PROJECT=true only if you want the workflow to create the configured Pages project.",
      ].join(" "),
    );
  }

  console.log(`AUTO_CREATE_CLOUDFLARE_PROJECT=true, attempting to create Pages project '${projectName}'.`);
  runWranglerProjectCreate(projectName);

  projects = await listPagesProjects();
  names = printProjectNames(projects, "Accessible Pages project names after create");
  if (!names.includes(projectName)) {
    throw new Error(
      `Cloudflare Pages project '${projectName}' was not visible after auto-create. Check CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN scope, and CLOUDFLARE_PROJECT_NAME.`,
    );
  }

  console.log(`Cloudflare Pages project '${projectName}' now exists and exactly matches an accessible project.`);
  setGithubEnv("CLOUDFLARE_PROJECT_READY", "true");
}

async function main() {
  const missing = requiredEnv();
  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(", ")}`);
  }

  await assertProjectExists();
}

main().catch((error) => {
  setGithubEnv("CLOUDFLARE_PROJECT_READY", "false");
  console.error(`Cloudflare Pages project diagnostic failed: ${error.message}`);
  process.exitCode = 1;
});
