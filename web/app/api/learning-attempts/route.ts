import { env } from "cloudflare:workers";
import { recordLearningAttempt } from "../../lib/wiki";
import { validateLearningAttemptPayload } from "../../lib/validation.mjs";
import { requireApiUser } from "../auth";

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if ("error" in auth) return auth.error;
  const checked = validateLearningAttemptPayload(await request.json().catch(() => null));
  if (checked.error) return Response.json({ error: checked.error }, { status: 400 });

  const result = await recordLearningAttempt(env.DB, auth.user.userId, checked.value.pageId, checked.value.promptType, checked.value.response);
  if (!result) return Response.json({ error: "knowledge page not found" }, { status: 404 });
  return Response.json(result, { status: 201 });
}
