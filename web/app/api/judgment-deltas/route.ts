import { and, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { judgmentDeltas, materials } from "../../../db/schema";
import { canWriteDelta, validateDeltaPayload } from "../../lib/validation.mjs";
import { requireApiUser } from "../auth";

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if ("error" in auth) return auth.error;
  const checked = validateDeltaPayload(await request.json().catch(() => null));
  if (checked.error) return Response.json({ error: checked.error }, { status: 400 });

  const [material] = await getDb().select().from(materials)
    .where(and(eq(materials.id, checked.value.materialId), eq(materials.ownerId, auth.user.userId))).limit(1);
  if (!canWriteDelta(material, checked.value.questionId, auth.user.userId)) {
    return Response.json({ error: "material does not belong to this question" }, { status: 404 });
  }

  const [delta] = await getDb().insert(judgmentDeltas).values({
    id: crypto.randomUUID(),
    ownerId: auth.user.userId,
    ...checked.value,
    status: checked.value.responseType === "validate_in_context" ? "needs_validation" : "response_recorded",
  }).returning();
  return Response.json({ delta }, { status: 201 });
}
