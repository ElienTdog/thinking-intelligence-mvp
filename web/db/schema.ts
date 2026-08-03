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
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_clips_owner_created").on(table.ownerId, table.createdAt)],
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
