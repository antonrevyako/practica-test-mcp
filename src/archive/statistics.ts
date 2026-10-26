import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Store } from "../db/database.js";
import { recordedQuestions, runs } from "../db/schema.js";
import { publicQuestion, type ParsedTest } from "../provider/parser.js";
import type { Question } from "../shared/contracts.js";
import { AppError } from "../server/errors.js";
import { ImageCache } from "./image-cache.js";

export type StatisticsFilters = {
  permit?: string;
  language?: "en" | "es";
  runId?: string;
  questionKey?: string;
  from?: string;
  to?: string;
  search?: string;
  mistakesOnly?: boolean;
  limit?: number;
  offset?: number;
};
type Snapshot = {
  run_id: string;
  question_id: string;
  question_key: string;
  language: "en" | "es";
  permit: string;
  question: string;
  correct_option_ids: string;
  recorded_at: string;
  test_title: string;
  source_url: string;
  selected_option_ids: string | null;
  selected_correct: number | null;
  latest_answered_at: string | null;
};

export class Statistics {
  constructor(
    private readonly store: Store,
    private readonly images: ImageCache,
  ) {
    this.backfill();
  }
  recordAttempt(
    runId: string,
    parsed: Omit<ParsedTest, "tracking">,
    recordedAt: string,
  ) {
    const language = parsed.meta.lang === "en" ? "en" : "es";
    const permit = parsed.meta.permiso_c.replace("_EN", "");
    for (const item of parsed.questions) {
      const question = publicQuestion(item);
      // Option letters and order can change between exams; identify the underlying question by its content.
      const questionKey = createHash("sha256")
        .update(
          JSON.stringify([
            language,
            permit,
            question.text,
            question.imageUrl,
            question.multiple,
            question.options.map((option) => option.text).sort(),
          ]),
        )
        .digest("hex");
      this.store.db
        .insert(recordedQuestions)
        .values({
          runId,
          questionId: item.id,
          questionKey,
          language,
          permit,
          question,
          correctOptionIds: item.correctOptionIds,
          recordedAt,
        })
        .onConflictDoNothing()
        .run();
    }
  }
  private backfill() {
    this.store.db.transaction(() => {
      const missing = this.store.sqlite
        .prepare(
          `SELECT r.id FROM runs r WHERE NOT EXISTS (SELECT 1 FROM recorded_questions q WHERE q.run_id = r.id)`,
        )
        .all() as { id: string }[];
      for (const { id } of missing) {
        const run = this.store.db
          .select()
          .from(runs)
          .where(eq(runs.id, id))
          .get()!;
        this.recordAttempt(run.id, run.payload, run.createdAt);
      }
      this.store.sqlite
        .prepare(
          `INSERT INTO answer_events (run_id, question_id, option_ids, correct, answered_at, origin)
        SELECT a.run_id, a.question_id, a.option_ids, a.correct, a.answered_at, 'backfill' FROM answers a
        WHERE NOT EXISTS (SELECT 1 FROM answer_events e WHERE e.run_id = a.run_id AND e.question_id = a.question_id)`,
        )
        .run();
    });
  }
  imageUrls() {
    return (
      this.store.sqlite
        .prepare(
          `SELECT DISTINCT json_extract(question, '$.imageUrl') AS url FROM recorded_questions WHERE json_extract(question, '$.imageUrl') IS NOT NULL`,
        )
        .all() as { url: string }[]
    ).map((row) => row.url);
  }
  private filter(input: StatisticsFilters, dateColumn = "q.recorded_at") {
    const clauses: string[] = [];
    const values: (string | number)[] = [];
    for (const [column, value] of [
      ["q.permit", input.permit],
      ["q.language", input.language],
      ["q.run_id", input.runId],
      ["q.question_key", input.questionKey],
    ] as const) {
      if (value !== undefined) {
        clauses.push(`${column} = ?`);
        values.push(value);
      }
    }
    if (input.from) {
      clauses.push(`${dateColumn} >= ?`);
      values.push(input.from);
    }
    if (input.to) {
      clauses.push(`${dateColumn} <= ?`);
      values.push(input.to);
    }
    if (input.search) {
      clauses.push(
        "instr(lower(json_extract(q.question, '$.text')), lower(?)) > 0",
      );
      values.push(input.search);
    }
    if (input.mistakesOnly) clauses.push("a.correct = 0");
    return {
      sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
      values,
    };
  }
  private join = `FROM recorded_questions q JOIN runs r ON r.id = q.run_id LEFT JOIN answers a ON a.run_id = q.run_id AND a.question_id = q.question_id`;
  private snapshot(row: Snapshot) {
    const question = JSON.parse(row.question) as Question;
    const answered = row.selected_option_ids !== null;
    return {
      runId: row.run_id,
      questionId: row.question_id,
      questionKey: row.question_key,
      language: row.language,
      permit: row.permit,
      recordedAt: row.recorded_at,
      testTitle: row.test_title,
      sourceUrl: row.source_url,
      question,
      lastAnswer: answered
        ? {
            optionIds: JSON.parse(row.selected_option_ids!),
            correct: Boolean(row.selected_correct),
            answeredAt: row.latest_answered_at,
          }
        : null,
      correctOptionIds: answered
        ? (JSON.parse(row.correct_option_ids) as string[])
        : null,
      image: question.imageUrl ? this.imageStatus(question.imageUrl) : null,
    };
  }
  private imageStatus(url: string) {
    try {
      return this.images.status(url);
    } catch {
      return {
        key: null,
        cached: false,
        status: "unsupported",
        mimeType: null,
        bytes: 0,
        filename: null,
      };
    }
  }
  questions(input: StatisticsFilters = {}) {
    const { sql, values } = this.filter(input);
    const limit = input.limit ?? 20,
      offset = input.offset ?? 0;
    const { total } = this.store.sqlite
      .prepare(`SELECT COUNT(*) AS total ${this.join} ${sql}`)
      .get(...values) as { total: number };
    const rows = this.store.sqlite
      .prepare(
        `SELECT q.*, json_extract(r.payload, '$.title') AS test_title, r.url AS source_url, a.option_ids AS selected_option_ids, a.correct AS selected_correct, a.answered_at AS latest_answered_at ${this.join} ${sql} ORDER BY q.recorded_at DESC, q.run_id, json_extract(q.question, '$.number') LIMIT ? OFFSET ?`,
      )
      .all(...values, limit, offset) as Snapshot[];
    return {
      total,
      limit,
      offset,
      items: rows.map((row) => this.snapshot(row)),
    };
  }
  answerHistory(input: StatisticsFilters & { correct?: boolean } = {}) {
    const filter = this.filter(
      { ...input, mistakesOnly: false },
      "e.answered_at",
    );
    const extra =
      input.correct !== undefined
        ? `${filter.sql ? " AND" : "WHERE"} e.correct = ?`
        : "";
    const values = [
      ...filter.values,
      ...(input.correct !== undefined ? [Number(input.correct)] : []),
    ];
    const join = `FROM answer_events e JOIN recorded_questions q ON q.run_id = e.run_id AND q.question_id = e.question_id JOIN runs r ON r.id = q.run_id`;
    const { total } = this.store.sqlite
      .prepare(`SELECT COUNT(*) AS total ${join} ${filter.sql} ${extra}`)
      .get(...values) as { total: number };
    const limit = input.limit ?? 20,
      offset = input.offset ?? 0;
    const rows = this.store.sqlite
      .prepare(
        `SELECT q.*, json_extract(r.payload, '$.title') AS test_title, r.url AS source_url, e.id AS event_id, e.option_ids AS selected_option_ids, e.correct AS selected_correct, e.answered_at AS latest_answered_at, e.origin ${join} ${filter.sql} ${extra} ORDER BY e.id DESC LIMIT ? OFFSET ?`,
      )
      .all(...values, limit, offset) as (Snapshot & {
      event_id: number;
      origin: string;
    })[];
    return {
      total,
      limit,
      offset,
      items: rows.map((row) => {
        const { lastAnswer, ...snapshot } = this.snapshot(row);
        return {
          eventId: row.event_id,
          origin: row.origin,
          ...snapshot,
          answer: lastAnswer,
        };
      }),
    };
  }
  summary(input: StatisticsFilters = {}) {
    const { sql, values } = this.filter(input);
    const counts = this.store.sqlite
      .prepare(
        `SELECT COUNT(DISTINCT q.run_id) AS attempts, COUNT(*) AS questionAppearances, COUNT(DISTINCT q.question_key) AS uniqueQuestions, COUNT(a.question_id) AS answeredQuestions, COALESCE(SUM(a.correct), 0) AS correctAnswers ${this.join} ${sql}`,
      )
      .get(...values) as {
      attempts: number;
      questionAppearances: number;
      uniqueQuestions: number;
      answeredQuestions: number;
      correctAnswers: number;
    };
    const groups = this.store.sqlite
      .prepare(
        `SELECT q.language, q.permit, COUNT(*) AS questionAppearances, COUNT(a.question_id) AS answeredQuestions, COALESCE(SUM(a.correct), 0) AS correctAnswers ${this.join} ${sql} GROUP BY q.language, q.permit ORDER BY q.language, q.permit`,
      )
      .all(...values) as {
      language: string;
      permit: string;
      answeredQuestions: number;
      correctAnswers: number;
    }[];
    const events = this.filter(
      { ...input, mistakesOnly: false },
      "e.answered_at",
    );
    const eventCounts = this.store.sqlite
      .prepare(
        `SELECT COUNT(*) AS answerEvents, COALESCE(SUM(CASE WHEN e.id = (SELECT MIN(first.id) FROM answer_events first WHERE first.run_id = e.run_id AND first.question_id = e.question_id) THEN 1 ELSE 0 END), 0) AS firstAnswers, COALESCE(SUM(CASE WHEN e.correct = 1 AND e.id = (SELECT MIN(first.id) FROM answer_events first WHERE first.run_id = e.run_id AND first.question_id = e.question_id) THEN 1 ELSE 0 END), 0) AS firstCorrectAnswers FROM answer_events e JOIN recorded_questions q ON q.run_id = e.run_id AND q.question_id = e.question_id ${events.sql}`,
      )
      .get(...events.values) as {
      answerEvents: number;
      firstAnswers: number;
      firstCorrectAnswers: number;
    };
    const accuracy = (correct: number, total: number) =>
      total ? Math.round((correct / total) * 10000) / 100 : null;
    return {
      ...counts,
      incorrectAnswers: counts.answeredQuestions - counts.correctAnswers,
      accuracyPercent: accuracy(
        counts.correctAnswers,
        counts.answeredQuestions,
      ),
      ...eventCounts,
      firstAnswerAccuracyPercent: accuracy(
        eventCounts.firstCorrectAnswers,
        eventCounts.firstAnswers,
      ),
      groups: groups.map((group) => ({
        ...group,
        accuracyPercent: accuracy(
          group.correctAnswers,
          group.answeredQuestions,
        ),
      })),
      images: this.images.summary(),
      notes:
        "Question counts and latest-answer accuracy use recorded-at dates. Answer-event counts use answered-at dates. Repeating the same choice does not add an event. Historical imports contain only the last choice previously saved. Correct option IDs are hidden for unanswered questions.",
    };
  }
  async questionImage(runId: string, questionId: string) {
    const row = this.store.db
      .select()
      .from(recordedQuestions)
      .where(
        and(
          eq(recordedQuestions.runId, runId),
          eq(recordedQuestions.questionId, questionId),
        ),
      )
      .get();
    if (!row)
      throw new AppError(
        404,
        "QUESTION_NOT_FOUND",
        "Recorded question not found.",
      );
    if (!row.question.imageUrl) return null;
    const image = await this.images.cached(row.question.imageUrl);
    if (!image)
      throw new AppError(
        404,
        "IMAGE_NOT_CACHED",
        "This illustration is not saved yet. Sign in and call cache_recorded_images to retry its download.",
      );
    return image;
  }
}
