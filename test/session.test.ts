import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PracticaTest } from "../src/provider/practicatest.js";
import { SessionStore } from "../src/provider/session-store.js";
import { parseTest } from "../src/provider/parser.js";
import { fixture, home, manualFixture } from "./fixtures.js";

function website() {
  const cookie = randomBytes(24).toString("hex");
  let expired = false,
    premium = false,
    logins = 0;
  let submittedTracking = "";
  const fetcher = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const path = new URL(String(input)).pathname;
    if (path === "/") return new Response(home.replace("true", "false"));
    if (path === "/ajax/login") {
      logins++;
      return new Response('{"success":true}', {
        headers: {
          "Set-Cookie": `session=${cookie}; Path=/; Secure; HttpOnly`,
        },
      });
    }
    if (
      expired ||
      !new Headers(init?.headers).get("cookie")?.includes(`session=${cookie}`)
    )
      return new Response("Expired", { status: 401 });
    if (path === "/ajax/correccion") {
      submittedTracking =
        new URLSearchParams(String(init?.body)).get("seguimiento") ?? "";
      return new Response('{"success":true}');
    }
    if (path === "/en/book-theory-driving-test") {
      return new Response(
        premium
          ? manualFixture
              .replace(
                'href="/en/our-plans">Test (Premium)',
                'href="/en/spanish-driving-test/chapter/manoeuvres/14">Test',
              )
              .replace(
                'href="/en/our-plans">Read Full (Premium)',
                'href="/en/book-theory-driving-test/manoeuvres/14?full=1">Read Full',
              )
          : manualFixture,
      );
    }
    if (path.endsWith("/online")) return new Response(fixture);
    return new Response(
      `${home}<a href="/en/spanish-driving-test/online">Test</a>`,
    );
  }) as typeof fetch;
  return {
    fetcher,
    cookie,
    expire() {
      expired = true;
    },
    upgrade() {
      premium = true;
    },
    get logins() {
      return logins;
    },
    get submittedTracking() {
      return submittedTracking;
    },
  };
}

test("remembered authentication restores cookies, CSRF and active-test tracking without saving login credentials", async () => {
  const directory = await mkdtemp(join(tmpdir(), "practica-session-"));
  const storage = new SessionStore(directory);
  const site = website();
  try {
    const first = new PracticaTest(site.fetcher, storage);
    const login = await first.login(
      "session-fixture@example.invalid",
      "synthetic-login-password",
    );
    assert(login.authenticated && login.remembered);
    assert.equal(login.expiresAt, null);
    const id = randomUUID();
    first.remember(id, "synthetic-private-test-tracking");
    const encrypted = await readFile(storage.file);
    for (const value of [
      "session-fixture@example.invalid",
      "synthetic-login-password",
      site.cookie,
      "fixture-csrf",
      "synthetic-private-test-tracking",
    ])
      assert(!encrypted.includes(Buffer.from(value)));
    if (process.platform !== "win32") {
      assert.equal((await stat(storage.file)).mode & 0o777, 0o600);
      assert.equal((await stat(storage.keyFile)).mode & 0o777, 0o600);
    }
    first.dispose();
    assert(existsSync(storage.file));
    const second = new PracticaTest(site.fetcher, new SessionStore(directory));
    assert(second.status().authenticated && second.status().remembered);
    await second.sections("B", "en");
    assert.equal(site.logins, 1);
    await second.finish(
      id,
      parseTest(fixture),
      new Map([
        ["q1", ["C"]],
        ["q2", ["A", "B"]],
      ]),
      1,
    );
    assert.equal(site.submittedTracking, "synthetic-private-test-tracking");
    second.logout();
    assert(!existsSync(storage.file) && !existsSync(storage.keyFile));
    assert.equal(
      new PracticaTest(site.fetcher, new SessionStore(directory)).status()
        .authenticated,
      false,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("website expiration clears remembered state and damaged ciphertext never restores authentication", async () => {
  const directory = await mkdtemp(join(tmpdir(), "practica-expired-session-"));
  const storage = new SessionStore(directory);
  const site = website();
  try {
    const first = new PracticaTest(site.fetcher, storage);
    await first.login(
      "session-fixture@example.invalid",
      "synthetic-login-password",
    );
    const encrypted = await readFile(storage.file);
    encrypted[encrypted.length - 1] ^= 1;
    await writeFile(storage.file, encrypted);
    assert.equal(
      new PracticaTest(site.fetcher, storage).status().authenticated,
      false,
    );
    await first.login(
      "session-fixture@example.invalid",
      "synthetic-login-password",
    );
    const restored = new PracticaTest(site.fetcher, storage);
    site.expire();
    await assert.rejects(() => restored.sections("B", "en"), /expired/);
    assert.equal(restored.status().authenticated, false);
    assert(!existsSync(storage.file) && !existsSync(storage.keyFile));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("memory-only mode does not restore saved cookies and explicit logout still removes an older saved session", async () => {
  const directory = await mkdtemp(join(tmpdir(), "practica-memory-session-"));
  const site = website();
  const storage = new SessionStore(directory);
  try {
    await new PracticaTest(site.fetcher, storage).login(
      "session-fixture@example.invalid",
      "synthetic-login-password",
    );
    const memory = new PracticaTest(
      site.fetcher,
      new SessionStore(directory, false),
    );
    assert.equal(memory.status().authenticated, false);
    memory.logout();
    assert(!existsSync(storage.file));
    await memory.login(
      "session-fixture@example.invalid",
      "synthetic-login-password",
    );
    assert.equal(memory.status().authenticated, true);
    assert.equal(memory.status().remembered, false);
    assert(!existsSync(storage.file) && !existsSync(storage.keyFile));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("account-access refresh observes an upgrade without trusting a local purchase marker or a single trial lesson", async () => {
  const site = website();
  const provider = new PracticaTest(site.fetcher);
  await provider.login(
    "session-fixture@example.invalid",
    "synthetic-login-password",
  );
  const before = await provider.checkAccountAccess("B", "en");
  assert.equal(before.accountAccess.topicTestCount, 1);
  assert.equal(before.accountAccess.premiumAccess, "not_confirmed");
  site.upgrade();
  const after = await provider.checkAccountAccess("B", "en");
  assert.equal(after.accountAccess.topicTestCount, 2);
  assert.equal(after.accountAccess.sectionCount, 2);
  assert.equal(after.accountAccess.premiumAccess, "available");
  assert.equal(after.accountAccess.generalTestLinkCount, 1);
  assert.equal(after.access[0].topicTestCount, 2);
  assert.equal(site.logins, 1);
});
