function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function runPeriodLabel(runTime) {
  if (!/^\d{4}$/.test(String(runTime ?? ""))) return "歷史版本";
  const hourMinute = Number(runTime);
  if (hourMinute < 1100) return "早上版";
  if (hourMinute < 1500) return "中午版";
  if (hourMinute < 1900) return "下午版";
  return "晚間版";
}

function labelForRun(date, runTime) {
  const [year, month, day] = String(date ?? "").split("-");
  if (!year || !month || !day) return runPeriodLabel(runTime);
  return `${year}年${month}月${day}日 ${runPeriodLabel(runTime)}`;
}

function archiveIdForBrief(brief) {
  return brief.archive_id ?? `${brief.date}-${brief.run_time_hkt}`;
}

function sourceLinks(cluster) {
  return asArray(cluster.source_links ?? cluster.sources);
}

function sourceName(source) {
  return source.source ?? source.name ?? "";
}

function sourceUrl(source) {
  return source.url ?? "";
}

function topFiveHeadlines(brief) {
  return asArray(brief.top_five).map((item) => item.headline_zh_hant ?? item.headline_zh).filter(Boolean);
}

function clusterHeadline(cluster) {
  return cluster.headline_zh_hant ?? cluster.headline_zh ?? "";
}

function clusterSummary(cluster) {
  return cluster.summary_zh_hant ?? cluster.summary?.what_happened ?? "";
}

function clusterWatchNext(cluster) {
  if (cluster.watch_next_zh_hant) return cluster.watch_next_zh_hant;
  return asArray(cluster.summary?.watch_next).join(" ");
}

function heatLevel(cluster) {
  if (cluster.heat_level) return cluster.heat_level;
  const score = Number(cluster.heat_score ?? 0);
  if (score >= 70) return "high";
  if (score >= 45) return "elevated";
  if (score >= 25) return "watch";
  return "low";
}

function sourceNames(cluster) {
  return unique(sourceLinks(cluster).map(sourceName));
}

function sourceUrls(cluster) {
  return unique(sourceLinks(cluster).map(sourceUrl));
}

function keywordsForCluster(cluster) {
  const headlineWords = clusterHeadline(cluster)
    .split(/[\s,，.。:：;；/|、()（）[\]【】"'“”]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
    .slice(0, 12);

  return unique([
    ...asArray(cluster.categories),
    ...asArray(cluster.related_assets),
    ...asArray(cluster.related_markets),
    ...sourceNames(cluster),
    ...headlineWords,
  ]);
}

function compareGeneratedDesc(left, right) {
  const generatedCompare = String(right.generated_at ?? "").localeCompare(String(left.generated_at ?? ""));
  if (generatedCompare !== 0) return generatedCompare;
  const archiveCompare = String(right.archive_id ?? "").localeCompare(String(left.archive_id ?? ""));
  if (archiveCompare !== 0) return archiveCompare;
  return Number(right.heat_score ?? 0) - Number(left.heat_score ?? 0);
}

export function archiveIndexEntry(brief) {
  const archiveId = archiveIdForBrief(brief);
  const clusters = asArray(brief.clusters);
  const stats = brief.stats ?? {};

  return {
    archive_id: archiveId,
    date: brief.date,
    run_time_hkt: brief.run_time_hkt,
    generated_at: brief.generated_at,
    path: `/archive/${archiveId}.json`,
    label_zh_hant: labelForRun(brief.date, brief.run_time_hkt),
    market_mood: brief.market_mood,
    market_mood_label_zh_hant: brief.market_mood_label_zh_hant ?? "",
    top_headline_zh_hant: topFiveHeadlines(brief)[0] ?? clusters.map(clusterHeadline).find(Boolean) ?? "",
    top_five_headlines: topFiveHeadlines(brief),
    categories: unique(clusters.flatMap((cluster) => asArray(cluster.categories))),
    related_assets: unique(clusters.flatMap((cluster) => asArray(cluster.related_assets))).slice(0, 80),
    source_count: Number(stats.source_count ?? brief.source_count ?? 0),
    article_count: Number(stats.article_count ?? brief.article_count ?? 0),
    cluster_count: Number(stats.cluster_count ?? brief.cluster_count ?? clusters.length),
    ai_summary_count: Number(
      stats.summarized_cluster_count ??
        clusters.filter((cluster) => cluster.summary_type && cluster.summary_type !== "none").length,
    ),
  };
}

export function mergeArchiveIndex(existingIndex, brief) {
  const entry = archiveIndexEntry(brief);
  const existingItems = asArray(existingIndex?.items ?? existingIndex?.archives);
  const items = [entry, ...existingItems.filter((item) => item.archive_id !== entry.archive_id)].sort(compareGeneratedDesc);

  return {
    generated_at: new Date().toISOString(),
    items,
  };
}

export function searchItemsForBrief(brief) {
  const archiveId = archiveIdForBrief(brief);
  const archivePath = `/archive/${archiveId}.json`;

  return asArray(brief.clusters).map((cluster) => ({
    archive_id: archiveId,
    date: brief.date,
    run_time_hkt: brief.run_time_hkt,
    generated_at: brief.generated_at,
    cluster_id: cluster.cluster_id,
    headline_zh_hant: clusterHeadline(cluster),
    summary_zh_hant: clusterSummary(cluster),
    what_happened_zh_hant: cluster.what_happened_zh_hant ?? cluster.summary?.what_happened ?? "",
    why_it_matters_zh_hant: cluster.why_it_matters_zh_hant ?? cluster.summary?.why_it_matters ?? "",
    watch_next_zh_hant: clusterWatchNext(cluster),
    categories: asArray(cluster.categories),
    related_assets: asArray(cluster.related_assets),
    heat_score: Number(cluster.heat_score ?? 0),
    heat_level: heatLevel(cluster),
    source_names: sourceNames(cluster),
    source_urls: sourceUrls(cluster),
    keywords: keywordsForCluster(cluster),
    archive_path: archivePath,
  }));
}

export function mergeArchiveSearchIndex(existingIndex, brief) {
  const archiveId = archiveIdForBrief(brief);
  const existingItems = asArray(existingIndex?.items);
  const items = [
    ...searchItemsForBrief(brief),
    ...existingItems.filter((item) => item.archive_id !== archiveId),
  ].sort(compareGeneratedDesc);

  return {
    generated_at: new Date().toISOString(),
    items,
  };
}

export function buildCategoryIndex(searchIndex) {
  const groups = new Map();

  for (const item of asArray(searchIndex?.items)) {
    for (const category of asArray(item.categories)) {
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category).push(item);
    }
  }

  const categories = [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "zh-Hant"))
    .map(([category, items]) => ({
      category,
      items: items.sort(compareGeneratedDesc).map((item) => ({
        archive_id: item.archive_id,
        date: item.date,
        run_time_hkt: item.run_time_hkt,
        cluster_id: item.cluster_id,
        headline_zh_hant: item.headline_zh_hant,
        heat_score: item.heat_score,
        archive_path: item.archive_path,
      })),
    }));

  return {
    generated_at: new Date().toISOString(),
    categories,
  };
}
