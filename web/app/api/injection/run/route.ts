import { env } from "cloudflare:workers";
import { runInjectionForOwner } from "../../../lib/injection";
import { requireApiUser } from "../../auth";

export async function POST() {
  const auth = await requireApiUser();
  if ("error" in auth) return auth.error;
  if (!env.DEEPSEEK_API_KEY) {
    return Response.json({ error: "尚未配置 DEEPSEEK_API_KEY，无法生成今日知识流" }, { status: 503 });
  }
  const result = await runInjectionForOwner(env.DB, auth.user.userId, {
    apiKey: env.DEEPSEEK_API_KEY,
    model: env.DEEPSEEK_MODEL,
  }, true);
  if (result.status === "failed") return Response.json(result, { status: 502 });
  return Response.json(result);
}
