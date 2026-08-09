import { env } from "cloudflare:workers";
import { requireSyncOwner } from "../auth";

type MirrorItem = {
  id?: unknown;
  sourceUrl?: unknown;
  sourceTitle?: unknown;
  content?: unknown;
  rawExcerpt?: unknown;
  publisher?: unknown;
  publishedAt?: unknown;
  verificationStatus?: unknown;
  processingStatus?: unknown;
  processingError?: unknown;
  localPath?: unknown;
  mirrorVersion?: unknown;
};

const text = (value: unknown, limit: number) => typeof value === "string" ? value.trim().slice(0, limit) : "";

export async function POST(request: Request) {
  const ownerId = await requireSyncOwner(request);
  if (!ownerId) return Response.json({ error: "local sync authentication required" }, { status: 401 });
  const payload = await request.json().catch(() => null) as { items?: MirrorItem[] } | null;
  const items = Array.isArray(payload?.items) ? payload.items.slice(0, 20) : [];
  if (!items.length) return Response.json({ error: "items are required" }, { status: 400 });

  const mirrored: Array<{ id: string; processingStatus: string }> = [];
  const allowedStatuses = new Set(["queued", "loading", "captured", "maintaining", "mirrored", "needs_user_open", "failed"]);
  for (const item of items) {
    const id = text(item.id, 100);
    const sourceUrl = text(item.sourceUrl, 2_000);
    const content = text(item.content, 180_000);
    const sourceTitle = text(item.sourceTitle, 280) || sourceUrl || "未命名来源";
    const processingStatus = text(item.processingStatus, 40);
    if (!allowedStatuses.has(processingStatus)) {
      return Response.json({ error: `invalid processing status: ${processingStatus || "empty"}` }, { status: 400 });
    }
    const verificationStatus = ["verified", "official_link", "needs_transcript", "unknown"].includes(text(item.verificationStatus, 40))
      ? text(item.verificationStatus, 40)
      : "unknown";
    if (!sourceUrl && !content) continue;

    const existing = id
      ? await env.DB.prepare("SELECT id FROM clips WHERE id = ? AND owner_id = ? LIMIT 1").bind(id, ownerId).first<{ id: string }>()
      : await env.DB.prepare("SELECT id FROM clips WHERE owner_id = ? AND source_url = ? AND source_url <> '' LIMIT 1").bind(ownerId, sourceUrl).first<{ id: string }>();
    const clipId = existing?.id ?? crypto.randomUUID();
    const values = [
      content,
      text(item.rawExcerpt, 7_000),
      sourceUrl,
      sourceTitle,
      text(item.publisher, 280),
      text(item.publishedAt, 80),
      verificationStatus,
      processingStatus,
      text(item.processingError, 1_000),
      text(item.localPath, 1_000),
      text(item.mirrorVersion, 120),
    ];
    if (existing) {
      await env.DB.prepare(`UPDATE clips SET content = ?, raw_excerpt = ?, source_url = ?, source_title = ?, publisher = ?, published_at = ?, verification_status = ?, processing_status = ?, processing_error = ?, local_path = ?, mirror_version = ?, mirror_updated_at = CURRENT_TIMESTAMP, processed_at = CURRENT_TIMESTAMP WHERE id = ? AND owner_id = ?`)
        .bind(...values, clipId, ownerId).run();
    } else {
      await env.DB.prepare(`INSERT INTO clips (id, owner_id, content, source_url, source_title, status, origin, source_type, publisher, published_at, verification_status, processing_status, raw_excerpt, content_hash, priority, processing_error, processed_at, local_path, mirror_version, mirror_updated_at) VALUES (?, ?, ?, ?, ?, 'mirrored', 'local_wiki', 'article', ?, ?, ?, ?, ?, ?, 10, ?, CURRENT_TIMESTAMP, ?, ?, CURRENT_TIMESTAMP)`)
        .bind(
          clipId,
          ownerId,
          content,
          sourceUrl,
          sourceTitle,
          text(item.publisher, 280),
          text(item.publishedAt, 80),
          verificationStatus,
          processingStatus,
          text(item.rawExcerpt, 7_000),
          `${sourceUrl}:${text(item.mirrorVersion, 120)}`,
          text(item.processingError, 1_000),
          text(item.localPath, 1_000),
          text(item.mirrorVersion, 120),
        ).run();
    }
    mirrored.push({ id: clipId, processingStatus });
  }
  return Response.json({ mirrored });
}
