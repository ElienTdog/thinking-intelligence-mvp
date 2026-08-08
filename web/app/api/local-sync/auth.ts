import { env } from "cloudflare:workers";

export async function hashSyncToken(token: string) {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function requireSyncOwner(request: Request): Promise<string | null> {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) return null;

  const tokenHash = await hashSyncToken(token);
  const record = await env.DB.prepare("SELECT owner_id AS ownerId FROM wiki_sync_tokens WHERE token_hash = ? LIMIT 1")
    .bind(tokenHash)
    .first<{ ownerId: string }>();
  if (!record?.ownerId) return null;

  await env.DB.prepare("UPDATE wiki_sync_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE token_hash = ?")
    .bind(tokenHash)
    .run();
  return record.ownerId;
}
