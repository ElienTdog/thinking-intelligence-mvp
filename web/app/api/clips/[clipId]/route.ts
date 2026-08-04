import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../../db";
import { clips, dailyStories, feedEvents, knowledgeCards } from "../../../../db/schema";
import { requireApiUser } from "../../auth";

export async function DELETE(_request: Request, context: { params: Promise<{ clipId: string }> }) {
  const auth = await requireApiUser();
  if ("error" in auth) return auth.error;
  const { clipId } = await context.params;
  const db = getDb();
  const [clip] = await db.select({ id: clips.id }).from(clips)
    .where(and(eq(clips.id, clipId), eq(clips.ownerId, auth.user.userId))).limit(1);
  if (!clip) return Response.json({ error: "raw source not found" }, { status: 404 });

  const cardRows = await db.select({ id: knowledgeCards.id, storyId: knowledgeCards.storyId }).from(knowledgeCards)
    .where(and(eq(knowledgeCards.rawSourceId, clip.id), eq(knowledgeCards.ownerId, auth.user.userId)));
  const cardIds = cardRows.map((card) => card.id);
  if (cardIds.length) {
    await db.delete(feedEvents).where(and(eq(feedEvents.ownerId, auth.user.userId), inArray(feedEvents.cardId, cardIds)));
    await db.delete(knowledgeCards).where(and(eq(knowledgeCards.rawSourceId, clip.id), eq(knowledgeCards.ownerId, auth.user.userId)));
  }
  await db.delete(clips).where(and(eq(clips.id, clip.id), eq(clips.ownerId, auth.user.userId)));

  const storyIds = [...new Set(cardRows.map((card) => card.storyId).filter((id): id is string => Boolean(id)))];
  for (const storyId of storyIds) {
    const [remainingCard] = await db.select({ id: knowledgeCards.id }).from(knowledgeCards)
      .where(and(eq(knowledgeCards.storyId, storyId), eq(knowledgeCards.ownerId, auth.user.userId))).limit(1);
    if (!remainingCard) {
      await db.delete(dailyStories).where(and(eq(dailyStories.id, storyId), eq(dailyStories.ownerId, auth.user.userId)));
    }
  }
  return Response.json({ ok: true, cardsRemoved: cardIds.length });
}
