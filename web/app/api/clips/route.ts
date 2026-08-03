import { getDb } from "../../../db";
import { clips } from "../../../db/schema";
import { validateClipPayload } from "../../lib/validation.mjs";
import { requireApiUser } from "../auth";

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if ("error" in auth) return auth.error;
  const checked = validateClipPayload(await request.json().catch(() => null));
  if (checked.error) return Response.json({ error: checked.error }, { status: 400 });

  const [clip] = await getDb().insert(clips).values({
    id: crypto.randomUUID(),
    ownerId: auth.user.userId,
    ...checked.value,
  }).returning();
  return Response.json({ clip }, { status: 201 });
}
