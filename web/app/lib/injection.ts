import { chinaDate, ensureKnowledgeWorkspace } from "./knowledge-workspace";
import { isCompilableRawSource } from "./validation.mjs";
import { ensureWikiForCards } from "./wiki";
import { compileKnowledgeUnits, parseKnowledgeUnits, topicFeatures, type KnowledgeUnit } from "./knowledge-units";

type FeedRow = {
  id: string;
  name: string;
  url: string;
  feed_type: "rss" | "aihot" | "wechat_index" | "html_index";
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
  verification_status: "unknown" | "verified" | "lead" | "official_link" | "needs_transcript";
  origin: "legacy" | "user_capture" | "daily_injection";
  created_at: string;
};

type Candidate = {
  title: string;
  url: string;
  excerpt: string;
  publisher: string;
  publishedAt: string;
  verificationStatus: "verified" | "lead" | "official_link";
  sourceType: "article" | "video";
  discoveredVia: "source_feed" | "aihot" | "wechat_index";
  followed: boolean;
};

type CompiledCard = KnowledgeUnit;

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
    for (const candidate of candidates.slice(0, 18)) {
      const inserted = await insertCandidate(db, ownerId, candidate);
      if (inserted.created) rawCreated += 1;
      if (inserted.id && candidate.verificationStatus === "verified") rawIds.push(inserted.id);
    }

    const cards = await compileQueuedSources(db, ownerId, config, {
      limit: DAILY_CARD_LIMIT,
      sourceIds: rawIds,
    });
    await ensureWikiForCards(db, ownerId);
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
      const compiledUnits = await compileRawSource(source, config);
      const creator = source.publisher || source.source_title || "主动收录";
      for (const [index, compiled] of compiledUnits.entries()) {
        const cardId = crypto.randomUUID();
        await db.prepare(`
          INSERT INTO knowledge_cards
            (id, owner_id, raw_source_id, title, hook, explanation, reasoning_move, boundary,
             why_it_matters, tags, topic_features, unit_key, source_name, source_url, verification_status, state)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published')
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
          JSON.stringify([...new Set([...compiled.tags, compiled.topic])]),
          topicFeatures(compiled, creator),
          `unit-${index + 1}`,
          creator,
          source.source_url,
          source.verification_status,
        ).run();
        cards.push({ ...compiled, id: cardId, rawSourceId: source.id });
      }
      await db.prepare("UPDATE clips SET processing_status = 'compiled', processed_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(source.id).run();
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
      if (feed.feed_type === "aihot") return parseAiHotCandidates(body, aihotPublisherHint(feed.url));
      if (feed.feed_type === "wechat_index") return parseWechatIndexCandidates(body, feed.name, feed.url);
      if (feed.feed_type === "html_index") return parseHtmlIndexCandidates(body, feed.name, feed.url);
      return parseRssCandidates(body, feed.name);
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
  const verificationBatch = [
    ...takeBalanced(unique.filter((candidate) => candidate.followed), 3, 15),
    ...unique.filter((candidate) => candidate.discoveredVia === "source_feed").slice(0, 12),
    ...unique.filter((candidate) => candidate.discoveredVia === "aihot").slice(0, 6),
  ];
  return Promise.all(verificationBatch.map((candidate) => verifyCandidate(candidate, fetcher)));
}

function takeBalanced(candidates: Candidate[], maxPerPublisher: number, limit: number) {
  const count = new Map<string, number>();
  const selected: Candidate[] = [];
  for (const candidate of candidates) {
    const current = count.get(candidate.publisher) ?? 0;
    if (current >= maxPerPublisher) continue;
    count.set(candidate.publisher, current + 1);
    selected.push(candidate);
    if (selected.length >= limit) break;
  }
  return selected;
}

async function insertCandidate(db: D1Database, ownerId: string, candidate: Candidate) {
  const hash = await hashContent(`${canonicalUrl(candidate.url)}:${candidate.excerpt}`);
  const existing = await db.prepare(`
    SELECT id, processing_status FROM clips
    WHERE owner_id = ? AND (content_hash = ? OR (source_url = ? AND source_url <> ''))
    LIMIT 1
  `).bind(ownerId, hash, candidate.url).first<{ id: string; processing_status: string }>();
  if (existing) {
    if (candidate.verificationStatus === "verified" && existing.processing_status !== "compiled") {
      await db.prepare(`
        UPDATE clips
        SET verification_status = 'verified', processing_status = 'queued', raw_excerpt = ?, processing_error = ''
        WHERE id = ? AND owner_id = ?
      `).bind(candidate.excerpt, existing.id, ownerId).run();
    } else if (candidate.verificationStatus === "official_link" && existing.processing_status !== "compiled") {
      await db.prepare(`
        UPDATE clips
        SET content = ?, source_url = ?, source_title = ?, publisher = ?, published_at = ?,
            verification_status = 'official_link', processing_status = 'skipped', raw_excerpt = '',
            processing_error = '已发现官方公众号链接，正文需在微信内完成验证后才能读取'
        WHERE id = ? AND owner_id = ?
      `).bind(
        candidate.url,
        candidate.url,
        candidate.title,
        candidate.publisher,
        candidate.publishedAt,
        existing.id,
        ownerId,
      ).run();
    }
    return { id: existing.id, created: false };
  }
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
    canCompile ? "" : processingErrorFor(candidate.verificationStatus),
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
  const storyContext = await getStoryContext(db, ownerId, cards.map((card) => card.id));
  const story = await compileStory(cards, config, storyContext).catch(() => fallbackStory(cards));
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
  await db.prepare(`
    INSERT INTO wiki_activity (id, owner_id, action, message, metadata)
    VALUES (?, ?, 'story_path', ?, ?)
  `).bind(
    crypto.randomUUID(),
    ownerId,
    `从 ${finalOrder.length} 个可追溯知识页编排今日故事「${story.title}」`,
    JSON.stringify({ storyId, cardIds: finalOrder }),
  ).run();
}

async function compileRawSource(source: RawRow, config: InjectionConfig) {
  const sourceText = source.raw_excerpt || source.content;
  return compileKnowledgeUnits({ title: source.source_title, url: source.source_url, text: sourceText }, config);
}

async function compileStory(cards: Array<CompiledCard & { id: string }>, config: InjectionConfig, wikiContext: string) {
  const compact = cards.map((card) => ({ id: card.id, title: card.title, hook: card.hook, reasoningMove: card.reasoningMove }));
  const response = await callDeepSeek(config, `你在编排持久 Wiki 上的一条阅读路径，而不是给卡片排序。基于下列知识卡与它们已有的 Wiki 关系，编排一个中文今日故事。开场先提出一个真实问题，中间每张卡只承担一个递进动作，最后给出可被带进工作的判断。不得把“related_to”写成因果、支持或冲突；缺少证据时保留不确定性。输出 json，字段为 title、openingQuestion、takeaway、order。order 必须是所有卡片 id 的数组，按从问题到收束的顺序排列。\n\n知识卡：${JSON.stringify(compact)}\n\nWiki 关系：${wikiContext}`);
  const parsed = JSON.parse(response);
  if (!parsed?.title || !parsed?.openingQuestion || !parsed?.takeaway || !Array.isArray(parsed?.order)) throw new Error("story json is incomplete");
  return {
    title: String(parsed.title).slice(0, 120),
    openingQuestion: String(parsed.openingQuestion).slice(0, 300),
    takeaway: String(parsed.takeaway).slice(0, 500),
    order: parsed.order.filter((id: unknown) => typeof id === "string"),
  };
}

async function getStoryContext(db: D1Database, ownerId: string, cardIds: string[]) {
  if (!cardIds.length) return "[]";
  const placeholders = cardIds.map(() => "?").join(",");
  const pages = await db.prepare(`
    SELECT c.id AS cardId, p.id AS pageId, p.title, p.summary
    FROM knowledge_cards c
    LEFT JOIN wiki_pages p ON p.id = c.wiki_page_id AND p.owner_id = c.owner_id
    WHERE c.owner_id = ? AND c.id IN (${placeholders})
  `).bind(ownerId, ...cardIds).all<{ cardId: string; pageId: string | null; title: string | null; summary: string | null }>();
  const pageIds = (pages.results ?? []).map((page) => page.pageId).filter((id): id is string => Boolean(id));
  if (!pageIds.length) return JSON.stringify(pages.results ?? []);
  const links = await db.prepare(`
    SELECT from_page_id AS fromPageId, to_page_id AS toPageId, relation, rationale
    FROM wiki_links WHERE owner_id = ? AND (from_page_id IN (${pageIds.map(() => "?").join(",")}) OR to_page_id IN (${pageIds.map(() => "?").join(",")}))
    LIMIT 40
  `).bind(ownerId, ...pageIds, ...pageIds).all<{ fromPageId: string; toPageId: string; relation: string; rationale: string }>();
  return JSON.stringify({ pages: pages.results ?? [], links: links.results ?? [] });
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
  return parseKnowledgeUnits(value)[0];
}

export function parseAiHotCandidates(body: string, expectedPublisher = ""): Candidate[] {
  const payload = JSON.parse(body) as { items?: unknown[] } | unknown[];
  const items = Array.isArray(payload) ? payload : payload.items ?? [];
  return items.flatMap((item) => {
    const value = item as Record<string, unknown>;
    const links = value.links as Record<string, unknown> | undefined;
    const source = value.source as Record<string, unknown> | undefined;
    const url = String(links?.original ?? value.original_url ?? value.originalUrl ?? value.url ?? "");
    const title = String(value.title ?? "").trim();
    const publisher = String(source?.name ?? value.site_name ?? "AI HOT");
    if (!title || !isPublicHttpUrl(url) || (expectedPublisher && !publisher.includes(expectedPublisher))) return [];
    return [{
      title,
      url,
      excerpt: cleanSnippet(String(value.summary ?? value.description ?? "")),
      publisher,
      publishedAt: String(value.published_at ?? value.publishedAt ?? ""),
      verificationStatus: "lead" as const,
      sourceType: "article" as const,
      discoveredVia: "aihot" as const,
      followed: Boolean(expectedPublisher),
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
      discoveredVia: "source_feed" as const,
      followed: false,
    }];
  });
}

export function parseWechatIndexCandidates(body: string, publisher: string, indexUrl: string): Candidate[] {
  const base = new URL(indexUrl);
  const byUrl = new Map<string, Candidate>();
  for (const match of body.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = resolvePublicUrl(match[1], base);
    const title = cleanSnippet(match[2], 280);
    if (!url || !/\/t\/[A-Za-z0-9]+/i.test(new URL(url).pathname) || title.length < 5) continue;
    byUrl.set(url, {
      title,
      url,
      excerpt: "",
      publisher,
      publishedAt: "",
      verificationStatus: "lead",
      sourceType: "article",
      discoveredVia: "wechat_index",
      followed: true,
    });
  }
  return [...byUrl.values()].slice(0, 5);
}

export function parseHtmlIndexCandidates(body: string, publisher: string, indexUrl: string): Candidate[] {
  const base = new URL(indexUrl);
  const byUrl = new Map<string, Candidate>();
  const articles = body.match(/<article\b[\s\S]*?<\/article>/gi) ?? [];
  for (const article of articles) {
    const publishedAt = article.match(/datetime=["']([^"']+)["']/i)?.[1] ?? "";
    if (publishedAt && !isRecentPublication(publishedAt)) continue;
    for (const match of article.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      const url = resolvePublicUrl(match[1], base);
      const title = cleanSnippet(match[2], 280);
      if (!url || title.length < 8) continue;
      const parsed = new URL(url);
      if (parsed.origin !== base.origin || parsed.pathname === "/" || /\/(tag|category|author|page)\//.test(parsed.pathname)) continue;
      byUrl.set(url, {
        title,
        url,
        excerpt: "",
        publisher,
        publishedAt,
        verificationStatus: "lead",
        sourceType: "article",
        discoveredVia: "source_feed",
        followed: true,
      });
    }
  }
  return [...byUrl.values()].slice(0, 5);
}

async function verifyCandidate(candidate: Candidate, fetcher: typeof fetch) {
  if (candidate.discoveredVia === "wechat_index") {
    const originalUrl = await resolveWechatOriginalUrl(candidate.url, fetcher);
    if (!originalUrl) return { ...candidate, verificationStatus: "lead" as const };
    return verifyArticleUrl({ ...candidate, url: originalUrl }, fetcher);
  }
  return verifyArticleUrl(candidate, fetcher);
}

async function verifyArticleUrl(candidate: Candidate, fetcher: typeof fetch) {
  const excerpt = await fetchPublicSourceExcerpt(candidate.url, fetcher);
  return excerpt.length >= 180
    ? { ...candidate, excerpt, verificationStatus: "verified" as const }
    : { ...candidate, verificationStatus: isWechatArticleUrl(candidate.url) ? "official_link" as const : "lead" as const };
}

async function resolveWechatOriginalUrl(indexArticleUrl: string, fetcher: typeof fetch) {
  try {
    const response = await fetcher(indexArticleUrl, {
      headers: { "user-agent": "ThinkingIntelligence/1.0" },
      redirect: "follow",
    });
    if (!response.ok) return "";
    const body = decodeHtmlEntities(await response.text());
    const direct = body.match(/https?:\/\/mp\.weixin\.qq\.com\/s\?[^\s"'<>]+/i)?.[0];
    if (direct && isPublicHttpUrl(direct)) return direct;
    for (const match of body.matchAll(/href=["']([^"']+)["']/gi)) {
      const value = decodeHtmlEntities(match[1]);
      const url = resolvePublicUrl(value, new URL(indexArticleUrl));
      if (url && new URL(url).hostname === "mp.weixin.qq.com") return url;
    }
    return "";
  } catch {
    return "";
  }
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
    const body = await response.text();
    if (isWechatArticleUrl(value) && /环境异常|完成验证后即可继续访问|captcha\.gtimg\.com/i.test(body)) return "";
    return cleanSnippet(body);
  } catch {
    return "";
  }
}

export function isWechatArticleUrl(value: string) {
  try {
    const url = new URL(value);
    return url.hostname === "mp.weixin.qq.com" && url.pathname === "/s";
  } catch {
    return false;
  }
}

function aihotPublisherHint(value: string) {
  try {
    const url = new URL(value);
    return url.hostname === "aihot.virxact.com" && url.searchParams.get("mode") === "all"
      ? url.searchParams.get("q") ?? ""
      : "";
  } catch {
    return "";
  }
}

function processingErrorFor(verificationStatus: Candidate["verificationStatus"]) {
  if (verificationStatus === "official_link") return "已发现官方公众号链接，正文需在微信内完成验证后才能读取";
  if (verificationStatus === "lead") return "仅作为线索，等待原文核验";
  return "来源没有足够可编译文本";
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

function resolvePublicUrl(value: string, base: URL) {
  try {
    const url = new URL(decodeHtmlEntities(value), base);
    return isPublicHttpUrl(url.toString()) ? url.toString() : "";
  } catch {
    return "";
  }
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"');
}

function isRecentPublication(value: string) {
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) || timestamp >= Date.now() - 32 * 86_400_000;
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
