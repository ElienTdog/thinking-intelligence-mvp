import { env } from "cloudflare:workers";
import { queryWiki } from "../../../lib/wiki";
import { validateWikiQueryPayload } from "../../../lib/validation.mjs";
import { requireApiUser } from "../../auth";

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if ("error" in auth) return auth.error;
  const checked = validateWikiQueryPayload(await request.json().catch(() => null));
  if (checked.error) return Response.json({ error: checked.error }, { status: 400 });
  if (!env.DEEPSEEK_API_KEY) return Response.json({ error: "尚未配置 DEEPSEEK_API_KEY，无法查询 Wiki" }, { status: 503 });

  const result = await queryWiki(env.DB, auth.user.userId, checked.value.question, {
    apiKey: env.DEEPSEEK_API_KEY,
    model: env.DEEPSEEK_MODEL,
  }).catch((error) => ({ error: error instanceof Error ? error.message : "Wiki 查询失败" }));
  if (!result || "error" in result) return Response.json({ error: result?.error ?? "Wiki 里还没有可回答的问题的知识页" }, { status: 422 });
  return Response.json(result, { status: 201 });
}
