import { appendFileSync } from "node:fs";

const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";

class CloudflareApiError extends Error {
  constructor(status, statusText, errors, responseText) {
    const cloudflareMessages = errors.map((error) => {
      const code = error.code ? `code ${error.code}: ` : "";
      return `${code}${error.message}`;
    });
    const message = cloudflareMessages.join("; ") || responseText.slice(0, 500) || statusText;
    super(`Cloudflare API ${status}: ${message}`);
    this.name = "CloudflareApiError";
    this.status = status;
    this.errors = errors;
  }
}

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
    const errors = Array.isArray(body?.errors) ? body.errors : [];
    throw new CloudflareApiError(response.status, response.statusText, errors, text);
  }

  return body;
}

function isPaginationOptionsError(error) {
  if (!(error instanceof CloudflareApiError) || error.status !== 400) return false;
  const text = error.errors.map((entry) => `${entry.code ?? ""} ${entry.message ?? ""}`).join(" ");
  return /page|per_page|list options/i.test(text);
}

function getTotalPages(body) {
  const totalPages = Number(body?.result_info?.total_pages ?? 1);
  return Number.isInteger(totalPages) && totalPages > 1 ? totalPages : 1;
}

async function listPagesProjects() {
  const accountId = encodeURIComponent(env("CLOUDFLARE_ACCOUNT_ID"));
  const basePath = `/accounts/${accountId}/pages/projects`;
  const firstBody = await cloudflareJson(basePath);
  const firstPageProjects = Array.isArray(firstBody?.result) ? firstBody.result : [];
  const totalPages = getTotalPages(firstBody);

  if (totalPages <= 1) return firstPageProjects;

  try {
    const perPage = 50;
    const firstPaginatedBody = await cloudflareJson(`${basePath}?page=1&per_page=${perPage}`);
    const projects = Array.isArray(firstPaginatedBody?.result) ? [...firstPaginatedBody.result] : [];
    const paginatedTotalPages = getTotalPages(firstPaginatedBody);

    for (let page = 2; page <= paginatedTotalPages; page += 1) {
      const body = await cloudflareJson(`${basePath}?page=${page}&per_page=${perPage}`);
      projects.push(...(Array.isArray(body?.result) ? body.result : []));
    }

    return projects;
  } catch (error) {
    if (isPaginationOptionsError(error)) {
      console.warn("Cloudflare rejected paginated Pages project listing. Falling back to the unpaginated result.");
      return firstPageProjects;
    }
    throw error;
  }
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

async function createPagesProject(projectName) {
  const accountId = encodeURIComponent(env("CLOUDFLARE_ACCOUNT_ID"));
  await cloudflareJson(`/accounts/${accountId}/pages/projects`, {
    method: "POST",
    body: JSON.stringify({
      name: projectName,
      production_branch: "main",
    }),
  });
}

async function assertProjectExists() {
  const projectName = env("CLOUDFLARE_PROJECT_NAME");
  const accountId = env("CLOUDFLARE_ACCOUNT_ID");
  const autoCreate = isTrue(env("AUTO_CREATE_CLOUDFLARE_PROJECT"));

  if (projectName === "tinydream-news") {
    throw new Error(
      "Refusing to use Cloudflare Pages project 'tinydream-news'. Set CLOUDFLARE_PROJECT_NAME to the new project name before deployment.",
    );
  }

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

  console.log(`AUTO_CREATE_CLOUDFLARE_PROJECT=true, creating Pages project '${projectName}' with production branch 'main'.`);
  await createPagesProject(projectName);

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
  if (error instanceof CloudflareApiError) {
    console.error(`Cloudflare API HTTP status: ${error.status}`);
    for (const entry of error.errors) {
      console.error(`Cloudflare API error: code=${entry.code ?? "[none]"} message=${entry.message ?? "[none]"}`);
    }
    console.error(`Configured Cloudflare account: ${maskAccountId(env("CLOUDFLARE_ACCOUNT_ID"))}`);
    console.error(`Configured Pages project: ${env("CLOUDFLARE_PROJECT_NAME") || "[missing]"}`);
  }
  console.error(`Cloudflare Pages project diagnostic failed: ${error.message}`);
  process.exitCode = 1;
});
