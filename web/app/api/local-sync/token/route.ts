import { env } from "cloudflare:workers";
import { getDb } from "../../../../db";
import { wikiSyncTokens } from "../../../../db/schema";
import { requireApiUser } from "../../auth";
import { hashSyncToken } from "../auth";

export async function POST() {
  const auth = await requireApiUser();
  if ("error" in auth) return auth.error;

  const token = `wiki_${crypto.randomUUID().replace(/-/g, "")}`;
  const tokenHash = await hashSyncToken(token);
  await env.DB.prepare("DELETE FROM wiki_sync_tokens WHERE owner_id = ?").bind(auth.user.userId).run();
  await getDb().insert(wikiSyncTokens).values({
    id: crypto.randomUUID(),
    ownerId: auth.user.userId,
    tokenHash,
  });
  return Response.json({ token });
}
