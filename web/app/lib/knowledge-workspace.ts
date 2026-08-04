export type SourceSeed = {
  id: string;
  name: string;
  url: string;
  feedType: "rss" | "aihot";
  topic: string;
  trustLevel: number;
};

export const DEFAULT_SOURCE_FEEDS: SourceSeed[] = [
  { id: "simon-willison", name: "Simon Willison", url: "https://simonwillison.net/atom/everything/", feedType: "rss", topic: "AI 工程", trustLevel: 3 },
  { id: "one-useful-thing", name: "One Useful Thing", url: "https://www.oneusefulthing.org/feed", feedType: "rss", topic: "AI 与工作", trustLevel: 3 },
  { id: "interconnects", name: "Interconnects", url: "https://www.interconnects.ai/feed", feedType: "rss", topic: "AI 行业", trustLevel: 3 },
  { id: "latent-space", name: "Latent Space", url: "https://www.latent.space/feed", feedType: "rss", topic: "AI 产品", trustLevel: 2 },
  { id: "lilian-weng", name: "Lilian Weng", url: "https://lilianweng.github.io/index.xml", feedType: "rss", topic: "AI 研究", trustLevel: 3 },
  { id: "eugene-yan", name: "Eugene Yan", url: "https://eugeneyan.com/rss.xml", feedType: "rss", topic: "AI 产品", trustLevel: 3 },
  { id: "aihot-selected", name: "AI HOT 精选", url: "https://aihot.virxact.com/api/v1/items?mode=selected&window=24h&limit=12", feedType: "aihot", topic: "中文 AI 线索", trustLevel: 1 },
];

export async function ensureKnowledgeWorkspace(db: D1Database, ownerId: string) {
  for (const source of DEFAULT_SOURCE_FEEDS) {
    await db.prepare(`
      INSERT OR IGNORE INTO source_feeds
        (id, owner_id, name, url, feed_type, topic, trust_level, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `).bind(
      `${ownerId}:${source.id}`,
      ownerId,
      source.name,
      source.url,
      source.feedType,
      source.topic,
      source.trustLevel,
    ).run();
  }
}

export function chinaDate(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}
