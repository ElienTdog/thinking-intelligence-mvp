import { and, eq, inArray, or } from "drizzle-orm";
import { getDb } from "../../../../db";
import { clips, dailyStories, feedEvents, feedImpressions, knowledgeCards, learningAttempts, wikiActivity, wikiLinks, wikiPageSources, wikiPages } from "../../../../db/schema";
import { requireApiUser } from "../../auth";

export async function PATCH(_request: Request, context: { params: Promise<{ clipId: string }> }) {
  const auth = await requireApiUser();
  if ("error" in auth) return auth.error;
  const { clipId } = await context.params;
  const result = await getDb().update(clips)
    .set({ processingStatus: "queued", processingError: "等待本机浏览器重新采集", processedAt: "" })
    .where(and(eq(clips.id, clipId), eq(clips.ownerId, auth.user.userId), inArray(clips.processingStatus, ["needs_user_open", "needs_clipper", "failed"])))
    .returning({ id: clips.id, processingStatus: clips.processingStatus });
  if (!result.length) return Response.json({ error: "source is not retryable" }, { status: 409 });
  return Response.json({ clip: result[0] });
}

export async function DELETE(_request: Request, context: { params: Promise<{ clipId: string }> }) {
  const auth = await requireApiUser();
  if ("error" in auth) return auth.error;
  const { clipId } = await context.params;
  const db = getDb();
  const [clip] = await db.select({ id: clips.id }).from(clips)
    .where(and(eq(clips.id, clipId), eq(clips.ownerId, auth.user.userId))).limit(1);
  if (!clip) return Response.json({ error: "raw source not found" }, { status: 404 });

  const cardRows = await db.select({ id: knowledgeCards.id, storyId: knowledgeCards.storyId, wikiPageId: knowledgeCards.wikiPageId }).from(knowledgeCards)
    .where(and(eq(knowledgeCards.rawSourceId, clip.id), eq(knowledgeCards.ownerId, auth.user.userId)));
  const cardIds = cardRows.map((card) => card.id);
  const pageIds = cardRows.map((card) => card.wikiPageId).filter((id): id is string => Boolean(id));
  if (cardIds.length) {
    await db.delete(feedImpressions).where(and(eq(feedImpressions.ownerId, auth.user.userId), inArray(feedImpressions.cardId, cardIds)));
    await db.delete(feedEvents).where(and(eq(feedEvents.ownerId, auth.user.userId), inArray(feedEvents.cardId, cardIds)));
    await db.delete(knowledgeCards).where(and(eq(knowledgeCards.rawSourceId, clip.id), eq(knowledgeCards.ownerId, auth.user.userId)));
  }
  if (pageIds.length) {
    await db.delete(learningAttempts).where(and(eq(learningAttempts.ownerId, auth.user.userId), inArray(learningAttempts.pageId, pageIds)));
    await db.delete(wikiActivity).where(and(eq(wikiActivity.ownerId, auth.user.userId), inArray(wikiActivity.pageId, pageIds)));
    await db.delete(wikiLinks).where(and(eq(wikiLinks.ownerId, auth.user.userId), or(inArray(wikiLinks.fromPageId, pageIds), inArray(wikiLinks.toPageId, pageIds))));
    await db.delete(wikiPageSources).where(and(eq(wikiPageSources.ownerId, auth.user.userId), or(inArray(wikiPageSources.pageId, pageIds), eq(wikiPageSources.rawSourceId, clip.id))));
    await db.delete(wikiPages).where(and(eq(wikiPages.ownerId, auth.user.userId), inArray(wikiPages.id, pageIds)));
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
