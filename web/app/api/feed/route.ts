import { and, desc, eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../../../db";
import { feedEvents, feedImpressions, knowledgeCards, recommendationModels } from "../../../db/schema";
import { buildImpressionRows, POLICY_VERSION, recommendTopicSlate } from "../../lib/recommendation-policy.mjs";
import { rankKnowledgeCards } from "../../lib/validation.mjs";
import { requireApiUser } from "../auth";

const MAX_PAGE_SIZE = 12;
const MAX_CANDIDATES = 120;
const SHADOW_SIZE = 20;

function recommenderMode(preview: string | null) {
  if (preview === "bandit") return "BANDIT";
  const value = String((env as unknown as { RECOMMENDER_MODE?: string }).RECOMMENDER_MODE || "SHADOW").toUpperCase();
  return value === "LEGACY" || value === "BANDIT" ? value : "SHADOW";
}

export async function GET(request: Request) {
  const auth = await requireApiUser();
  if ("error" in auth) return auth.error;

  const url = new URL(request.url);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(url.searchParams.get("limit")) || 8));
  const cursor = Math.max(0, Number(url.searchParams.get("cursor")) || 0);
  const db = getDb();
  const [cards, events, model] = await Promise.all([
    db.select().from(knowledgeCards)
      .where(and(eq(knowledgeCards.ownerId, auth.user.userId), eq(knowledgeCards.state, "published")))
      .orderBy(desc(knowledgeCards.createdAt)).limit(MAX_CANDIDATES),
    db.select().from(feedEvents).where(eq(feedEvents.ownerId, auth.user.userId)).orderBy(desc(feedEvents.createdAt)).limit(800),
    db.select().from(recommendationModels).where(eq(recommendationModels.ownerId, auth.user.userId)).limit(1),
  ]);
  const legacy = rankKnowledgeCards(cards, events);
  const seed = `${auth.user.userId}:${new Date().toISOString().slice(0, 10)}`;
  const bandit = recommendTopicSlate(cards, model[0]?.modelJson || "", { size: SHADOW_SIZE, seed, events });
  const mode = recommenderMode(url.searchParams.get("preview"));
  const ranked = mode === "BANDIT" ? bandit.items.map((item) => item.card) : legacy;
  const page = ranked.slice(cursor, cursor + limit);
  const nextCursor = cursor + page.length < ranked.length ? String(cursor + page.length) : null;
  const sessionId = crypto.randomUUID();
  const reasons = new Map(bandit.items.map((item) => [item.card.id, item.reason]));

  if (!model.length) {
    await db.insert(recommendationModels).values({
      ownerId: auth.user.userId,
      policyVersion: POLICY_VERSION,
      modelJson: bandit.modelJson,
    }).onConflictDoNothing();
  }
  const impressions = buildImpressionRows(page, bandit.items, {
    sessionId,
    mode,
    cursor,
    rankedLength: ranked.length,
    shadowPolicy: "bandit-shadow",
  });
  for (const impression of impressions) {
    await db.insert(feedImpressions).values({
      id: crypto.randomUUID(),
      ownerId: auth.user.userId,
      ...impression,
    });
  }
  return Response.json({
    cards: page.map((card) => ({ ...card, recommendationReason: reasons.get(card.id) || "来自当前知识库的自然混排。" })),
    nextCursor,
  });
}
