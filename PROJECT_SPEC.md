# Tiny Dream News V2 Project Spec

## Project Goal

Tiny Dream News V2 is a clean rebuild of an automated global finance and technology morning brief website.

Every day at 08:15 Hong Kong time, the system will collect news from selected public news sources, normalize articles, deduplicate similar stories, cluster related articles into news themes, rank themes by heat score, generate Traditional Chinese neutral summaries using Cloudflare AI, and publish the result to a static website hosted on Cloudflare Pages.

The website is mainly for personal use and a small group of colleagues. It should help users quickly understand the most important global finance and technology trends each morning.

This project must not reuse assumptions from any old news website project.

## Markets Covered

- US stocks
- Hong Kong stocks
- China ADRs
- AI
- Semiconductors
- Macro
- Crypto
- FX
- Commodities

## MVP News Sources

### English

- CNBC
- MarketWatch
- Yahoo Finance
- TechCrunch
- The Verge

### Chinese

- 華爾街見聞, wallstreetcn.com

### Excluded Sources

The MVP must not include:

- 香港經濟日報
- 信報
- 經濟通

## Core Architecture Rules

- Daily execution must run from GitHub Actions.
- Codex will not be online during daily execution.
- GitHub Actions should run at 00:15 UTC, which equals 08:15 Hong Kong time.
- Cloudflare AI free usage is limited, so the system must not summarize every raw article.
- The system must first fetch, normalize, deduplicate, cluster, and score articles using non-AI logic.
- Only the top 20 to 30 news clusters should be sent to Cloudflare AI.
- AI summaries must be written in Traditional Chinese.
- AI tone must be neutral and factual.
- The product must not provide investment advice.
- AI output must not invent facts not supported by source articles.
- If source information is limited, the summary must say so clearly.
- If a daily run fails, the system must not overwrite `data/daily/latest.json`.
- The previous successful version should remain online after a failed run.

## Daily Pipeline

1. Fetch raw articles.
2. Normalize articles.
3. Classify articles.
4. Deduplicate articles.
5. Cluster related articles.
6. Score clusters by heat.
7. Select top clusters.
8. Generate Traditional Chinese summaries with Cloudflare AI.
9. Generate latest JSON and archive JSON.
10. Build static website.
11. Deploy to Cloudflare Pages.
12. Save logs.

## Expected Daily Output Files

- `data/daily/latest.json`
- `data/archive/YYYY-MM-DD.json`
- `data/logs/YYYY-MM-DD-fetch.log`
- `data/logs/YYYY-MM-DD-ai.log`
- `data/logs/YYYY-MM-DD-errors.log`

## Data Handling Principles

- Raw articles should be normalized before any ranking or AI summarization.
- Deduplication and clustering should use deterministic, non-AI logic first.
- Heat scoring should be explainable and based on observable article metadata.
- AI should receive only selected top clusters, not the full raw article set.
- Source URLs should be retained so users can inspect original reporting.
- Errors must be logged clearly and must not be silently ignored.
- The data schema should remain stable once introduced.
- Any schema change must be explained before implementation.

## Language Handling Rules

- Intermediate runtime files may preserve source-language text for traceability and debugging.
- Runtime files that may contain original English or Simplified Chinese include:
  - `data/runtime/raw_articles.json`
  - `data/runtime/normalized_articles.json`
  - `data/runtime/clean_articles.json`
  - `data/runtime/news_clusters.json`
  - `data/runtime/scored_clusters.json`
- User-facing output must be written in Traditional Chinese.
- User-facing output includes:
  - `data/runtime/summarized_clusters.json`
  - `data/daily/latest.json`
  - `data/archive/YYYY-MM-DD.json`
  - All website-displayed titles, summaries, key points, reasons, and watch-next items.
- The website must not display `cluster_title_candidate` as the official headline unless it has first been converted to Traditional Chinese.
- Formal display headlines should use `headline_zh_hant` or `summary.headline_zh_hant`.
- User-facing Traditional Chinese text should remain neutral, factual, and faithful to the source articles.

## Website Requirements

The homepage should look like a high-quality financial morning brief dashboard, not a generic blog list.

### First Screen

The first screen must show:

- Site title
- Generated time
- Today's market mood
- Today's market mainline summary
- Top 5 most important stories
- Number of sources analyzed
- Number of articles fetched
- Number of clusters generated

### News Theme Cards

Below the first screen, show news theme cards sorted by heat score.

Each card should show:

- Heat score
- Chinese headline
- Categories
- Source count
- Main sources
- Related assets
- Summary sections
- Source links

## Summary Requirements

Generated summaries must:

- Be written in Traditional Chinese.
- Use a neutral and factual tone.
- Avoid investment advice.
- Avoid unsupported claims.
- Clearly state uncertainty or limited information when relevant.
- Preserve important source context.
- Separate facts from interpretation when possible.

## Non-Goals For Initial Documentation Phase

This first documentation task must not implement:

- Website UI
- News fetching
- Article normalization
- Classification
- Deduplication
- Clustering
- Heat scoring
- Cloudflare AI calls
- GitHub Actions
- Cloudflare Pages deployment
- Paid APIs
- Login systems
