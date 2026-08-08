import { and, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { feedEvents, knowledgeCards } from "../../../db/schema";
import { validateFeedEventPayload } from "../../lib/validation.mjs";
import { requireApiUser } from "../auth";

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if ("error" in auth) return auth.error;
  const checked = validateFeedEventPayload(await request.json().catch(() => null));
  if (checked.error) return Response.json({ error: checked.error }, { status: 400 });

  const db = getDb();
  const [card] = await db.select({ id: knowledgeCards.id }).from(knowledgeCards)
    .where(and(eq(knowledgeCards.id, checked.value.cardId), eq(knowledgeCards.ownerId, auth.user.userId))).limit(1);
  if (!card) return Response.json({ error: "knowledge card not found" }, { status: 404 });

  await db.insert(feedEvents).values({
    id: crypto.randomUUID(),
    ownerId: auth.user.userId,
    cardId: card.id,
    eventType: checked.value.eventType,
  });
  return Response.json({ ok: true }, { status: 201 });
}
