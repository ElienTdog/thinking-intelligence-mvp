import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { dailyStories, knowledgeCards } from "../../../../db/schema";
import { chinaDate } from "../../../lib/knowledge-workspace";
import { requireApiUser } from "../../auth";

export async function GET() {
  const auth = await requireApiUser();
  if ("error" in auth) return auth.error;

  const db = getDb();
  const [story] = await db.select().from(dailyStories)
    .where(and(eq(dailyStories.ownerId, auth.user.userId), eq(dailyStories.storyDate, chinaDate())))
    .orderBy(desc(dailyStories.createdAt)).limit(1);
  if (!story) return Response.json({ story: null, cards: [] });
  const cards = await db.select().from(knowledgeCards)
    .where(and(eq(knowledgeCards.ownerId, auth.user.userId), eq(knowledgeCards.storyId, story.id)))
    .orderBy(asc(knowledgeCards.storyPosition));
  return Response.json({ story, cards });
}
