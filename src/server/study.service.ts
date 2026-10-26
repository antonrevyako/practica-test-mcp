import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { desc, eq, and } from "drizzle-orm";
import { Store } from "../db/database.js";
import { answerEvents, answers, runs } from "../db/schema.js";
import { PracticaTest } from "../provider/practicatest.js";
import { publicQuestion, type ParsedTest } from "../provider/parser.js";
import type { AnswerFeedback, Permit, TestView } from "../shared/contracts.js";
import { AppError } from "./errors.js";
import { ImageCache } from "../archive/image-cache.js";
import { Statistics } from "../archive/statistics.js";

@Injectable()
export class StudyService {
  private queue: Promise<unknown> = Promise.resolve();
  readonly images: ImageCache;
  readonly statistics: Statistics;
  constructor(
    @Inject(Store) private readonly store: Store,
    @Inject(PracticaTest) readonly provider: PracticaTest,
  ) {
    this.images = new ImageCache(store.imageDirectory, (url, signal) =>
      provider.image(url, signal),
    );
    this.statistics = new Statistics(store, this.images);
    if (provider.status().authenticated) this.cacheRecordedImages();
  }
  async onApplicationShutdown() {
    await this.images.close();
  }
  cacheRecordedImages() {
    this.provider.requireSession();
    const urls = this.statistics.imageUrls();
    for (const url of urls) this.images.enqueue(url);
    return { illustrations: urls.length, ...this.images.summary() };
  }
  // Keep the single remote cookie session consistent across concurrent UI/MCP calls.
  exclusive<T>(action: () => Promise<T>): Promise<T> {
    const result = this.queue.then(action, action);
    this.queue = result.catch(() => undefined);
    return result;
  }
  status() {
    return this.provider.status();
  }
  login(email: string, password: string) {
    return this.exclusive(async () => {
      const session = await this.provider.login(email, password);
      this.cacheRecordedImages();
      return session;
    });
  }
  logout() {
    return this.exclusive(async () => {
      this.provider.logout();
      return this.status();
    });
  }
  list(
    permit: Permit,
    url?: string,
    language: "en" | "es" = "en",
    sectionId?: string,
  ) {
    return this.exclusive(() =>
      this.provider.list(permit, url, language, sectionId),
    );
  }
  sections(permit: Permit, language: "en" | "es") {
    return this.exclusive(() => this.provider.sections(permit, language));
  }
  rules(
    permit: Permit,
    language: "en" | "es",
    sectionId: string,
    mode: "summary" | "full",
  ) {
    return this.exclusive(() =>
      this.provider.rules(permit, language, sectionId, mode),
    );
  }
  startSelection(input: {
    url?: string;
    sectionId?: string;
    permit: Permit;
    language: "en" | "es";
  }) {
    if (Boolean(input.url) === Boolean(input.sectionId))
      throw new AppError(
        400,
        "INVALID_SELECTION",
        "Provide exactly one of url or sectionId.",
      );
    if (input.url) return this.start(input.url);
    return this.exclusive(async () => {
      const [link] = await this.provider.list(
        input.permit,
        undefined,
        input.language,
        input.sectionId,
      );
      return this.saveAttempt(await this.provider.start(link.url), link.url);
    });
  }
  private saveAttempt(parsed: ParsedTest, url: string) {
    const id = randomUUID();
    const { tracking, ...payload } = parsed;
    const createdAt = new Date().toISOString();
    this.store.db.transaction(() => {
      this.store.db
        .insert(runs)
        .values({ id, url, payload, createdAt, syncState: "local" })
        .run();
      this.statistics.recordAttempt(id, payload, createdAt);
    });
    this.provider.remember(id, tracking);
    for (const question of parsed.questions)
      if (question.imageUrl) this.images.enqueue(question.imageUrl);
    return this.get(id);
  }
  async start(url: string) {
    return this.exclusive(async () => {
      return this.saveAttempt(await this.provider.start(url), url);
    });
  }
  private row(id: string) {
    const row = this.store.db.select().from(runs).where(eq(runs.id, id)).get();
    if (!row) throw new AppError(404, "TEST_NOT_FOUND", "Test not found.");
    return row;
  }
  get(id: string): TestView {
    this.provider.requireSession();
    const row = this.row(id);
    const selected = this.store.db
      .select()
      .from(answers)
      .where(eq(answers.runId, id))
      .all();
    return {
      id,
      title: row.payload.title,
      url: row.url,
      language: row.payload.meta.lang === "en" ? "en" : "es",
      permit: row.payload.meta.permiso_c.replace("_EN", ""),
      createdAt: row.createdAt,
      submittedAt: row.submittedAt,
      syncState: row.syncState,
      questions: row.payload.questions.map(publicQuestion),
      answers: selected.map((a) => ({
        questionId: a.questionId,
        optionIds: a.optionIds,
        correct: a.correct,
        correctOptionIds: row.payload.questions.find(
          (q) => q.id === a.questionId,
        )!.correctOptionIds,
      })),
    };
  }
  history() {
    this.provider.requireSession();
    return this.store.db
      .select()
      .from(runs)
      .orderBy(desc(runs.createdAt))
      .limit(30)
      .all()
      .map((row) => {
        const selected = this.store.db
          .select()
          .from(answers)
          .where(eq(answers.runId, row.id))
          .all();
        return {
          id: row.id,
          title: row.payload.title,
          total: row.payload.questions.length,
          answered: selected.length,
          correct: selected.filter((a) => a.correct).length,
          createdAt: row.createdAt,
          syncState: row.syncState,
        };
      });
  }
  next(id: string) {
    const test = this.get(id);
    const done = new Set(test.answers.map((a) => a.questionId));
    return {
      runId: id,
      answered: done.size,
      total: test.questions.length,
      question: test.questions.find((q) => !done.has(q.id)) ?? null,
    };
  }
  async image(id: string, questionId: string) {
    const question = this.get(id).questions.find(
      (question) => question.id === questionId,
    );
    if (!question)
      throw new AppError(
        404,
        "QUESTION_NOT_FOUND",
        "Question not found in this test.",
      );
    return question.imageUrl ? this.images.get(question.imageUrl) : null;
  }
  answer(id: string, questionId: string, optionIds: string[]): AnswerFeedback {
    this.provider.requireSession();
    const row = this.row(id);
    if (row.syncState !== "local")
      throw new AppError(
        409,
        "TEST_LOCKED",
        "This test is already submitted or awaiting submission status verification.",
      );
    const q = row.payload.questions.find((q) => q.id === questionId);
    if (!q)
      throw new AppError(
        404,
        "QUESTION_NOT_FOUND",
        "Question not found in this test.",
      );
    const unique = [...new Set(optionIds)].sort();
    if (
      !unique.length ||
      unique.some((id) => !q.options.some((o) => o.id === id)) ||
      (!q.multiple && unique.length !== 1)
    )
      throw new AppError(
        400,
        "INVALID_ANSWER",
        "Choose a valid answer option.",
      );
    const correct =
      unique.length === q.correctOptionIds.length &&
      unique.every((id) => q.correctOptionIds.includes(id));
    const previous = this.store.db
      .select()
      .from(answers)
      .where(and(eq(answers.runId, id), eq(answers.questionId, questionId)))
      .get();
    if (
      !previous ||
      JSON.stringify(previous.optionIds) !== JSON.stringify(unique)
    ) {
      const answeredAt = new Date().toISOString();
      this.store.db.transaction(() => {
        this.store.db
          .insert(answers)
          .values({
            runId: id,
            questionId,
            optionIds: unique,
            correct,
            answeredAt,
          })
          .onConflictDoUpdate({
            target: [answers.runId, answers.questionId],
            set: { optionIds: unique, correct, answeredAt },
          })
          .run();
        this.store.db
          .insert(answerEvents)
          .values({
            runId: id,
            questionId,
            optionIds: unique,
            correct,
            answeredAt,
            origin: "live",
          })
          .run();
      });
    }
    const test = this.get(id);
    const answered = new Set(test.answers.map((answer) => answer.questionId));
    return {
      questionId,
      optionIds: unique,
      correct,
      correctOptionIds: q.correctOptionIds,
      progress: {
        answered: answered.size,
        total: test.questions.length,
        correct: test.answers.filter((answer) => answer.correct).length,
      },
      nextQuestion:
        test.questions.find((question) => !answered.has(question.id)) ?? null,
    };
  }
  explanation(id: string, questionId: string) {
    return this.exclusive(async () => {
      this.provider.requireSession();
      const row = this.row(id);
      if (
        !this.store.db
          .select()
          .from(answers)
          .where(and(eq(answers.runId, id), eq(answers.questionId, questionId)))
          .get()
      )
        throw new AppError(409, "ANSWER_FIRST", "Answer the question first.");
      return {
        text: await this.provider.explanation(
          { ...row.payload, tracking: "" },
          questionId,
        ),
      };
    });
  }
  finish(id: string) {
    return this.exclusive(async () => {
      this.provider.requireSession();
      const row = this.row(id);
      if (row.syncState === "submitted")
        return { accepted: true, test: this.get(id) };
      if (row.syncState !== "local")
        throw new AppError(
          409,
          "SUBMISSION_UNCERTAIN",
          "Submission status is unknown. Check the result on PracticaTest; automatic retries are disabled.",
        );
      const selected = this.store.db
        .select()
        .from(answers)
        .where(eq(answers.runId, id))
        .all();
      if (selected.length !== row.payload.questions.length)
        throw new AppError(
          409,
          "INCOMPLETE_TEST",
          "Answer all questions before submitting.",
        );
      this.store.db
        .update(runs)
        .set({ syncState: "sending" })
        .where(eq(runs.id, id))
        .run();
      try {
        const minutes = Math.max(
          0,
          Math.floor((Date.now() - Date.parse(row.createdAt)) / 60000),
        );
        await this.provider.finish(
          id,
          { ...row.payload, tracking: "" } as ParsedTest,
          new Map(selected.map((a) => [a.questionId, a.optionIds])),
          minutes,
        );
        this.store.db
          .update(runs)
          .set({
            syncState: "submitted",
            submittedAt: new Date().toISOString(),
          })
          .where(eq(runs.id, id))
          .run();
        return { accepted: true, test: this.get(id) };
      } catch (error) {
        this.store.db
          .update(runs)
          .set({ syncState: "uncertain" })
          .where(eq(runs.id, id))
          .run();
        throw error;
      }
    });
  }
  async clear() {
    this.provider.requireSession();
    if (
      this.store.db
        .select()
        .from(runs)
        .where(eq(runs.syncState, "sending"))
        .get()
    )
      throw new AppError(409, "BUSY", "Wait for the submission to finish.");
    this.store.db.delete(runs).run();
    await this.images.clear();
    return { cleared: true };
  }
}
