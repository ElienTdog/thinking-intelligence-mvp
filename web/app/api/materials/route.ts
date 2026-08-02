import { and, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { materials, questions } from "../../../db/schema";
import { validateMaterialPayload } from "../../lib/validation.mjs";
import { requireApiUser } from "../auth";

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if ("error" in auth) return auth.error;
  const checked = validateMaterialPayload(await request.json().catch(() => null));
  if (checked.error) return Response.json({ error: checked.error }, { status: 400 });

  const [question] = await getDb().select({ id: questions.id }).from(questions)
    .where(and(eq(questions.id, checked.value.questionId), eq(questions.ownerId, auth.user.userId))).limit(1);
  if (!question) return Response.json({ error: "question not found" }, { status: 404 });

  const [material] = await getDb().insert(materials).values({
    id: crypto.randomUUID(), ownerId: auth.user.userId, ...checked.value,
  }).returning();
  return Response.json({ material }, { status: 201 });
}
