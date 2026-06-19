# AGENTS.md

## Project Context

Tiny Dream News V2 is a clean rebuild of an automated global finance and technology morning brief website.

The project should be developed in small, reviewable phases. Do not reuse assumptions from any previous news website project.

## Agent Rules

For every task:

1. First explain the plan.
2. Make the smallest possible changes.
3. After changes, provide test or build commands.
4. State clearly what was changed.
5. State clearly what was not implemented.

## Scope Control

- Do not add unrelated features.
- Do not rewrite the whole project unless explicitly asked.
- Do not change the data schema without explaining why.
- Do not add paid APIs.
- Do not add login systems.
- Do not silently ignore errors.
- Do not implement all features at once.

## Daily Execution Constraints

- Daily execution must run from GitHub Actions.
- Codex will not be online during daily execution.
- GitHub Actions should run at 00:15 UTC, equal to 08:15 Hong Kong time.
- The production pipeline must be fully automated without relying on an active Codex session.

## AI Usage Constraints

- Cloudflare AI free usage is limited.
- Do not send every raw article to Cloudflare AI.
- Fetch, normalize, deduplicate, cluster, and score articles using non-AI logic before summarization.
- Only the top 20 to 30 news clusters should be sent to Cloudflare AI.
- AI summaries must be written in Traditional Chinese.
- AI tone must be neutral and factual.
- Do not provide investment advice.
- Do not invent facts not supported by source articles.
- If information is limited, say so clearly.

## Source Rules

MVP sources are limited to:

- CNBC
- MarketWatch
- Yahoo Finance
- TechCrunch
- The Verge
- 華爾街見聞, wallstreetcn.com

Do not include:

- 香港經濟日報
- 信報
- 經濟通

## Failure Handling

- If a daily run fails, do not overwrite `data/daily/latest.json`.
- Keep the previous successful version online.
- Write failures to `data/logs/YYYY-MM-DD-errors.log`.
- Log fetch details to `data/logs/YYYY-MM-DD-fetch.log`.
- Log AI details to `data/logs/YYYY-MM-DD-ai.log`.
- Errors should be visible and actionable.

## Expected Output Files

Daily successful runs should produce:

- `data/daily/latest.json`
- `data/archive/YYYY-MM-DD.json`
- `data/logs/YYYY-MM-DD-fetch.log`
- `data/logs/YYYY-MM-DD-ai.log`
- `data/logs/YYYY-MM-DD-errors.log`

## Development Boundaries

This project should be built phase by phase:

- Documentation first.
- Then data schema.
- Then source fetching.
- Then normalization.
- Then deterministic ranking logic.
- Then AI summarization.
- Then static website rendering.
- Then GitHub Actions.
- Then Cloudflare Pages deployment.

Do not skip ahead without an explicit task.

## Website Direction

The website should feel like a high-quality financial morning brief dashboard, not a generic blog list.

The homepage first screen must include:

- Site title
- Generated time
- Today's market mood
- Today's market mainline summary
- Top 5 most important stories
- Number of sources analyzed
- Number of articles fetched
- Number of clusters generated

Below that, show news theme cards sorted by heat score.

Each card should include:

- Heat score
- Chinese headline
- Categories
- Source count
- Main sources
- Related assets
- Summary sections
- Source links

