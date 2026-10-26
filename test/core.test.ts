import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseTest,
  parseLinks,
  publicQuestion,
  siteUrl,
  testUrl,
} from "../src/provider/parser.js";
import { PracticaTest } from "../src/provider/practicatest.js";
import { Store } from "../src/db/database.js";
import { StudyService } from "../src/server/study.service.js";
import { localGuard } from "../src/server/security.js";
import { createMcp } from "../src/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { fixture, home, manualFixture, rulesFixture } from "./fixtures.js";
import {
  manualUrl,
  parseRules,
  parseSections,
} from "../src/provider/manual.js";

function remote() {
  const calls: {
    path: string;
    body: URLSearchParams;
    cookie: string | null;
    csrf: string | null;
  }[] = [];
  let failFinish = false;
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const headers = new Headers(init?.headers);
    calls.push({
      path,
      body: new URLSearchParams(String(init?.body ?? "")),
      cookie: headers.get("cookie"),
      csrf: headers.get("x-csrf-token"),
    });
    if (path === "/ajax/login")
      return new Response('{"success":true}', {
        headers: {
          "Set-Cookie": "session=fixture-session; Path=/; Secure; HttpOnly",
        },
      });
    if (path === "/ajax/correccion") {
      if (failFinish) throw new Error("network");
      return new Response('{"success":true}');
    }
    if (path === "/ajax/dudas-permiso")
      return new Response("<p>Explicación útil.</p><script>bad()</script>");
    if (path === "/en/book-theory-driving-test")
      return new Response(manualFixture);
    if (path.startsWith("/en/book-theory-driving-test/"))
      return new Response(rulesFixture);
    if (path.startsWith("/static/img/test/"))
      return new Response(
        new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]),
      );
    if (path === "/en/spanish-driving-test/online")
      return new Response(
        fixture
          .replace('var lang = "es"', 'var lang = "en"')
          .replace('var permiso_c = "B"', 'var permiso_c = "B_EN"'),
      );
    if (path.endsWith("/online")) return new Response(fixture);
    return new Response(
      `${home}<a href="/tests/permiso-B/online">Examen de hoy</a><a href="https://evil.invalid/tests/a/b">Bad</a>`,
    );
  }) as typeof fetch;
  return {
    provider: new PracticaTest(fetcher),
    calls,
    fail: () => {
      failFinish = true;
    },
  };
}
async function setup() {
  const r = remote();
  const store = new Store(":memory:");
  const study = new StudyService(store, r.provider);
  await study.login("fixture@example.invalid", "dummy-test-password");
  return { ...r, store, study };
}

test("parser maps shuffled choices and multiple answers without leaking the key", () => {
  const test = parseTest(fixture);
  assert.equal(test.questions.length, 2);
  assert.deepEqual(test.questions[0].correctOptionIds, ["C"]);
  assert.deepEqual(test.questions[1].correctOptionIds, ["A", "B"]);
  assert.equal(test.questions[1].multiple, true);
  assert.equal(test.questions[0].text, "¿Qué opción es correcta?");
  assert.equal(
    test.questions[0].imageUrl,
    "https://practicatest.com/static/img/test/ES/B/example.webp",
  );
  const json = JSON.stringify(publicQuestion(test.questions[0]));
  assert(!json.includes("correctOptionIds"));
  assert(!json.includes("0005250811"));
  assert(!json.includes("code-one"));
  assert.equal(test.tracking, "memory-only-tracking");
});
test("parser fails clearly on inaccessible tests and changed markup", () => {
  assert.throws(() => parseTest(home), /No accessible test/);
  assert.throws(
    () => parseTest(fixture.replace("0005250820", "changed")),
    /format/,
  );
});
test("manual sections preserve access restrictions and extract rules, tables and images", () => {
  const sections = parseSections(
    manualFixture,
    "https://practicatest.com/en/book-theory-driving-test",
    "B",
    "en",
  );
  assert.equal(sections.length, 2);
  assert.equal(sections[0].id, "13");
  assert.equal(sections[0].title, "Speed");
  assert.equal(
    sections[0].fullUrl,
    "https://practicatest.com/en/book-theory-driving-test/speed/13/full",
  );
  assert.equal(sections[1].testUrl, null);
  assert.equal(sections[1].fullUrl, null);
  assert.throws(() => manualUrl("https://practicatest.com/en/register"));
  const rules = parseRules(
    rulesFixture,
    sections[0],
    sections[0].summaryUrl,
    "summary",
  );
  assert(rules.text.includes("Adapt your speed to visibility."));
  for (const unwanted of [
    "untrusted()",
    "Unrelated navigation",
    "Unrelated footer",
    "hidden",
  ])
    assert(!rules.text.includes(unwanted));
  assert.deepEqual(rules.headings, ["1. Safe speed"]);
  assert.equal(rules.tables[0][1][1], "Illustrative only");
  assert.equal(rules.images[0].alt, "Example speed chart");
});
test("section selection retrieves rules and topic exams without falling back to general tests", async () => {
  const { study, store } = await setup();
  try {
    assert.equal((await study.sections("B", "en")).length, 2);
    assert.equal(
      (await study.rules("B", "en", "13", "summary")).mode,
      "summary",
    );
    assert.equal((await study.rules("B", "en", "13", "full")).mode, "full");
    assert.equal((await study.list("B", undefined, "en", "13")).length, 1);
    const run = await study.startSelection({
      sectionId: "13",
      permit: "B",
      language: "en",
    });
    assert(run.url.includes("section=13"));
    assert.equal(run.language, "en");
    await assert.rejects(
      () => study.list("B", undefined, "en", "14"),
      /topic-test link/,
    );
    await assert.rejects(
      () => study.rules("B", "en", "14", "full"),
      /full section/,
    );
    await assert.rejects(
      () => study.rules("B", "en", "999", "summary"),
      /not found/,
    );
    assert.throws(
      () =>
        study.startSelection({
          url: "https://practicatest.com/en",
          sectionId: "13",
          permit: "B",
          language: "en",
        }),
      /exactly one/,
    );
  } finally {
    store.close();
  }
});
test("site links reject other hosts, credentials, protocols and non-test paths", () => {
  for (const url of [
    "https://evil.invalid/tests/a",
    "https://practicatest.com.evil.invalid/tests/a",
    "http://practicatest.com/tests/a",
    "https://u:p@practicatest.com/tests/a",
    "https://practicatest.com/ajax/login",
  ])
    assert.throws(() => siteUrl(url, true));
  assert.equal(
    parseLinks(
      '<a href="/tests/permiso-B/online">Daily</a><a href="//evil.invalid/tests/a/b">Bad</a>',
      "https://practicatest.com/tests/permiso-B",
    ).length,
    1,
  );
});
test("English landing URLs resolve to category B exams in Spain", async () => {
  assert.equal(
    testUrl("https://practicatest.com/en").pathname,
    "/en/spanish-driving-test",
  );
  assert.equal(
    testUrl("https://practicatest.com/en/", true).pathname,
    "/en/spanish-driving-test/online",
  );
  assert.throws(() => siteUrl("https://practicatest.com/en/register", true));
  assert.equal(
    parseLinks(
      '<a href="/en/spanish-driving-test/online">Daily English test</a>',
      "https://practicatest.com/en",
    ).length,
    1,
  );
  const { study, store, calls } = await setup();
  try {
    await study.list("B", undefined, "en");
    assert(calls.some((c) => c.path === "/en/spanish-driving-test"));
    const run = await study.start("https://practicatest.com/en");
    assert.equal(run.language, "en");
    assert.equal(run.permit, "B");
    study.answer(run.id, "q1", ["C"]);
    study.answer(run.id, "q2", ["A", "B"]);
    await study.finish(run.id);
    const write = calls.find((c) => c.path === "/ajax/correccion")!;
    assert.equal(write.body.get("lang"), "en");
    assert.equal(write.body.get("permiso_c"), "B_EN");
  } finally {
    store.close();
  }
});
test("cookie and CSRF authentication stay in memory and logout revokes access", async () => {
  const { study, calls, store } = await setup();
  try {
    assert(study.status().authenticated);
    const run = await study.start(
      "https://practicatest.com/tests/permiso-B/online",
    );
    assert(calls.some((c) => c.cookie?.includes("fixture-session")));
    assert.equal(
      calls.find((c) => c.path === "/ajax/login")?.csrf,
      "fixture-csrf",
    );
    const bytes = store.sqlite.serialize().toString("utf8");
    for (const secret of [
      "fixture@example.invalid",
      "dummy-test-password",
      "fixture-session",
      "fixture-csrf",
      "memory-only-tracking",
    ])
      assert(!bytes.includes(secret));
    await study.logout();
    assert.equal(study.status().authenticated, false);
    assert.throws(() => study.get(run.id), /Sign in/);
  } finally {
    store.close();
  }
});
test("answers are validated and grading handles wrong and multiple choices", async () => {
  const { study, store } = await setup();
  try {
    const run = await study.start(
      "https://practicatest.com/tests/permiso-B/online",
    );
    assert.throws(() => study.answer(run.id, "q1", ["Z"]), /valid answer/);
    assert.throws(() => study.answer(run.id, "q1", ["A", "B"]), /valid answer/);
    assert.equal(study.answer(run.id, "q1", ["A"]).correct, false);
    assert.deepEqual(study.answer(run.id, "q1", ["C"]).correctOptionIds, ["C"]);
    assert.equal(study.answer(run.id, "q2", ["A"]).correct, false);
    assert.equal(study.answer(run.id, "q2", ["B", "A", "A"]).correct, true);
    assert.equal(study.get(run.id).answers.length, 2);
    assert.equal(study.next(run.id).question, null);
  } finally {
    store.close();
  }
});
test("answer feedback includes the next question without a website request or waiting for the remote queue", async () => {
  const { study, store, calls } = await setup();
  let release!: () => void;
  try {
    const run = await study.start(
      "https://practicatest.com/tests/permiso-B/online",
    );
    const pendingRemote = study.exclusive(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await Promise.resolve();
    const before = calls.length;
    const feedback = study.answer(run.id, "q1", ["C"]);
    assert.equal(feedback.correct, true);
    assert.deepEqual(feedback.progress, { answered: 1, total: 2, correct: 1 });
    assert.equal(feedback.nextQuestion?.id, "q2");
    assert(!JSON.stringify(feedback.nextQuestion).includes("correctOptionIds"));
    assert.equal(calls.length, before);
    const completed = study.answer(run.id, "q2", ["A", "B"]);
    assert.deepEqual(completed.progress, { answered: 2, total: 2, correct: 2 });
    assert.equal(completed.nextQuestion, null);
    const changed = study.answer(run.id, "q1", ["A"]);
    assert.deepEqual(changed.progress, { answered: 2, total: 2, correct: 1 });
    assert.equal(changed.nextQuestion, null);
    release();
    await pendingRemote;
  } finally {
    release?.();
    store.close();
  }
});
test("completed exam is submitted using the exact upstream IDs and order, only once", async () => {
  const { study, calls, store } = await setup();
  try {
    const run = await study.start(
      "https://practicatest.com/tests/permiso-B/online",
    );
    await assert.rejects(() => study.finish(run.id), /all questions/);
    study.answer(run.id, "q1", ["C"]);
    study.answer(run.id, "q2", ["A", "B"]);
    await study.finish(run.id);
    await study.finish(run.id);
    const writes = calls.filter((c) => c.path === "/ajax/correccion");
    assert.equal(writes.length, 1);
    assert.equal(
      writes[0].body.get("respuestas"),
      "0005250811||0005250912-0005250922",
    );
    assert.equal(writes[0].body.get("order_answser"), "231||123");
    assert.equal(writes[0].body.get("seguimiento"), "memory-only-tracking");
    assert.equal(study.get(run.id).syncState, "submitted");
    assert.throws(() => study.answer(run.id, "q1", ["A"]), /already submitted/);
  } finally {
    store.close();
  }
});
test("failed remote write is marked uncertain and cannot be retried silently", async () => {
  const { study, store, fail, calls } = await setup();
  try {
    const run = await study.start(
      "https://practicatest.com/tests/permiso-B/online",
    );
    study.answer(run.id, "q1", ["C"]);
    study.answer(run.id, "q2", ["A", "B"]);
    fail();
    await assert.rejects(() => study.finish(run.id), /unreachable/);
    assert.equal(study.get(run.id).syncState, "uncertain");
    await assert.rejects(
      () => study.finish(run.id),
      /Submission status is unknown/,
    );
    assert.equal(calls.filter((c) => c.path === "/ajax/correccion").length, 1);
  } finally {
    store.close();
  }
});
test("explanation requires an answer and strips executable markup", async () => {
  const { study, store } = await setup();
  try {
    const run = await study.start(
      "https://practicatest.com/tests/permiso-B/online",
    );
    await assert.rejects(
      () => study.explanation(run.id, "q1"),
      /Answer the question first/,
    );
    study.answer(run.id, "q1", ["C"]);
    assert.deepEqual(await study.explanation(run.id, "q1"), {
      text: "Explicación útil.",
    });
  } finally {
    store.close();
  }
});
test("local guard rejects DNS rebinding, cross-origin requests and unauthenticated MCP", () => {
  const guard = localGuard(3000);
  const check = (path: string, headers: Record<string, string>) => {
    let status = 200;
    let passed = false;
    const res = {
      setHeader() {},
      status(s: number) {
        status = s;
        return this;
      },
      json() {},
    };
    guard({ path, headers } as never, res as never, () => {
      passed = true;
    });
    return { status, passed };
  };
  assert.equal(
    check("/api/session", { host: "evil.invalid:3000" }).status,
    403,
  );
  assert.equal(
    check("/api/session", {
      host: "localhost:3000",
      origin: "https://evil.invalid",
    }).status,
    403,
  );
  assert.equal(check("/mcp", { host: "localhost:3000" }).status, 401);
  assert.equal(check("/MCP/", { host: "localhost:3000" }).status, 401);
  assert(
    check("/api/session", {
      host: "localhost:3000",
      origin: "http://localhost:3000",
    }).passed,
  );
});
test("official MCP client can discover tools, get questions and submit answers", async () => {
  const { study, store } = await setup();
  const server = createMcp(study);
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    assert(
      (await client.listTools()).tools.some((t) => t.name === "submit_answer"),
    );
    const call = async (name: string, args: Record<string, unknown>) => {
      const response = await client.callTool({ name, arguments: args });
      assert(!response.isError);
      const content = response.content as { type: string; text: string }[];
      return JSON.parse(content[0].text);
    };
    await call("logout", {});
    assert.equal(study.status().authenticated, false);
    const signedIn = await call("login", {
      email: "fixture@example.invalid",
      password: "dummy-test-password",
    });
    assert.equal(signedIn.authenticated, true);
    assert(!JSON.stringify(signedIn).includes("fixture@example.invalid"));
    assert(!JSON.stringify(signedIn).includes("dummy-test-password"));
    assert.equal((await call("session_status", {})).authenticated, true);
    const access = await call("check_account_access", {
      permit: "B",
      language: "en",
    });
    assert.equal(access.accountAccess.topicTestCount, 1);
    assert.equal(access.accountAccess.premiumAccess, "not_confirmed");
    const run = await call("start_test", {
      url: "https://practicatest.com/tests/permiso-B/online",
    });
    assert(!JSON.stringify(run).includes("correctOptionIds"));
    const next = await call("next_question", { runId: run.id });
    assert.equal(next.question.id, "q1");
    const image = await client.callTool({
      name: "get_question_image",
      arguments: { runId: run.id, questionId: "q1" },
    });
    assert.equal((image.content as { type: string }[])[0].type, "image");
    const answer = await call("submit_answer", {
      runId: run.id,
      questionId: "q1",
      optionIds: ["C"],
    });
    assert.equal(answer.correct, true);
    assert.equal(answer.nextQuestion.id, "q2");
    assert.deepEqual(answer.progress, { answered: 1, total: 2, correct: 1 });
    assert(!JSON.stringify(answer.nextQuestion).includes("correctOptionIds"));
    assert.equal(study.get(run.id).answers[0].correct, true);
  } finally {
    await client.close();
    await server.close();
    store.close();
  }
});
