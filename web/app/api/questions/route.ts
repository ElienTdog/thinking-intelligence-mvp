import { getDb } from "../../../db";
import { questions } from "../../../db/schema";
import { validateQuestionPayload } from "../../lib/validation.mjs";
import { requireApiUser } from "../auth";

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if ("error" in auth) return auth.error;
  const checked = validateQuestionPayload(await request.json().catch(() => null));
  if (checked.error) return Response.json({ error: checked.error }, { status: 400 });

  const [question] = await getDb().insert(questions).values({
    id: crypto.randomUUID(),
    ownerId: auth.user.userId,
    ...checked.value,
  }).returning();
  return Response.json({ question }, { status: 201 });
}
