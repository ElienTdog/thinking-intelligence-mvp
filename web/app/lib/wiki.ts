type CardForWiki = {
  id: string;
  raw_source_id: string;
  wiki_page_id: string | null;
  title: string;
  hook: string;
  explanation: string;
  reasoning_move: string;
  tags: string;
  verification_status: string;
};

export type WikiPageRecord = {
  id: string;
  kind: "claim" | "topic" | "synthesis";
  title: string;
  summary: string;
  evidenceStatus: string;
  recallPrompt: string;
  transferPrompt: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type WikiLinkRecord = {
  id: string;
  fromPageId: string;
  toPageId: string;
  relation: "about" | "related_to" | "supports" | "contradicts" | "depends_on";
  rationale: string;
  createdAt: string;
};

export type WikiActivityRecord = {
  id: string;
  pageId: string | null;
  action: string;
  message: string;
  createdAt: string;
};

export type ReviewMoment = {
  page: WikiPageRecord;
  cardId: string;
  promptType: "recall" | "transfer" | "counter";
};

export type WikiQueryResult = {
  page: WikiPageRecord;
  relatedPageIds: string[];
};

export async function ensureWikiForCards(db: D1Database, ownerId: string) {
  const result = await db.prepare(`
    SELECT id, raw_source_id, wiki_page_id, title, hook, explanation, reasoning_move, tags, verification_status
    FROM knowledge_cards
    WHERE owner_id = ? AND state = 'published' AND (wiki_page_id IS NULL OR wiki_page_id = '')
    ORDER BY created_at ASC
    LIMIT 80
  `).bind(ownerId).all<CardForWiki>();
  for (const card of result.results ?? []) await createWikiPageForCard(db, ownerId, card);
  await refreshTopicIndexes(db, ownerId);
}

export async function getWikiSnapshot(db: D1Database, ownerId: string) {
  const [pages, links, activity, review] = await Promise.all([
    db.prepare(`
      SELECT id, kind, title, summary, evidence_status AS evidenceStatus, recall_prompt AS recallPrompt,
        transfer_prompt AS transferPrompt, version, created_at AS createdAt, updated_at AS updatedAt
      FROM wiki_pages WHERE owner_id = ? ORDER BY updated_at DESC LIMIT 96
    `).bind(ownerId).all<WikiPageRecord>(),
    db.prepare(`
      SELECT id, from_page_id AS fromPageId, to_page_id AS toPageId, relation, rationale, created_at AS createdAt
      FROM wiki_links WHERE owner_id = ? ORDER BY created_at DESC LIMIT 220
    `).bind(ownerId).all<WikiLinkRecord>(),
    db.prepare(`
      SELECT id, page_id AS pageId, action, message, created_at AS createdAt
      FROM wiki_activity WHERE owner_id = ? ORDER BY created_at DESC LIMIT 12
    `).bind(ownerId).all<WikiActivityRecord>(),
    getDueReview(db, ownerId),
  ]);
  return {
    pages: pages.results ?? [],
    links: links.results ?? [],
    activity: activity.results ?? [],
    review,
  };
}

export async function getWikiLint(db: D1Database, ownerId: string) {
  const [orphaned, missingSources, unverified] = await Promise.all([
    db.prepare(`
      SELECT p.id, p.title FROM wiki_pages p
      WHERE p.owner_id = ? AND p.kind IN ('claim', 'synthesis')
        AND NOT EXISTS (SELECT 1 FROM wiki_links l WHERE l.owner_id = p.owner_id AND (l.from_page_id = p.id OR l.to_page_id = p.id))
      ORDER BY p.updated_at DESC LIMIT 12
    `).bind(ownerId).all<{ id: string; title: string }>(),
    db.prepare(`
      SELECT p.id, p.title FROM wiki_pages p
      WHERE p.owner_id = ? AND p.kind IN ('claim', 'synthesis')
        AND NOT EXISTS (SELECT 1 FROM wiki_page_sources s WHERE s.owner_id = p.owner_id AND s.page_id = p.id)
      ORDER BY p.updated_at DESC LIMIT 12
    `).bind(ownerId).all<{ id: string; title: string }>(),
    db.prepare(`
      SELECT id, title FROM wiki_pages WHERE owner_id = ? AND kind IN ('claim', 'synthesis') AND evidence_status <> 'verified'
      ORDER BY updated_at DESC LIMIT 12
    `).bind(ownerId).all<{ id: string; title: string }>(),
  ]);
  return {
    orphaned: orphaned.results ?? [],
    missingSources: missingSources.results ?? [],
    unverified: unverified.results ?? [],
  };
}

export async function recordLearningAttempt(
  db: D1Database,
  ownerId: string,
  pageId: string,
  promptType: "recall" | "transfer" | "counter",
  response: string,
) {
  const page = await db.prepare(`
    SELECT id, title FROM wiki_pages WHERE id = ? AND owner_id = ? AND kind = 'claim'
  `).bind(pageId, ownerId).first<{ id: string; title: string }>();
  if (!page) return null;
  const nextReviewAt = new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString();
  await db.batch([
    db.prepare(`
      UPDATE learning_attempts SET next_review_at = '9999-12-31T00:00:00.000Z'
      WHERE owner_id = ? AND page_id = ? AND next_review_at <= ?
    `).bind(ownerId, page.id, new Date().toISOString()),
    db.prepare(`
      INSERT INTO learning_attempts (id, owner_id, page_id, prompt_type, response, next_review_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(crypto.randomUUID(), ownerId, page.id, promptType, response, nextReviewAt),
    db.prepare(`
      INSERT INTO wiki_activity (id, owner_id, page_id, action, message)
      VALUES (?, ?, ?, 'practiced', ?)
    `).bind(crypto.randomUUID(), ownerId, page.id, `你用${promptLabel(promptType)}回应了「${page.title}」`),
  ]);
  return { nextReviewAt };
}

export async function queryWiki(
  db: D1Database,
  ownerId: string,
  question: string,
  config: { apiKey?: string; model?: string; fetcher?: typeof fetch },
): Promise<WikiQueryResult | null> {
  if (!config.apiKey) throw new Error("DEEPSEEK_API_KEY is not configured");
  await ensureWikiForCards(db, ownerId);
  const pages = await db.prepare(`
    SELECT id, kind, title, summary, evidence_status AS evidenceStatus, recall_prompt AS recallPrompt,
      transfer_prompt AS transferPrompt, version, created_at AS createdAt, updated_at AS updatedAt
    FROM wiki_pages WHERE owner_id = ? AND kind IN ('claim', 'topic')
    ORDER BY updated_at DESC LIMIT 96
  `).bind(ownerId).all<WikiPageRecord>();
  const candidates = rankWikiPages(question, pages.results ?? []).slice(0, 10);
  if (!candidates.length) return null;

  const response = await callWikiModel(config, `你是私有 Wiki 的查询助手。只使用提供的知识页回答问题；它们共享主题不等于互相支持或冲突。输出 json，字段为 title、answer、caveat、pageIds。pageIds 必须是参考到的知识页 id，最多 6 个。\n\n问题：${question}\n\n可用知识页：${JSON.stringify(candidates.map((page) => ({ id: page.id, title: page.title, summary: page.summary, evidenceStatus: page.evidenceStatus })))}`);
  const parsed = JSON.parse(response) as { title?: unknown; answer?: unknown; caveat?: unknown; pageIds?: unknown };
  const title = String(parsed.title ?? "").trim().slice(0, 160);
  const answer = String(parsed.answer ?? "").trim().slice(0, 2_400);
  const caveat = String(parsed.caveat ?? "").trim().slice(0, 800);
  const candidateIds = new Set(candidates.map((page) => page.id));
  const relatedPageIds = Array.isArray(parsed.pageIds)
    ? [...new Set(parsed.pageIds.filter((id): id is string => typeof id === "string" && candidateIds.has(id)))].slice(0, 6)
    : [];
  if (!title || !answer || !relatedPageIds.length) throw new Error("Wiki 查询没有返回可追溯答案");

  const page: WikiPageRecord = {
    id: crypto.randomUUID(),
    kind: "synthesis",
    title: `问答：${title}`,
    summary: caveat ? `${answer}\n\n保留：${caveat}` : answer,
    evidenceStatus: "derived",
    recallPrompt: "",
    transferPrompt: "",
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const rawSources = await sourcesForPages(db, ownerId, relatedPageIds);
  const statements: D1PreparedStatement[] = [
    db.prepare(`
      INSERT INTO wiki_pages
        (id, owner_id, kind, title, summary, evidence_status, recall_prompt, transfer_prompt, version, updated_at)
      VALUES (?, ?, 'synthesis', ?, ?, 'derived', '', '', 1, CURRENT_TIMESTAMP)
    `).bind(page.id, ownerId, page.title, page.summary),
    db.prepare(`
      INSERT INTO wiki_activity (id, owner_id, page_id, action, message, metadata)
      VALUES (?, ?, ?, 'queried', ?, ?)
    `).bind(crypto.randomUUID(), ownerId, page.id, `把问题「${question}」沉淀为综合页「${page.title}」`, JSON.stringify({ relatedPageIds })),
  ];
  for (const relatedPageId of relatedPageIds) {
    statements.push(db.prepare(`
      INSERT INTO wiki_links (id, owner_id, from_page_id, to_page_id, relation, rationale)
      VALUES (?, ?, ?, ?, 'related_to', ?)
    `).bind(crypto.randomUUID(), ownerId, page.id, relatedPageId, "这张综合页引用该知识页；请回到对应来源核验细节"));
  }
  for (const rawSourceId of rawSources) {
    statements.push(db.prepare(`
      INSERT INTO wiki_page_sources (id, owner_id, page_id, raw_source_id, contribution)
      VALUES (?, ?, ?, ?, ?)
    `).bind(crypto.randomUUID(), ownerId, page.id, rawSourceId, `回答问题：${question}`));
  }
  await db.batch(statements);
  return { page, relatedPageIds };
}

async function createWikiPageForCard(db: D1Database, ownerId: string, card: CardForWiki) {
  const pageId = crypto.randomUUID();
  const recallPrompt = `不看解释，你会如何复述「${card.title}」的核心主张？`;
  const transferPrompt = `在你正在做的一件具体事情里，哪里可以试一次「${card.reasoning_move}」？`;
  await db.batch([
    db.prepare(`
      INSERT INTO wiki_pages
        (id, owner_id, kind, title, summary, evidence_status, recall_prompt, transfer_prompt, version, updated_at)
      VALUES (?, ?, 'claim', ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
    `).bind(pageId, ownerId, card.title, card.explanation, card.verification_status, recallPrompt, transferPrompt),
    db.prepare("UPDATE knowledge_cards SET wiki_page_id = ? WHERE id = ? AND owner_id = ?")
      .bind(pageId, card.id, ownerId),
    db.prepare(`
      INSERT INTO wiki_page_sources (id, owner_id, page_id, raw_source_id, contribution)
      VALUES (?, ?, ?, ?, ?)
    `).bind(crypto.randomUUID(), ownerId, pageId, card.raw_source_id, card.hook),
    db.prepare(`
      INSERT INTO wiki_activity (id, owner_id, page_id, action, message)
      VALUES (?, ?, ?, 'ingested', ?)
    `).bind(crypto.randomUUID(), ownerId, pageId, `从已核验来源建立知识页「${card.title}」`),
  ]);

  for (const tag of parseTags(card.tags)) {
    const topicId = await getOrCreateTopicPage(db, ownerId, tag);
    await linkOnce(db, ownerId, pageId, topicId, "about", `该知识页讨论主题「${tag}」`);
    const peers = await db.prepare(`
      SELECT l.from_page_id AS pageId
      FROM wiki_links l
      JOIN wiki_pages p ON p.id = l.from_page_id
      WHERE l.owner_id = ? AND l.to_page_id = ? AND l.relation = 'about'
        AND l.from_page_id <> ? AND p.kind = 'claim'
      ORDER BY l.created_at DESC LIMIT 3
    `).bind(ownerId, topicId, pageId).all<{ pageId: string }>();
    for (const peer of peers.results ?? []) {
      await linkOnce(db, ownerId, pageId, peer.pageId, "related_to", `共享主题「${tag}」，需要对照各自原始来源阅读`);
    }
  }
}

async function getOrCreateTopicPage(db: D1Database, ownerId: string, title: string) {
  const existing = await db.prepare(`
    SELECT id FROM wiki_pages WHERE owner_id = ? AND kind = 'topic' AND title = ? LIMIT 1
  `).bind(ownerId, title).first<{ id: string }>();
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  await db.batch([
    db.prepare(`
      INSERT INTO wiki_pages (id, owner_id, kind, title, summary, evidence_status, recall_prompt, transfer_prompt, version, updated_at)
      VALUES (?, ?, 'topic', ?, ?, 'verified', '', '', 1, CURRENT_TIMESTAMP)
    `).bind(id, ownerId, title, `围绕「${title}」积累的可追溯知识页。`),
    db.prepare(`
      INSERT INTO wiki_activity (id, owner_id, page_id, action, message)
      VALUES (?, ?, ?, 'indexed', ?)
    `).bind(crypto.randomUUID(), ownerId, id, `建立主题索引「${title}」`),
  ]);
  return id;
}

async function refreshTopicIndexes(db: D1Database, ownerId: string) {
  const topics = await db.prepare(`
    SELECT id, title, summary, version FROM wiki_pages
    WHERE owner_id = ? AND kind = 'topic'
  `).bind(ownerId).all<{ id: string; title: string; summary: string; version: number }>();

  for (const topic of topics.results ?? []) {
    const linked = await db.prepare(`
      SELECT p.title
      FROM wiki_links l
      JOIN wiki_pages p ON p.id = l.from_page_id
      WHERE l.owner_id = ? AND l.to_page_id = ? AND l.relation = 'about' AND p.kind = 'claim'
      ORDER BY p.updated_at DESC
      LIMIT 4
    `).bind(ownerId, topic.id).all<{ title: string }>();
    const titles = linked.results?.map((page) => page.title) ?? [];
    const nextSummary = titles.length
      ? `这个主题当前串联 ${titles.length} 个可追溯知识页：${titles.join("；")}。它们是阅读入口，不自动构成彼此支持或冲突。`
      : `围绕「${topic.title}」积累的可追溯知识页。`;
    if (topic.summary === nextSummary) continue;
    await db.batch([
      db.prepare(`
        UPDATE wiki_pages SET summary = ?, version = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND owner_id = ?
      `).bind(nextSummary, topic.version + 1, topic.id, ownerId),
      db.prepare(`
        INSERT INTO wiki_activity (id, owner_id, page_id, action, message)
        VALUES (?, ?, ?, 'indexed', ?)
      `).bind(crypto.randomUUID(), ownerId, topic.id, `更新主题索引「${topic.title}」，串联 ${titles.length} 个知识页`),
    ]);
  }
}

async function sourcesForPages(db: D1Database, ownerId: string, pageIds: string[]) {
  if (!pageIds.length) return [];
  const result = await db.prepare(`
    SELECT DISTINCT raw_source_id AS rawSourceId FROM wiki_page_sources
    WHERE owner_id = ? AND page_id IN (${pageIds.map(() => "?").join(",")})
  `).bind(ownerId, ...pageIds).all<{ rawSourceId: string }>();
  return result.results?.map((source) => source.rawSourceId) ?? [];
}

async function linkOnce(
  db: D1Database,
  ownerId: string,
  fromPageId: string,
  toPageId: string,
  relation: WikiLinkRecord["relation"],
  rationale: string,
) {
  if (fromPageId === toPageId) return;
  const existing = await db.prepare(`
    SELECT id FROM wiki_links
    WHERE owner_id = ? AND from_page_id = ? AND to_page_id = ? AND relation = ? LIMIT 1
  `).bind(ownerId, fromPageId, toPageId, relation).first<{ id: string }>();
  if (existing) return;
  await db.prepare(`
    INSERT INTO wiki_links (id, owner_id, from_page_id, to_page_id, relation, rationale)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(crypto.randomUUID(), ownerId, fromPageId, toPageId, relation, rationale).run();
}

async function getDueReview(db: D1Database, ownerId: string): Promise<ReviewMoment | null> {
  const due = await db.prepare(`
    SELECT p.id, p.kind, p.title, p.summary, p.evidence_status AS evidenceStatus, p.recall_prompt AS recallPrompt,
      p.transfer_prompt AS transferPrompt, p.version, p.created_at AS createdAt, p.updated_at AS updatedAt,
      a.prompt_type AS promptType, c.id AS cardId
    FROM learning_attempts a
    JOIN wiki_pages p ON p.id = a.page_id
    JOIN knowledge_cards c ON c.wiki_page_id = p.id AND c.owner_id = a.owner_id
    WHERE a.owner_id = ? AND a.next_review_at <= ?
    ORDER BY a.next_review_at ASC LIMIT 1
  `).bind(ownerId, new Date().toISOString()).first<WikiPageRecord & { promptType: ReviewMoment["promptType"]; cardId: string }>();
  if (!due || due.kind !== "claim") return null;
  const { cardId, promptType, ...page } = due;
  return { page, cardId, promptType };
}

function parseTags(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? [...new Set(parsed.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.trim()).filter(Boolean))].slice(0, 3)
      : [];
  } catch {
    return [];
  }
}

function promptLabel(promptType: ReviewMoment["promptType"]) {
  if (promptType === "transfer") return "迁移";
  if (promptType === "counter") return "反驳";
  return "复述";
}

function rankWikiPages(question: string, pages: WikiPageRecord[]) {
  const terms = [...new Set(question.replace(/\s+/g, "").split("").filter((term) => term.length > 0))];
  return pages
    .map((page) => ({ page, score: terms.reduce((score, term) => score + Number(`${page.title}${page.summary}`.includes(term)), 0) + (page.kind === "claim" ? 1 : 0) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || right.page.updatedAt.localeCompare(left.page.updatedAt))
    .map(({ page }) => page);
}

async function callWikiModel(config: { apiKey?: string; model?: string; fetcher?: typeof fetch }, prompt: string) {
  const response = await (config.fetcher ?? fetch)("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: config.model || "deepseek-v4-flash",
      messages: [
        { role: "system", content: "你输出有效 json。答案必须可追溯到提供的 Wiki 知识页，不确定时明确保留。" },
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
