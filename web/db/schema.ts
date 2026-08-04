import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const questions = sqliteTable(
  "questions",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    title: text("title").notNull(),
    initialJudgment: text("initial_judgment").notNull(),
    priority: integer("priority").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_questions_owner_priority").on(table.ownerId, table.priority)],
);

export const materials = sqliteTable(
  "materials",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    questionId: text("question_id").notNull().references(() => questions.id),
    type: text("type").notNull(),
    title: text("title").notNull(),
    challenge: text("challenge").notNull(),
    relevance: text("relevance").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_materials_owner_question").on(table.ownerId, table.questionId)],
);

export const clips = sqliteTable(
  "clips",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    content: text("content").notNull(),
    sourceUrl: text("source_url").notNull().default(""),
    sourceTitle: text("source_title").notNull().default(""),
    status: text("status").notNull().default("captured"),
    origin: text("origin").notNull().default("legacy"),
    sourceType: text("source_type").notNull().default("text"),
    publisher: text("publisher").notNull().default(""),
    publishedAt: text("published_at").notNull().default(""),
    verificationStatus: text("verification_status").notNull().default("unknown"),
    processingStatus: text("processing_status").notNull().default("legacy"),
    rawExcerpt: text("raw_excerpt").notNull().default(""),
    contentHash: text("content_hash").notNull().default(""),
    priority: integer("priority").notNull().default(0),
    processingError: text("processing_error").notNull().default(""),
    processedAt: text("processed_at").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_clips_owner_created").on(table.ownerId, table.createdAt),
    index("idx_clips_owner_processing").on(table.ownerId, table.processingStatus, table.priority),
    index("idx_clips_owner_hash").on(table.ownerId, table.contentHash),
  ],
);

export const sourceFeeds = sqliteTable(
  "source_feeds",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    name: text("name").notNull(),
    url: text("url").notNull(),
    feedType: text("feed_type").notNull(),
    topic: text("topic").notNull().default("AI 与产品"),
    trustLevel: integer("trust_level").notNull().default(2),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_source_feeds_owner_enabled").on(table.ownerId, table.enabled),
    index("idx_source_feeds_owner_url").on(table.ownerId, table.url),
  ],
);

export const dailyStories = sqliteTable(
  "daily_stories",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    storyDate: text("story_date").notNull(),
    title: text("title").notNull(),
    openingQuestion: text("opening_question").notNull(),
    takeaway: text("takeaway").notNull(),
    status: text("status").notNull().default("published"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_stories_owner_date").on(table.ownerId, table.storyDate)],
);

export const knowledgeCards = sqliteTable(
  "knowledge_cards",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    rawSourceId: text("raw_source_id").notNull().references(() => clips.id),
    storyId: text("story_id").references(() => dailyStories.id),
    storyPosition: integer("story_position").notNull().default(0),
    title: text("title").notNull(),
    hook: text("hook").notNull(),
    explanation: text("explanation").notNull(),
    reasoningMove: text("reasoning_move").notNull(),
    boundary: text("boundary").notNull(),
    whyItMatters: text("why_it_matters").notNull(),
    tags: text("tags").notNull().default("[]"),
    sourceName: text("source_name").notNull(),
    sourceUrl: text("source_url").notNull(),
    verificationStatus: text("verification_status").notNull().default("verified"),
    state: text("state").notNull().default("published"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_cards_owner_created").on(table.ownerId, table.createdAt),
    index("idx_cards_owner_story").on(table.ownerId, table.storyId, table.storyPosition),
    index("idx_cards_owner_raw").on(table.ownerId, table.rawSourceId),
  ],
);

export const feedEvents = sqliteTable(
  "feed_events",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    cardId: text("card_id").notNull().references(() => knowledgeCards.id),
    eventType: text("event_type").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_feed_events_owner_card").on(table.ownerId, table.cardId, table.createdAt)],
);

export const injectionRuns = sqliteTable(
  "injection_runs",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    runDate: text("run_date").notNull(),
    status: text("status").notNull(),
    sourcesScanned: integer("sources_scanned").notNull().default(0),
    rawCreated: integer("raw_created").notNull().default(0),
    cardsCreated: integer("cards_created").notNull().default(0),
    error: text("error").notNull().default(""),
    startedAt: text("started_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    completedAt: text("completed_at").notNull().default(""),
  },
  (table) => [index("idx_injection_runs_owner_date").on(table.ownerId, table.runDate)],
);

export const judgmentDeltas = sqliteTable(
  "judgment_deltas",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    questionId: text("question_id").notNull().references(() => questions.id),
    materialId: text("material_id").notNull().references(() => materials.id),
    responseType: text("response_type").notNull(),
    responseText: text("response_text").notNull(),
    validationScenario: text("validation_scenario").notNull().default(""),
    status: text("status").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_deltas_owner_question_created").on(table.ownerId, table.questionId, table.createdAt)],
);
