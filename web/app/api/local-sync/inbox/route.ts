import { env } from "cloudflare:workers";
import { requireSyncOwner } from "../auth";

export async function GET(request: Request) {
  const ownerId = await requireSyncOwner(request);
  if (!ownerId) return Response.json({ error: "local sync authentication required" }, { status: 401 });

  const result = await env.DB.prepare(`
    SELECT id, content, source_url AS sourceUrl, source_title AS sourceTitle,
      publisher, published_at AS publishedAt, verification_status AS verificationStatus,
      processing_status AS processingStatus, processing_error AS processingError, created_at AS createdAt
    FROM clips
    WHERE owner_id = ? AND processing_status IN ('inbox', 'needs_clipper', 'queued', 'loading', 'captured', 'maintaining', 'needs_user_open', 'failed')
    ORDER BY created_at ASC
    LIMIT 40
  `).bind(ownerId).all();
  return Response.json({ items: result.results ?? [] });
}
