import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../src/db/database.js";
import { answers, runs } from "../src/db/schema.js";
import { parseTest } from "../src/provider/parser.js";
import { PracticaTest } from "../src/provider/practicatest.js";
import { StudyService } from "../src/server/study.service.js";
import { ImageCache } from "../src/archive/image-cache.js";
import { createMcp } from "../src/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { fixture, home } from "./fixtures.js";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
  "base64",
);
const storedImage = { mimeType: "image/png", data: png.toString("base64") };
function provider() {
  const imageRequests: string[] = [];
  const fetcher = (async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname;
    if (path === "/ajax/login") return new Response('{"success":true}');
    if (path.startsWith("/static/img/test/")) {
      imageRequests.push(path);
      return new Response(png);
    }
    return new Response(path.endsWith("/online") ? fixture : home);
  }) as typeof fetch;
  return { remote: new PracticaTest(fetcher), imageRequests };
}

async function signIn(study: StudyService) {
  await study.login(
    "archive-fixture@example.invalid",
    "archive-fixture-password",
  );
}

test("archive persists questions, changed choices, correct options and images across restart and logout", async () => {
  const directory = await mkdtemp(join(tmpdir(), "practica-archive-"));
  const database = join(directory, "test.sqlite");
  let store = new Store(database);
  const first = provider();
  let study = new StudyService(store, first.remote);
  try {
    await signIn(study);
    const run = await study.start(
      "https://practicatest.com/tests/permiso-B/online",
    );
    const unanswered = study.statistics.questions({ runId: run.id });
    assert.equal(unanswered.total, 2);
    assert(
      unanswered.items.every(
        (item) => item.correctOptionIds === null && item.lastAnswer === null,
      ),
    );
    study.answer(run.id, "q1", ["A"]);
    study.answer(run.id, "q1", ["C"]);
    study.answer(run.id, "q1", ["C"]);
    study.answer(run.id, "q2", ["A"]);
    study.answer(run.id, "q2", ["B", "A", "A"]);
    study.answer(run.id, "q2", ["A", "B"]);
    await study.images.idle();
    assert.equal(first.imageRequests.length, 1);
    const summary = study.statistics.summary();
    assert.equal(summary.attempts, 1);
    assert.equal(summary.questionAppearances, 2);
    assert.equal(summary.answeredQuestions, 2);
    assert.equal(summary.answerEvents, 4);
    assert.equal(summary.accuracyPercent, 100);
    assert.equal(summary.firstAnswerAccuracyPercent, 0);
    assert.equal(summary.images.images, 1);
    const saved = study.statistics.questions({ search: "correcta" }).items[0];
    assert.deepEqual(saved.lastAnswer?.optionIds, ["C"]);
    assert.deepEqual(saved.correctOptionIds, ["C"]);
    assert.equal(saved.question.options[2].text, "La opción correcta");
    assert(saved.image?.cached);
    assert(saved.image.filename);
    assert.deepEqual(
      await readFile(join(directory, "images", saved.image.filename)),
      png,
    );
    if (process.platform !== "win32")
      assert.equal(
        (await stat(join(directory, "images", saved.image.filename))).mode &
          0o777,
        0o600,
      );
    assert.equal(
      study.statistics.questions({ search: "' OR 1=1 --" }).total,
      0,
    );
    assert.equal(study.statistics.questions({ language: "en" }).total, 0);
    assert.equal(study.statistics.answerHistory({ correct: false }).total, 2);
    assert.equal(
      study.statistics.answerHistory({ questionKey: saved.questionKey }).total,
      2,
    );
    assert.equal(
      study.statistics.answerHistory({ limit: 1, offset: 1 }).items.length,
      1,
    );
    assert.equal(
      study.statistics.answerHistory({ from: "2099-01-01T00:00:00.000Z" })
        .total,
      0,
    );
    const bytes = store.sqlite.serialize().toString("utf8");
    for (const secret of [
      "archive-fixture@example.invalid",
      "archive-fixture-password",
      "memory-only-tracking",
      "fixture-csrf",
    ])
      assert(!bytes.includes(secret));
    await study.logout();
    assert.equal(study.statistics.summary().answerEvents, 4);
    assert.deepEqual(
      await study.statistics.questionImage(run.id, "q1"),
      storedImage,
    );
    await study.onApplicationShutdown();
    store.close();

    store = new Store(database);
    const second = provider();
    study = new StudyService(store, second.remote);
    assert.equal(study.status().authenticated, false);
    assert.equal(study.statistics.summary().answerEvents, 4);
    assert.equal(study.statistics.summary().accuracyPercent, 100);
    assert.deepEqual(
      await study.statistics.questionImage(run.id, "q1"),
      storedImage,
    );
    assert.equal(second.imageRequests.length, 0);

    const server = createMcp(study);
    const client = new Client({ name: "archive-test", version: "1" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const names = (await client.listTools()).tools.map((tool) => tool.name);
      for (const tool of [
        "get_statistics",
        "list_recorded_questions",
        "get_answer_history",
        "get_recorded_question_image",
        "cache_recorded_images",
      ])
        assert(names.includes(tool));
      const stats = await client.callTool({
        name: "get_statistics",
        arguments: { language: "es" },
      });
      assert(!stats.isError);
      assert.equal(
        JSON.parse((stats.content as { text: string }[])[0].text).answerEvents,
        4,
      );
      const history = await client.callTool({
        name: "get_answer_history",
        arguments: { runId: run.id, correct: false, limit: 1 },
      });
      const data = JSON.parse((history.content as { text: string }[])[0].text);
      assert.equal(data.total, 2);
      assert.equal(data.items[0].answer.correct, false);
      assert(data.items[0].question.options.length);
      assert(data.items[0].correctOptionIds.length);
      const image = await client.callTool({
        name: "get_recorded_question_image",
        arguments: { runId: run.id, questionId: "q1" },
      });
      assert(!image.isError);
      assert.equal((image.content as { type: string }[])[0].type, "image");
    } finally {
      await client.close();
      await server.close();
    }

    await signIn(study);
    await study.images.idle();
    assert.equal(second.imageRequests.length, 0);
    await study.clear();
    assert.equal(study.statistics.summary().answerEvents, 0);
    assert.equal(study.statistics.questions().total, 0);
    assert.equal(study.images.summary().images, 0);
  } finally {
    await study.onApplicationShutdown();
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("older saved attempts backfill once and question identity survives shuffled options", async () => {
  const store = new Store(":memory:");
  const { remote } = provider();
  const { tracking, ...original } = parseTest(fixture);
  const shuffled = structuredClone(original);
  const old = original.questions[0];
  shuffled.questions[0].options = [
    { id: "A", text: old.options[2].text },
    { id: "B", text: old.options[0].text },
    { id: "C", text: old.options[1].text },
  ];
  shuffled.questions[0].correctOptionIds = ["A"];
  const ids = [randomUUID(), randomUUID()];
  for (let index = 0; index < ids.length; index++) {
    store.db
      .insert(runs)
      .values({
        id: ids[index],
        url: "https://practicatest.com/tests/permiso-B/online",
        payload: index ? shuffled : original,
        createdAt: "2026-01-01T00:00:00.000Z",
        syncState: "local",
      })
      .run();
    store.db
      .insert(answers)
      .values({
        runId: ids[index],
        questionId: "q1",
        optionIds: [index ? "A" : "C"],
        correct: true,
        answeredAt: "2026-01-02T00:00:00.000Z",
      })
      .run();
  }
  const first = new StudyService(store, remote);
  const second = new StudyService(store, remote);
  try {
    assert.equal(first.statistics.summary().answerEvents, 2);
    assert.equal(second.statistics.summary().answerEvents, 2);
    assert.equal(second.statistics.summary().uniqueQuestions, 2);
    const left = second.statistics
      .questions({ runId: ids[0] })
      .items.find((item) => item.questionId === "q1")!;
    const right = second.statistics
      .questions({ runId: ids[1] })
      .items.find((item) => item.questionId === "q1")!;
    assert.equal(left.questionKey, right.questionKey);
    assert.deepEqual(left.correctOptionIds, ["C"]);
    assert.deepEqual(right.correctOptionIds, ["A"]);
    assert(
      second.statistics
        .answerHistory()
        .items.every((event) => event.origin === "backfill"),
    );
    assert.equal(
      second.statistics.summary({ from: "2026-01-02T00:00:00.000Z" })
        .questionAppearances,
      0,
    );
    assert.equal(
      second.statistics.summary({ from: "2026-01-02T00:00:00.000Z" })
        .answerEvents,
      2,
    );
  } finally {
    await first.onApplicationShutdown();
    await second.onApplicationShutdown();
    store.close();
  }
});

test("image downloads are deduplicated, bounded, reusable offline and retryable after failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "practica-images-"));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let active = 0,
    maxActive = 0,
    calls = 0;
  const cache = new ImageCache(directory, async () => {
    calls++;
    active++;
    maxActive = Math.max(maxActive, active);
    await gate;
    active--;
    return storedImage;
  });
  const urls = Array.from(
    { length: 5 },
    (_, index) => `https://practicatest.com/static/img/test/ES/B/${index}.png`,
  );
  try {
    for (const url of urls) {
      cache.enqueue(url);
      cache.enqueue(url);
    }
    assert.equal(calls, 2);
    assert.equal(cache.summary().pending, 5);
    release();
    await cache.idle();
    assert.equal(calls, 5);
    assert.equal(maxActive, 2);
    assert.equal(cache.summary().images, 5);
    assert.deepEqual(await cache.get(urls[0]), storedImage);
    assert.equal(calls, 5);
    const offline = new ImageCache(directory, async () => {
      throw new Error("Network must not be used.");
    });
    assert.deepEqual(await offline.get(urls[0]), storedImage);
    await offline.close();
    assert.throws(() =>
      cache.status("https://example.invalid/static/img/test/a.png"),
    );
    assert.throws(() => cache.status("https://practicatest.com/account"));
    assert.doesNotThrow(() =>
      cache.enqueue("https://practicatest.com/account"),
    );
    assert.equal(cache.summary().failed, 1);
    let failing = true;
    const retry = new ImageCache(null, async () => {
      if (failing) throw new Error("Temporary failure.");
      return storedImage;
    });
    retry.enqueue(urls[0]);
    await retry.idle();
    assert.equal(retry.status(urls[0]).status, "error");
    failing = false;
    assert.deepEqual(await retry.get(urls[0]), storedImage);
    assert.equal(retry.summary().failed, 0);
    await retry.close();
  } finally {
    release();
    await cache.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("clearing an active image cache cancels downloads and cannot restore deleted files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "practica-image-cancel-"));
  const cache = new ImageCache(
    directory,
    async (_url, signal) =>
      new Promise((_, reject) =>
        signal.addEventListener(
          "abort",
          () => reject(new Error("Cancelled.")),
          { once: true },
        ),
      ),
  );
  try {
    for (let index = 0; index < 4; index++)
      cache.enqueue(`https://practicatest.com/static/img/test/${index}.png`);
    await cache.clear();
    assert.deepEqual(cache.summary(), {
      images: 0,
      bytes: 0,
      pending: 0,
      failed: 0,
    });
  } finally {
    await cache.close();
    await rm(directory, { recursive: true, force: true });
  }
});
