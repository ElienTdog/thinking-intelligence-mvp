import { chinaDate, ensureKnowledgeWorkspace } from "./knowledge-workspace";
import { isCompilableRawSource } from "./validation.mjs";

type FeedRow = {
  id: string;
  name: string;
  url: string;
  feed_type: "rss" | "aihot";
  topic: string;
  trust_level: number;
};

type RawRow = {
  id: string;
  content: string;
  source_url: string;
  source_title: string;
  source_type: "text" | "article" | "video";
  publisher: string;
  raw_excerpt: string;
  verification_status: "unknown" | "verified" | "lead" | "needs_transcript";
  origin: "legacy" | "user_capture" | "daily_injection";
  created_at: string;
};

type Candidate = {
  title: string;
  url: string;
  excerpt: string;
  publisher: string;
  publishedAt: string;
  verificationStatus: "verified" | "lead";
  sourceType: "article" | "video";
};

type CompiledCard = {
  title: string;
  hook: string;
  explanation: string;
  reasoningMove: string;
  boundary: string;
  whyItMatters: string;
  tags: string[];
};

export type InjectionConfig = {
  apiKey?: string;
  model?: string;
  fetcher?: typeof fetch;
};

const MAX_RAW_EXCERPT = 7_000;
const DAILY_CARD_LIMIT = 5;

export async function runDailyInjection(db: D1Database, config: InjectionConfig, force = false) {
  if (!config.apiKey) return { status: "skipped", reason: "DEEPSEEK_API_KEY is not configured" };
  const owners = await db.prepare("SELECT DISTINCT owner_id FROM source_feeds WHERE enabled = 1").all<{ owner_id: string }>();
  const results = [];
  for (const owner of owners.results ?? []) results.push(await runInjectionForOwner(db, owner.owner_id, config, force));
  return { status: "completed", runs: results };
}

export async function runInjectionForOwner(db: D1Database, ownerId: string, config: InjectionConfig, force = false) {
  await ensureKnowledgeWorkspace(db, ownerId);
  if (!config.apiKey) return { status: "skipped", reason: "DEEPSEEK_API_KEY is not configured" };

  const runDate = chinaDate();
  const existing = await db.prepare(
    "SELECT id, status FROM injection_runs WHERE owner_id = ? AND run_date = ? ORDER BY started_at DESC LIMIT 1",
  ).bind(ownerId, runDate).first<{ id: string; status: string }>();
  if (existing?.status === "completed" && !force) return { status: "completed", cached: true };

  const runId = existing?.id ?? crypto.randomUUID();
  if (existing) {
    await db.prepare("UPDATE injection_runs SET status = 'running', error = '', completed_at = '' WHERE id = ?").bind(runId).run();
  } else {
    await db.prepare(`
      INSERT INTO injection_runs (id, owner_id, run_date, status)
      VALUES (?, ?, ?, 'running')
    `).bind(runId, ownerId, runDate).run();
  }

  try {
    const feeds = await db.prepare(`
      SELECT id, name, url, feed_type, topic, trust_level
      FROM source_feeds WHERE owner_id = ? AND enabled = 1
    `).bind(ownerId).all<FeedRow>();
    const candidates = await collectCandidates(feeds.results ?? [], config.fetcher ?? fetch);
    let rawCreated = 0;
    const rawIds: string[] = [];
    for (const candidate of candidates.slice(0, 12)) {
      const inserted = await insertCandidate(db, ownerId, candidate);
      if (inserted.created) rawCreated += 1;
      if (inserted.id && candidate.verificationStatus === "verified") rawIds.push(inserted.id);
    }

    const cards = await compileQueuedSources(db, ownerId, config, {
      limit: DAILY_CARD_LIMIT,
      sourceIds: rawIds,
    });
    if (cards.length >= 3) await createDailyStory(db, ownerId, runDate, cards, config);

    await db.prepare(`
      UPDATE injection_runs
      SET status = 'completed', sources_scanned = ?, raw_created = ?, cards_created = ?, completed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(feeds.results?.length ?? 0, rawCreated, cards.length, runId).run();
    return { status: "completed", rawCreated, cardsCreated: cards.length };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "daily injection failed";
    await db.prepare("UPDATE injection_runs SET status = 'failed', error = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(message, runId).run();
    return { status: "failed", reason: message };
  }
}

export async function compileQueuedSources(
  db: D1Database,
  ownerId: string,
  config: InjectionConfig,
  options: { limit?: number; sourceIds?: string[] } = {},
) {
  if (!config.apiKey) return [];
  const limit = options.limit ?? 1;
  const filter = options.sourceIds?.length
    ? ` AND id IN (${options.sourceIds.map(() => "?").join(",")})`
    : "";
  const sources = await db.prepare(`
    SELECT id, content, source_url, source_title, source_type, publisher, raw_excerpt,
      verification_status, origin, created_at
    FROM clips
    WHERE owner_id = ? AND processing_status = 'queued'${filter}
    ORDER BY priority DESC, created_at ASC
    LIMIT ?
  `).bind(ownerId, ...(options.sourceIds ?? []), limit).all<RawRow>();
  const cards: Array<CompiledCard & { id: string; rawSourceId: string }> = [];
  for (const source of sources.results ?? []) {
    await db.prepare("UPDATE clips SET processing_status = 'processing', processing_error = '' WHERE id = ?").bind(source.id).run();
    try {
      if (!isCompilableRawSource({
        content: source.content,
        sourceUrl: source.source_url,
        sourceType: source.source_type,
        rawExcerpt: source.raw_excerpt,
      })) {
        await db.prepare("UPDATE clips SET processing_status = 'skipped', processing_error = ? WHERE id = ?")
          .bind(source.source_type === "video" ? "缺少可核验字幕或文字稿" : "来源没有足够可编译文本", source.id).run();
        continue;
      }
      const compiled = await compileRawSource(source, config);
      const cardId = crypto.randomUUID();
      await db.prepare(`
        INSERT INTO knowledge_cards
          (id, owner_id, raw_source_id, title, hook, explanation, reasoning_move, boundary,
           why_it_matters, tags, source_name, source_url, verification_status, state)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published')
      `).bind(
        cardId,
        ownerId,
        source.id,
        compiled.title,
        compiled.hook,
        compiled.explanation,
        compiled.reasoningMove,
        compiled.boundary,
        compiled.whyItMatters,
        JSON.stringify(compiled.tags),
        source.publisher || source.source_title || "主动收录",
        source.source_url,
        source.verification_status,
      ).run();
      await db.prepare("UPDATE clips SET processing_status = 'compiled', processed_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(source.id).run();
      cards.push({ ...compiled, id: cardId, rawSourceId: source.id });
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : "AI 编译失败";
      await db.prepare("UPDATE clips SET processing_status = 'failed', processing_error = ? WHERE id = ?")
        .bind(message, source.id).run();
    }
  }
  return cards;
}

async function collectCandidates(feeds: FeedRow[], fetcher: typeof fetch) {
  const candidateLists = await Promise.all(feeds.map(async (feed) => {
    try {
      const response = await fetcher(feed.url, { headers: { "user-agent": "ThinkingIntelligence/1.0" } });
      if (!response.ok) return [];
      const body = await response.text();
      return feed.feed_type === "aihot"
        ? parseAiHotCandidates(body)
        : parseRssCandidates(body, feed.name);
    } catch {
      return [];
    }
  }));
  const known = new Set<string>();
  const unique = candidateLists.flat().filter((candidate) => {
    const key = canonicalUrl(candidate.url);
    if (!key || known.has(key)) return false;
    known.add(key);
    return true;
  });
  return Promise.all(unique.map(async (candidate) => {
    if (candidate.verificationStatus === "lead") return candidate;
    const excerpt = await fetchPublicSourceExcerpt(candidate.url, fetcher);
    return excerpt.length >= 180
      ? { ...candidate, excerpt }
      : { ...candidate, verificationStatus: "lead" as const };
  }));
}

async function insertCandidate(db: D1Database, ownerId: string, candidate: Candidate) {
  const hash = await hashContent(`${canonicalUrl(candidate.url)}:${candidate.excerpt}`);
  const existing = await db.prepare(`
    SELECT id FROM clips
    WHERE owner_id = ? AND (content_hash = ? OR (source_url = ? AND source_url <> ''))
    LIMIT 1
  `).bind(ownerId, hash, candidate.url).first<{ id: string }>();
  if (existing) return { id: existing.id, created: false };
  const canCompile = candidate.verificationStatus === "verified" && candidate.excerpt.length >= 180;
  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO clips
      (id, owner_id, content, source_url, source_title, status, origin, source_type, publisher,
       published_at, verification_status, processing_status, raw_excerpt, content_hash, priority, processing_error)
    VALUES (?, ?, ?, ?, ?, 'captured', 'daily_injection', ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `).bind(
    id,
    ownerId,
    candidate.url,
    candidate.url,
    candidate.title,
    candidate.sourceType,
    candidate.publisher,
    candidate.publishedAt,
    candidate.verificationStatus,
    canCompile ? "queued" : "skipped",
    candidate.excerpt,
    hash,
    canCompile ? "" : candidate.verificationStatus === "lead" ? "仅作为线索，等待原文核验" : "来源没有足够可编译文本",
  ).run();
  return { id, created: true };
}

async function createDailyStory(
  db: D1Database,
  ownerId: string,
  storyDate: string,
  cards: Array<CompiledCard & { id: string }>,
  config: InjectionConfig,
) {
  const story = await compileStory(cards, config).catch(() => fallbackStory(cards));
  const existing = await db.prepare("SELECT id FROM daily_stories WHERE owner_id = ? AND story_date = ? LIMIT 1")
    .bind(ownerId, storyDate).first<{ id: string }>();
  const storyId = existing?.id ?? crypto.randomUUID();
  if (existing) {
    await db.prepare("UPDATE daily_stories SET title = ?, opening_question = ?, takeaway = ? WHERE id = ?")
      .bind(story.title, story.openingQuestion, story.takeaway, storyId).run();
  } else {
    await db.prepare(`
      INSERT INTO daily_stories (id, owner_id, story_date, title, opening_question, takeaway)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(storyId, ownerId, storyDate, story.title, story.openingQuestion, story.takeaway).run();
  }
  const orderedIds = story.order.filter((id) => cards.some((card) => card.id === id));
  const finalOrder = orderedIds.length === cards.length ? orderedIds : cards.map((card) => card.id);
  for (const [index, cardId] of finalOrder.entries()) {
    await db.prepare("UPDATE knowledge_cards SET story_id = ?, story_position = ? WHERE id = ? AND owner_id = ?")
      .bind(storyId, index + 1, cardId, ownerId).run();
  }
}

async function compileRawSource(source: RawRow, config: InjectionConfig) {
  const sourceText = source.raw_excerpt || source.content;
  const response = await callDeepSeek(config, `你是知识卡编译器。只根据给定来源生成一张中文知识卡，不得补充来源没有表达的事实。输出 json，字段为 title、hook、explanation、reasoningMove、boundary、whyItMatters、tags。tags 是 1-3 个短中文主题。\n\n来源标题：${source.source_title}\n来源：${source.source_url}\n文本：${sourceText}`);
  return parseCompiledCard(response);
}

async function compileStory(cards: Array<CompiledCard & { id: string }>, config: InjectionConfig) {
  const compact = cards.map((card) => ({ id: card.id, title: card.title, hook: card.hook, reasoningMove: card.reasoningMove }));
  const response = await callDeepSeek(config, `基于下列知识卡编排一个中文今日故事。输出 json，字段为 title、openingQuestion、takeaway、order。order 必须是所有卡片 id 的数组，按从问题到收束的顺序排列。\n${JSON.stringify(compact)}`);
  const parsed = JSON.parse(response);
  if (!parsed?.title || !parsed?.openingQuestion || !parsed?.takeaway || !Array.isArray(parsed?.order)) throw new Error("story json is incomplete");
  return {
    title: String(parsed.title).slice(0, 120),
    openingQuestion: String(parsed.openingQuestion).slice(0, 300),
    takeaway: String(parsed.takeaway).slice(0, 500),
    order: parsed.order.filter((id: unknown) => typeof id === "string"),
  };
}

async function callDeepSeek(config: InjectionConfig, prompt: string) {
  const response = await (config.fetcher ?? fetch)("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: config.model || "deepseek-v4-flash",
      messages: [
        { role: "system", content: "你输出有效 json，所有结论必须可追溯到提供的来源。" },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
      stream: false,
    }),
  });
  if (!response.ok) throw new Error(`DeepSeek request failed (${response.status})`);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("DeepSeek returned empty json");
  return content;
}

export function parseCompiledCard(value: string): CompiledCard {
  const parsed = JSON.parse(value);
  const required = ["title", "hook", "explanation", "reasoningMove", "boundary", "whyItMatters"];
  if (required.some((key) => !String(parsed?.[key] ?? "").trim())) throw new Error("card json is incomplete");
  const tags = Array.isArray(parsed.tags) ? parsed.tags.filter((tag: unknown) => typeof tag === "string").slice(0, 3) : [];
  if (!tags.length) throw new Error("card json has no tags");
  return {
    title: String(parsed.title).trim().slice(0, 160),
    hook: String(parsed.hook).trim().slice(0, 240),
    explanation: String(parsed.explanation).trim().slice(0, 2_000),
    reasoningMove: String(parsed.reasoningMove).trim().slice(0, 800),
    boundary: String(parsed.boundary).trim().slice(0, 800),
    whyItMatters: String(parsed.whyItMatters).trim().slice(0, 800),
    tags,
  };
}

export function parseAiHotCandidates(body: string): Candidate[] {
  const payload = JSON.parse(body) as { items?: unknown[]; data?: { items?: unknown[] } } | unknown[];
  const items = Array.isArray(payload) ? payload : payload.items ?? payload.data?.items ?? [];
  return items.flatMap((item) => {
    const value = item as Record<string, unknown>;
    const url = String(value.original_url ?? value.originalUrl ?? value.url ?? "");
    const title = String(value.title ?? "").trim();
    if (!title || !isPublicHttpUrl(url)) return [];
    return [{
      title,
      url,
      excerpt: cleanSnippet(String(value.summary ?? value.description ?? "")),
      publisher: String(value.source ?? value.site_name ?? "AI HOT"),
      publishedAt: String(value.published_at ?? value.publishedAt ?? ""),
      verificationStatus: "lead" as const,
      sourceType: "article" as const,
    }];
  });
}

export function parseRssCandidates(body: string, publisher: string): Candidate[] {
  const sections = body.match(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi) ?? [];
  return sections.flatMap((section) => {
    const title = xmlText(section, "title");
    const link = xmlAttribute(section, "link", "href") || xmlText(section, "link");
    const excerpt = cleanSnippet(xmlText(section, "content:encoded") || xmlText(section, "content") || xmlText(section, "description") || xmlText(section, "summary"));
    if (!title || !isPublicHttpUrl(link)) return [];
    return [{
      title,
      url: link,
      excerpt,
      publisher,
      publishedAt: xmlText(section, "pubDate") || xmlText(section, "updated") || xmlText(section, "published"),
      verificationStatus: "verified" as const,
      sourceType: "article" as const,
    }];
  });
}

export async function fetchPublicSourceExcerpt(value: string, fetcher: typeof fetch = fetch) {
  if (!isPublicHttpUrl(value)) return "";
  try {
    const response = await fetcher(value, {
      headers: { "user-agent": "ThinkingIntelligence/1.0" },
      redirect: "follow",
    });
    if (!response.ok) return "";
    const contentType = response.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml\+xml|text\/plain/i.test(contentType)) return "";
    return cleanSnippet(await response.text());
  } catch {
    return "";
  }
}

function fallbackStory(cards: Array<CompiledCard & { id: string }>) {
  return {
    title: "今日 AI 与产品知识流",
    openingQuestion: "今天哪些 AI 与产品判断，值得带进真实工作？",
    takeaway: cards.map((card) => card.hook).join(" ").slice(0, 500),
    order: cards.map((card) => card.id),
  };
}

function xmlText(section: string, tag: string) {
  const escapedTag = tag.replace(/:/g, "\\:");
  const match = section.match(new RegExp(`<${escapedTag}[^>]*>([\\s\\S]*?)<\\/${escapedTag}>`, "i"));
  return cleanSnippet(match?.[1] ?? "", 0);
}

function xmlAttribute(section: string, tag: string, attribute: string) {
  const match = section.match(new RegExp(`<${tag}[^>]*\\b${attribute}=["']([^"']+)["'][^>]*>`, "i"));
  return match?.[1] ?? "";
}

function cleanSnippet(value: string, limit = MAX_RAW_EXCERPT) {
  return value
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function canonicalUrl(value: string) {
  try {
    const url = new URL(value);
    if (!isPublicHttpUrl(url.toString())) return "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function isPublicHttpUrl(value: string) {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) return false;
    const host = url.hostname.toLowerCase();
    if (
      host === "localhost" || host.endsWith(".local") || host === "0.0.0.0" || host === "[::1]" || host === "::1"
      || host.startsWith("[fc") || host.startsWith("[fd") || /^127\./.test(host) || /^10\./.test(host)
      || /^169\.254\./.test(host) || /^192\.168\./.test(host)
    ) return false;
    const octets = host.match(/^172\.(\d+)\./);
    return !octets || Number(octets[1]) < 16 || Number(octets[1]) > 31;
  } catch {
    return false;
  }
}

export async function hashContent(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
