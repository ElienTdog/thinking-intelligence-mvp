import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { feedEvents, feedImpressions, knowledgeCards, recommendationModels } from "../../../db/schema";
import { POLICY_VERSION, trainTopicPolicy } from "../../lib/recommendation-policy.mjs";
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
  const [impression] = await db.select().from(feedImpressions)
    .where(and(
      eq(feedImpressions.ownerId, auth.user.userId),
      eq(feedImpressions.cardId, card.id),
      eq(feedImpressions.wasShown, true),
    ))
    .orderBy(desc(feedImpressions.createdAt))
    .limit(1);
  if (impression) {
    const [cards, model] = await Promise.all([
      db.select().from(knowledgeCards).where(and(eq(knowledgeCards.ownerId, auth.user.userId), eq(knowledgeCards.state, "published"))),
      db.select().from(recommendationModels).where(eq(recommendationModels.ownerId, auth.user.userId)).limit(1),
    ]);
    const modelJson = await trainTopicPolicy(cards, model[0]?.modelJson || "", [{
      sessionId: impression.sessionId,
      topic: impression.topic,
      selectionProbability: impression.selectionProbability,
      wasShown: impression.wasShown,
      eventType: checked.value.eventType,
    }]);
    await db.insert(recommendationModels).values({
      ownerId: auth.user.userId,
      policyVersion: POLICY_VERSION,
      modelJson,
    }).onConflictDoUpdate({
      target: recommendationModels.ownerId,
      set: { policyVersion: POLICY_VERSION, modelJson, updatedAt: new Date().toISOString() },
    });
  }
  return Response.json({ ok: true }, { status: 201 });
}
