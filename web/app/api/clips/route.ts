import { env } from "cloudflare:workers";
import { getDb } from "../../../db";
import { clips } from "../../../db/schema";
import { hashContent } from "../../lib/injection";
import { validateClipPayload } from "../../lib/validation.mjs";
import { requireApiUser } from "../auth";

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if ("error" in auth) return auth.error;
  const checked = validateClipPayload(await request.json().catch(() => null));
  if (checked.error) return Response.json({ error: checked.error }, { status: 400 });

  const sourceType = detectSourceType(checked.value.sourceUrl);
  const contentHash = await hashContent(`${checked.value.sourceUrl || "text"}:${checked.value.content}`);
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
    verificationStatus: "unknown",
    processingStatus: "queued",
    rawExcerpt: "",
    contentHash,
    priority: 10,
    processingError: "等待本机浏览器采集桥",
  }).returning();
  return Response.json({ clip }, { status: 201 });
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
