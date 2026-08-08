import { env } from "cloudflare:workers";
import { ensureWikiForCards, getWikiLint } from "../../../lib/wiki";
import { requireApiUser } from "../../auth";

export async function GET() {
  const auth = await requireApiUser();
  if ("error" in auth) return auth.error;
  await ensureWikiForCards(env.DB, auth.user.userId);
  return Response.json(await getWikiLint(env.DB, auth.user.userId));
}
