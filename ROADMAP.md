# Tiny Dream News V2 Roadmap

## Phase 0: Documentation

Goal: Establish the product, architecture, and development rules before implementation.

Deliverables:

- `PROJECT_SPEC.md`
- `AGENTS.md`
- `ROADMAP.md`

Not included:

- Website implementation
- News fetching
- AI calls
- GitHub Actions
- Cloudflare deployment

## Phase 1: Project Skeleton

Goal: Create the minimum project structure needed for future implementation.

Possible deliverables:

- Basic folder structure
- Initial package setup
- Linting and formatting setup
- Placeholder data directories
- Minimal README updates

Not included:

- Real news fetching
- AI summarization
- Production deployment

## Phase 2: Data Schema

Goal: Define stable JSON shapes for articles, clusters, daily briefs, summaries, and logs.

Possible deliverables:

- Draft schema documentation
- Type definitions
- Example fixture files
- Validation rules

Key rule:

- Do not change the data schema later without explaining why.

## Phase 3: Source Fetching MVP

Goal: Fetch raw articles from the approved MVP sources.

Approved sources:

- CNBC
- MarketWatch
- Yahoo Finance
- TechCrunch
- The Verge
- 華爾街見聞, wallstreetcn.com

Not included:

- 香港經濟日報
- 信報
- 經濟通
- Paid APIs

Expected behavior:

- Fetch failures are logged.
- One failed source should not hide the full run status.
- No errors are silently ignored.

## Phase 4: Normalization And Classification

Goal: Convert raw source items into a consistent article format and classify them by market category.

Covered categories:

- US stocks
- Hong Kong stocks
- China ADRs
- AI
- Semiconductors
- Macro
- Crypto
- FX
- Commodities

Possible deliverables:

- Normalized article structure
- Source metadata preservation
- Category classification logic
- Test fixtures

## Phase 5: Deduplication, Clustering, And Heat Score

Goal: Group related articles into news themes before any AI summarization.

Expected behavior:

- Deduplicate similar articles using deterministic non-AI logic.
- Cluster related articles into themes.
- Score clusters by explainable heat signals.
- Select only the top 20 to 30 clusters for AI summarization.

Possible heat signals:

- Number of sources covering the story
- Source diversity
- Category importance
- Recency
- Related asset relevance

## Phase 6: Cloudflare AI Summarization

Goal: Generate Traditional Chinese summaries only for selected top clusters.

Rules:

- Summaries must be neutral and factual.
- Do not provide investment advice.
- Do not invent unsupported facts.
- If information is limited, say so clearly.
- Preserve links to source articles.

Not included:

- Summarizing every raw article
- Paid AI APIs

## Phase 7: Daily Output Generation

Goal: Write the daily JSON files and logs in the expected locations.

Expected files:

- `data/daily/latest.json`
- `data/archive/YYYY-MM-DD.json`
- `data/logs/YYYY-MM-DD-fetch.log`
- `data/logs/YYYY-MM-DD-ai.log`
- `data/logs/YYYY-MM-DD-errors.log`

Failure rule:

- If the daily run fails, do not overwrite `data/daily/latest.json`.
- Keep the previous successful version online.

## Phase 8: Static Website

Goal: Build the financial morning brief dashboard from `latest.json`.

Homepage first screen:

- Site title
- Generated time
- Today's market mood
- Today's market mainline summary
- Top 5 most important stories
- Number of sources analyzed
- Number of articles fetched
- Number of clusters generated

News theme cards:

- Heat score
- Chinese headline
- Categories
- Source count
- Main sources
- Related assets
- Summary sections
- Source links

Design direction:

- High-quality financial morning brief dashboard.
- Not a generic blog list.

## Phase 9: GitHub Actions

Goal: Run the daily pipeline automatically.

Schedule:

- `00:15 UTC`
- Equivalent to `08:15 Hong Kong time`

Rules:

- Codex must not be required during daily execution.
- The workflow must preserve the previous successful `latest.json` if the run fails.
- Logs must be saved for debugging.

## Phase 10: Cloudflare Pages Deployment

Goal: Publish the generated static website to Cloudflare Pages.

Rules:

- Deployment should use the built static output.
- Do not introduce login systems.
- Do not add paid APIs.
- Keep deployment failure visible in logs.

## Later Enhancements

Possible future work after the MVP is stable:

- Better clustering logic
- More explainable heat scoring
- Manual source quality scoring
- Archive browsing
- Search and filters
- Better asset extraction
- Better error dashboards

These should be added only after the core MVP is working.

