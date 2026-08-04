import { env } from "cloudflare:workers";
import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { clips, dailyStories, judgmentDeltas, knowledgeCards, materials, questions } from "../../../db/schema";
import { chinaDate, ensureKnowledgeWorkspace } from "../../lib/knowledge-workspace";
import { ensureWikiForCards, getWikiSnapshot } from "../../lib/wiki";
import { requireApiUser } from "../auth";

export async function GET() {
  const auth = await requireApiUser();
  if ("error" in auth) return auth.error;

  const db = getDb();
  await ensureKnowledgeWorkspace(env.DB, auth.user.userId);
  await ensureWikiForCards(env.DB, auth.user.userId);
  const [questionRows, materialRows, deltaRows, clipRows] = await Promise.all([
    db.select().from(questions).where(eq(questions.ownerId, auth.user.userId)).orderBy(asc(questions.priority), desc(questions.createdAt)),
    db.select().from(materials).where(eq(materials.ownerId, auth.user.userId)).orderBy(desc(materials.createdAt)),
    db.select().from(judgmentDeltas).where(eq(judgmentDeltas.ownerId, auth.user.userId)).orderBy(desc(judgmentDeltas.createdAt)),
    db.select().from(clips).where(eq(clips.ownerId, auth.user.userId)).orderBy(desc(clips.createdAt)),
  ]);
  const [cardRows, storyRows] = await Promise.all([
    db.select().from(knowledgeCards)
      .where(and(eq(knowledgeCards.ownerId, auth.user.userId), eq(knowledgeCards.state, "published")))
      .orderBy(desc(knowledgeCards.createdAt)).limit(24),
    db.select().from(dailyStories)
      .where(and(eq(dailyStories.ownerId, auth.user.userId), eq(dailyStories.storyDate, chinaDate())))
      .orderBy(desc(dailyStories.createdAt)).limit(1),
  ]);
  const todayStory = storyRows[0] ?? null;
  const storyCards = todayStory
    ? await db.select().from(knowledgeCards)
      .where(and(eq(knowledgeCards.ownerId, auth.user.userId), eq(knowledgeCards.storyId, todayStory.id)))
      .orderBy(asc(knowledgeCards.storyPosition))
    : [];
  const wiki = await getWikiSnapshot(env.DB, auth.user.userId);
  return Response.json({
    questions: questionRows,
    materials: materialRows,
    deltas: deltaRows,
    clips: clipRows,
    cards: cardRows,
    todayStory,
    storyCards,
    wiki,
  });
}
