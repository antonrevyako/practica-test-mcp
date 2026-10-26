import {
  integer,
  index,
  foreignKey,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import type { Question } from "../shared/contracts.js";
import type { ParsedTest } from "../provider/parser.js";

export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(),
  url: text("url").notNull(),
  payload: text("payload", { mode: "json" })
    .$type<Omit<ParsedTest, "tracking">>()
    .notNull(),
  createdAt: text("created_at").notNull(),
  submittedAt: text("submitted_at"),
  syncState: text("sync_state", {
    enum: ["local", "sending", "submitted", "uncertain"],
  })
    .notNull()
    .default("local"),
});
export const answers = sqliteTable(
  "answers",
  {
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    questionId: text("question_id").notNull(),
    optionIds: text("option_ids", { mode: "json" }).$type<string[]>().notNull(),
    correct: integer("correct", { mode: "boolean" }).notNull(),
    answeredAt: text("answered_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.questionId] })],
);

export const recordedQuestions = sqliteTable(
  "recorded_questions",
  {
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    questionId: text("question_id").notNull(),
    questionKey: text("question_key").notNull(),
    language: text("language").$type<"en" | "es">().notNull(),
    permit: text("permit").notNull(),
    question: text("question", { mode: "json" }).$type<Question>().notNull(),
    correctOptionIds: text("correct_option_ids", { mode: "json" })
      .$type<string[]>()
      .notNull(),
    recordedAt: text("recorded_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.runId, t.questionId] }),
    index("recorded_questions_key_idx").on(t.questionKey),
    index("recorded_questions_language_permit_idx").on(t.language, t.permit),
  ],
);

export const answerEvents = sqliteTable(
  "answer_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: text("run_id").notNull(),
    questionId: text("question_id").notNull(),
    optionIds: text("option_ids", { mode: "json" }).$type<string[]>().notNull(),
    correct: integer("correct", { mode: "boolean" }).notNull(),
    answeredAt: text("answered_at").notNull(),
    origin: text("origin", { enum: ["live", "backfill"] }).notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.runId, t.questionId],
      foreignColumns: [recordedQuestions.runId, recordedQuestions.questionId],
    }).onDelete("cascade"),
    index("answer_events_question_idx").on(t.runId, t.questionId, t.id),
    index("answer_events_time_idx").on(t.answeredAt, t.id),
  ],
);
