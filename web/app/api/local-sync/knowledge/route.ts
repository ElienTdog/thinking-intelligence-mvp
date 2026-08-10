import { env } from "cloudflare:workers";
import { compileKnowledgeUnits, topicFeatures } from "../../../lib/knowledge-units";
import { requireSyncOwner } from "../auth";

type LocalPage = {
  localPath?: unknown;
  title?: unknown;
  summary?: unknown;
  kind?: unknown;
  transferPrompt?: unknown;
};

type KnowledgeItem = {
  sourceLocalPath?: unknown;
  sourceContent?: unknown;
  sourceTitle?: unknown;
  sourceUrl?: unknown;
  sourceName?: unknown;
  sourceCoverUrl?: unknown;
  publishedAt?: unknown;
  digest?: LocalPage & { keyPoints?: unknown; relation?: unknown; relatedQuestions?: unknown };
  methods?: LocalPage[];
};

const text = (value: unknown, limit: number) => typeof value === "string" ? value.trim().slice(0, limit) : "";
async function upsertPage(ownerId: string, rawSourceId: string, page: LocalPage, kind: "synthesis" | "topic") {
  const localPath = text(page.localPath, 1_000);
  const title = text(page.title, 280);
  const summary = text(page.summary, 2_400);
  if (!localPath || !title || !summary) return null;
  const transferPrompt = text(page.transferPrompt, 1_000);
  const existing = await env.DB.prepare("SELECT id, summary, transfer_prompt AS transferPrompt FROM wiki_pages WHERE owner_id = ? AND local_path = ? LIMIT 1")
    .bind(ownerId, localPath).first<{ id: string; summary: string; transferPrompt: string }>();
  const pageId = existing?.id ?? crypto.randomUUID();
  const changed = !existing || existing.summary !== summary || existing.transferPrompt !== transferPrompt;
  if (existing) {
    if (changed) await env.DB.prepare("UPDATE wiki_pages SET kind = ?, title = ?, summary = ?, evidence_status = 'verified', recall_prompt = ?, transfer_prompt = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND owner_id = ?")
      .bind(kind, title, summary, `不看原文，你会如何复述「${title}」？`, transferPrompt, pageId, ownerId).run();
  } else {
    await env.DB.prepare("INSERT INTO wiki_pages (id, owner_id, kind, title, summary, evidence_status, recall_prompt, transfer_prompt, local_path, version, updated_at) VALUES (?, ?, ?, ?, ?, 'verified', ?, ?, ?, 1, CURRENT_TIMESTAMP)")
      .bind(pageId, ownerId, kind, title, summary, `不看原文，你会如何复述「${title}」？`, transferPrompt, localPath).run();
  }
  await env.DB.prepare("DELETE FROM wiki_page_sources WHERE owner_id = ? AND page_id = ?").bind(ownerId, pageId).run();
  await env.DB.prepare("INSERT INTO wiki_page_sources (id, owner_id, page_id, raw_source_id, contribution) VALUES (?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), ownerId, pageId, rawSourceId, "由本地 DeepSeek Wiki 维护结果同步").run();
  if (changed) await env.DB.prepare("INSERT INTO wiki_activity (id, owner_id, page_id, action, message) VALUES (?, ?, ?, 'synced', ?)")
    .bind(crypto.randomUUID(), ownerId, pageId, `本地 Wiki 更新已镜像：${title}`).run();
  return pageId;
}

export async function POST(request: Request) {
  const ownerId = await requireSyncOwner(request);
  if (!ownerId) return Response.json({ error: "local sync authentication required" }, { status: 401 });
  const payload = await request.json().catch(() => null) as { items?: KnowledgeItem[] } | null;
  const items = Array.isArray(payload?.items) ? payload.items.slice(0, 12) : [];
  if (!items.length) return Response.json({ error: "items are required" }, { status: 400 });
  const apiKey = String((env as unknown as { DEEPSEEK_API_KEY?: string }).DEEPSEEK_API_KEY || "");
  if (!apiKey) return Response.json({ error: "DEEPSEEK_API_KEY is not configured" }, { status: 503 });

  const mirrored: Array<{ sourceLocalPath: string; cardId: string }> = [];
  for (const item of items) {
    const sourceLocalPath = text(item.sourceLocalPath, 1_000);
    const sourceContent = text(item.sourceContent, 180_000);
    const sourceTitle = text(item.sourceTitle, 280);
    const sourceUrl = text(item.sourceUrl, 2_000);
    const sourceName = text(item.sourceName, 280) || "本地 Wiki";
    const sourceCoverUrl = text(item.sourceCoverUrl, 700_000);
    const digest = item.digest;
    if (!sourceLocalPath || sourceContent.length < 900 || !sourceTitle || !digest) continue;
    const existingClip = await env.DB.prepare("SELECT id, processing_status AS processingStatus, mirror_version AS mirrorVersion FROM clips WHERE owner_id = ? AND local_path = ? LIMIT 1").bind(ownerId, sourceLocalPath).first<{ id: string; processingStatus: string; mirrorVersion: string }>();
    if (existingClip && !["captured", "maintaining", "mirrored"].includes(existingClip.processingStatus)) continue;
    const rawSourceId = existingClip?.id ?? crypto.randomUUID();
    if (existingClip) {
      await env.DB.prepare("UPDATE clips SET content = ?, source_url = ?, source_title = ?, publisher = ?, published_at = ?, verification_status = 'verified', processing_status = 'mirrored', raw_excerpt = ?, content_hash = ?, mirror_version = ?, mirror_updated_at = CURRENT_TIMESTAMP, processed_at = CURRENT_TIMESTAMP WHERE id = ? AND owner_id = ?")
        .bind(sourceContent, sourceUrl, sourceTitle, sourceName, text(item.publishedAt, 80), sourceContent.slice(0, 7_000), `local:${sourceLocalPath}:${sourceContent.length}`, String(sourceContent.length), rawSourceId, ownerId).run();
    } else {
      await env.DB.prepare("INSERT INTO clips (id, owner_id, content, source_url, source_title, status, origin, source_type, publisher, published_at, verification_status, processing_status, raw_excerpt, content_hash, priority, processed_at, local_path, mirror_version, mirror_updated_at) VALUES (?, ?, ?, ?, ?, 'mirrored', 'local_wiki', 'article', ?, ?, 'verified', 'mirrored', ?, ?, 100, CURRENT_TIMESTAMP, ?, ?, CURRENT_TIMESTAMP)")
        .bind(rawSourceId, ownerId, sourceContent, sourceUrl, sourceTitle, sourceName, text(item.publishedAt, 80), sourceContent.slice(0, 7_000), `local:${sourceLocalPath}:${sourceContent.length}`, sourceLocalPath, String(sourceContent.length)).run();
    }

    const digestPageId = await upsertPage(ownerId, rawSourceId, digest, "synthesis");
    for (const method of (Array.isArray(item.methods) ? item.methods.slice(0, 4) : [])) await upsertPage(ownerId, rawSourceId, method, "topic");
    if (!digestPageId) continue;
    const transferPrompt = text(digest.transferPrompt, 1_000);
    const cards = await env.DB.prepare("SELECT id, unit_key AS unitKey FROM knowledge_cards WHERE owner_id = ? AND raw_source_id = ? ORDER BY unit_key")
      .bind(ownerId, rawSourceId).all<{ id: string; unitKey: string }>();
    const unchanged = existingClip?.mirrorVersion === String(sourceContent.length) && (cards.results?.filter((card) => card.unitKey.startsWith("unit-")).length ?? 0) >= 3;
    if (unchanged) {
      mirrored.push({ sourceLocalPath, cardId: cards.results![0].id });
      continue;
    }
    const units = await compileKnowledgeUnits({ title: sourceTitle, url: sourceUrl, text: sourceContent }, { apiKey });
    const existingCards = cards.results ?? [];
    const activeKeys: string[] = [];
    for (const [index, unit] of units.entries()) {
      const unitKey = `unit-${index + 1}`;
      activeKeys.push(unitKey);
      const existing = existingCards.find((card) => card.unitKey === unitKey)
        ?? (index === 0 ? existingCards.find((card) => card.unitKey === "source") : undefined);
      const cardId = existing?.id ?? crypto.randomUUID();
      const tags = ["local-wiki", `creator:${sourceName}`, unit.topic, ...unit.subtopics].slice(0, 7);
      const values = [
        digestPageId, unit.title, unit.hook, unit.explanation, unit.reasoningMove, unit.boundary,
        unit.whyItMatters || transferPrompt, sourceCoverUrl, JSON.stringify(tags), topicFeatures(unit, sourceName),
        unitKey, sourceName, sourceUrl,
      ];
      if (existing) {
        await env.DB.prepare("UPDATE knowledge_cards SET wiki_page_id = ?, title = ?, hook = ?, explanation = ?, reasoning_move = ?, boundary = ?, why_it_matters = ?, cover_url = ?, tags = ?, topic_features = ?, unit_key = ?, source_name = ?, source_url = ?, verification_status = 'verified', state = 'published' WHERE id = ? AND owner_id = ?")
          .bind(...values, cardId, ownerId).run();
      } else {
        await env.DB.prepare("INSERT INTO knowledge_cards (id, owner_id, raw_source_id, wiki_page_id, title, hook, explanation, reasoning_move, boundary, why_it_matters, cover_url, tags, topic_features, unit_key, source_name, source_url, verification_status, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'verified', 'published')")
          .bind(cardId, ownerId, rawSourceId, ...values).run();
      }
      if (index === 0) mirrored.push({ sourceLocalPath, cardId });
    }
    const staleIds = existingCards.filter((card) => !activeKeys.includes(card.unitKey) && card.unitKey !== "source").map((card) => card.id);
    for (const staleId of staleIds) await env.DB.prepare("UPDATE knowledge_cards SET state = 'archived' WHERE id = ? AND owner_id = ?").bind(staleId, ownerId).run();
  }
  return Response.json({ mirrored });
}
