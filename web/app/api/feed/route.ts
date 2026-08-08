import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { feedEvents, knowledgeCards } from "../../../db/schema";
import { rankKnowledgeCards } from "../../lib/validation.mjs";
import { requireApiUser } from "../auth";

const MAX_PAGE_SIZE = 12;
const MAX_CANDIDATES = 120;

export async function GET(request: Request) {
  const auth = await requireApiUser();
  if ("error" in auth) return auth.error;

  const url = new URL(request.url);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(url.searchParams.get("limit")) || 8));
  const cursor = Math.max(0, Number(url.searchParams.get("cursor")) || 0);
  const db = getDb();
  const [cards, events] = await Promise.all([
    db.select().from(knowledgeCards)
      .where(and(eq(knowledgeCards.ownerId, auth.user.userId), eq(knowledgeCards.state, "published")))
      .orderBy(desc(knowledgeCards.createdAt)).limit(MAX_CANDIDATES),
    db.select().from(feedEvents).where(eq(feedEvents.ownerId, auth.user.userId)).orderBy(desc(feedEvents.createdAt)).limit(800),
  ]);
  const ranked = rankKnowledgeCards(cards, events);
  const page = ranked.slice(cursor, cursor + limit);
  const nextCursor = cursor + page.length < ranked.length ? String(cursor + page.length) : null;
  return Response.json({ cards: page, nextCursor });
}
