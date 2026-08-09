import { env } from "cloudflare:workers";
import { requireApiUser } from "../../auth";

export async function GET() {
  const auth = await requireApiUser();
  if ("error" in auth) return auth.error;
  const ownerId = auth.user.userId;
  const [token, counts] = await Promise.all([
    env.DB.prepare("SELECT last_used_at AS lastUsedAt FROM wiki_sync_tokens WHERE owner_id = ? ORDER BY created_at DESC LIMIT 1").bind(ownerId).first<{ lastUsedAt: string }>(),
    env.DB.prepare("SELECT SUM(CASE WHEN processing_status IN ('inbox', 'queued') THEN 1 ELSE 0 END) AS queued, SUM(CASE WHEN processing_status = 'loading' THEN 1 ELSE 0 END) AS loading, SUM(CASE WHEN processing_status = 'captured' THEN 1 ELSE 0 END) AS captured, SUM(CASE WHEN processing_status = 'maintaining' THEN 1 ELSE 0 END) AS maintaining, SUM(CASE WHEN processing_status IN ('needs_clipper', 'needs_user_open') THEN 1 ELSE 0 END) AS needsUserOpen, SUM(CASE WHEN processing_status = 'failed' THEN 1 ELSE 0 END) AS failed, SUM(CASE WHEN processing_status = 'mirrored' THEN 1 ELSE 0 END) AS mirrored FROM clips WHERE owner_id = ?").bind(ownerId).first<{ queued: number | null; loading: number | null; captured: number | null; maintaining: number | null; needsUserOpen: number | null; failed: number | null; mirrored: number | null }>(),
  ]);
  return Response.json({
    connected: Boolean(token?.lastUsedAt),
    lastUsedAt: token?.lastUsedAt || "",
    queued: counts?.queued ?? 0,
    loading: counts?.loading ?? 0,
    captured: counts?.captured ?? 0,
    maintaining: counts?.maintaining ?? 0,
    needsUserOpen: counts?.needsUserOpen ?? 0,
    failed: counts?.failed ?? 0,
    mirrored: counts?.mirrored ?? 0,
  });
}
