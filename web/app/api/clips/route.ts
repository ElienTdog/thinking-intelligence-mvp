import { env } from "cloudflare:workers";
import { getDb } from "../../../db";
import { clips } from "../../../db/schema";
import { compileQueuedSources, fetchPublicSourceExcerpt, hashContent } from "../../lib/injection";
import { validateClipPayload } from "../../lib/validation.mjs";
import { ensureWikiForCards } from "../../lib/wiki";
import { requireApiUser } from "../auth";

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if ("error" in auth) return auth.error;
  const checked = validateClipPayload(await request.json().catch(() => null));
  if (checked.error) return Response.json({ error: checked.error }, { status: 400 });

  const sourceType = detectSourceType(checked.value.sourceUrl);
  const copiedExcerpt = checked.value.content.replace(checked.value.sourceUrl, "").trim();
  const rawExcerpt = sourceType === "video"
    ? ""
    : copiedExcerpt.length >= 180
      ? copiedExcerpt.slice(0, 7_000)
      : checked.value.sourceUrl
        ? await fetchPublicSourceExcerpt(checked.value.sourceUrl)
        : checked.value.content;
  const verificationStatus = sourceType === "video"
    ? "needs_transcript"
    : rawExcerpt
      ? checked.value.sourceUrl ? "verified" : "unknown"
      : "unknown";
  const processingStatus = sourceType === "video"
    ? "skipped"
    : rawExcerpt
      ? "queued"
      : "skipped";
  const contentHash = await hashContent(`${checked.value.sourceUrl || "text"}:${rawExcerpt || checked.value.content}`);
  const duplicate = await env.DB.prepare(`
    SELECT id FROM clips
    WHERE owner_id = ? AND (content_hash = ? OR (source_url = ? AND source_url <> ''))
    LIMIT 1
  `).bind(auth.user.userId, contentHash, checked.value.sourceUrl).first<{ id: string }>();
  if (duplicate) return Response.json({ clip: duplicate, duplicate: true });

  const [clip] = await getDb().insert(clips).values({
    id: crypto.randomUUID(),
    ownerId: auth.user.userId,
    ...checked.value,
    origin: "user_capture",
    sourceType,
    publisher: publisherFromUrl(checked.value.sourceUrl),
    verificationStatus,
    processingStatus,
    rawExcerpt,
    contentHash,
    priority: 10,
    processingError: sourceType === "video"
      ? "视频需要可靠字幕或文字稿才会编译"
      : rawExcerpt ? "" : "未能取得足够可编译文本",
  }).returning();
  const cards = processingStatus === "queued"
    ? await compileQueuedSources(env.DB, auth.user.userId, {
      apiKey: env.DEEPSEEK_API_KEY,
      model: env.DEEPSEEK_MODEL,
    }, { sourceIds: [clip.id], limit: 1 })
    : [];
  if (cards.length) await ensureWikiForCards(env.DB, auth.user.userId);
  return Response.json({ clip, card: cards[0] ?? null }, { status: 201 });
}

function detectSourceType(sourceUrl: string) {
  if (!sourceUrl) return "text" as const;
  try {
    const host = new URL(sourceUrl).hostname.toLowerCase();
    return /(^|\.)(youtube\.com|youtu\.be|bilibili\.com|vimeo\.com)$/.test(host)
      ? "video" as const
      : "article" as const;
  } catch {
    return "text" as const;
  }
}

function publisherFromUrl(sourceUrl: string) {
  try {
    return new URL(sourceUrl).hostname.replace(/^www\./, "");
  } catch {
    return "主动收录";
  }
}
