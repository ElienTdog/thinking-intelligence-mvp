import { env } from "cloudflare:workers";
import { requireApiUser } from "../../auth";

export async function GET() {
  const auth = await requireApiUser();
  if ("error" in auth) return auth.error;
  const ownerId = auth.user.userId;
  const [token, counts] = await Promise.all([
    env.DB.prepare("SELECT last_used_at AS lastUsedAt FROM wiki_sync_tokens WHERE owner_id = ? ORDER BY created_at DESC LIMIT 1").bind(ownerId).first<{ lastUsedAt: string }>(),
    env.DB.prepare("SELECT SUM(CASE WHEN processing_status = 'inbox' THEN 1 ELSE 0 END) AS inbox, SUM(CASE WHEN processing_status = 'needs_clipper' THEN 1 ELSE 0 END) AS needsClipper, SUM(CASE WHEN origin = 'local_wiki' AND processing_status = 'mirrored' THEN 1 ELSE 0 END) AS mirrored FROM clips WHERE owner_id = ?").bind(ownerId).first<{ inbox: number | null; needsClipper: number | null; mirrored: number | null }>(),
  ]);
  return Response.json({
    connected: Boolean(token?.lastUsedAt),
    lastUsedAt: token?.lastUsedAt || "",
    inbox: counts?.inbox ?? 0,
    needsClipper: counts?.needsClipper ?? 0,
    mirrored: counts?.mirrored ?? 0,
  });
}
