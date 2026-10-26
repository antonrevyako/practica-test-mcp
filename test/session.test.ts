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
    logins = 0,
    offline = false,
    invalidPassword = false,
    rejectManual = false,
    rejectSubmission = false,
    submissionRequests = 0;
  let submittedTracking = "";
  const fetcher = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    if (offline) throw new Error("Synthetic network outage.");
    const path = new URL(String(input)).pathname;
    if (path === "/") return new Response(home.replace("true", "false"));
    if (path === "/ajax/login") {
      logins++;
      if (invalidPassword) return new Response('{"success":false}');
      expired = false;
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
      submissionRequests++;
      if (rejectSubmission) return new Response("Expired", { status: 401 });
      submittedTracking =
        new URLSearchParams(String(init?.body)).get("seguimiento") ?? "";
      return new Response('{"success":true}');
    }
    if (path === "/en/book-theory-driving-test") {
      if (rejectManual) return new Response("Expired", { status: 401 });
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
    setOffline(value: boolean) {
      offline = value;
    },
    rejectPassword() {
      invalidPassword = true;
    },
    rejectManual() {
      rejectManual = true;
    },
    rejectSubmission() {
      rejectSubmission = true;
    },
    get submissionRequests() {
      return submissionRequests;
    },
    get logins() {
      return logins;
    },
    get submittedTracking() {
      return submittedTracking;
    },
  };
}

test("remembered authentication encrypts credentials, cookies, CSRF and active-test tracking", async () => {
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
    assert.equal(login.credentialsRemembered, true);
    assert.deepEqual(storage.loadCredentials(), {
      email: "session-fixture@example.invalid",
      password: "synthetic-login-password",
    });
    assert(!JSON.stringify(login).includes("synthetic-login-password"));
    assert(!JSON.stringify(login).includes("session-fixture@example.invalid"));
    assert.equal(login.expiresAt, null);
    const id = randomUUID();
    first.remember(id, "synthetic-private-test-tracking");
    const encrypted = await readFile(storage.file);
    const encryptedCredentials = await readFile(storage.credentialsFile);
    for (const value of [
      "session-fixture@example.invalid",
      "synthetic-login-password",
      site.cookie,
      "fixture-csrf",
      "synthetic-private-test-tracking",
    ])
      {
        assert(!encrypted.includes(Buffer.from(value)));
        assert(!encryptedCredentials.includes(Buffer.from(value)));
      }
    if (process.platform !== "win32") {
      assert.equal((await stat(storage.file)).mode & 0o777, 0o600);
      assert.equal((await stat(storage.keyFile)).mode & 0o777, 0o600);
      assert.equal((await stat(storage.credentialsFile)).mode & 0o777, 0o600);
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
    assert(!existsSync(storage.credentialsFile));
    assert.equal(
      new PracticaTest(site.fetcher, new SessionStore(directory)).status()
        .authenticated,
      false,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("session-only mode clears expired state and damaged ciphertext never restores authentication", async () => {
  const directory = await mkdtemp(join(tmpdir(), "practica-expired-session-"));
  const storage = new SessionStore(directory, true, false);
  const site = website();
  try {
    const first = new PracticaTest(site.fetcher, storage);
    await first.login(
      "session-fixture@example.invalid",
      "synthetic-login-password",
    );
    assert(!existsSync(storage.credentialsFile));
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
    assert.equal(memory.status().credentialsRemembered, false);
    assert(!existsSync(storage.file) && !existsSync(storage.keyFile));
    assert(!existsSync(storage.credentialsFile));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("saved credentials restore missing and expired sessions and concurrent recovery shares one login", async () => {
  const directory = await mkdtemp(join(tmpdir(), "practica-recovery-"));
  const storage = new SessionStore(directory);
  const site = website();
  try {
    const first = new PracticaTest(site.fetcher, storage);
    await first.login("recovery@example.invalid", "synthetic-recovery-password");
    site.expire();
    assert((await first.sections("B", "en")).length > 0);
    assert.equal(site.logins, 2);
    first.dispose();
    await rm(storage.file);
    const second = new PracticaTest(site.fetcher, storage);
    assert.equal(second.status().authenticated, false);
    assert.equal(second.status().credentialsRemembered, true);
    const results = await Promise.all([
      second.restoreLogin(),
      second.restoreLogin(),
      second.restoreLogin(),
    ]);
    assert(results.every((result) => result.authenticated));
    assert.equal(site.logins, 3);
    second.logout();
    assert.equal((await second.restoreLogin()).authenticated, false);
    assert.equal(site.logins, 3);
    assert(!existsSync(storage.file));
    assert(!existsSync(storage.credentialsFile));
    assert(!existsSync(storage.keyFile));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("an outage preserves saved credentials and a rejected password removes them", async () => {
  const directory = await mkdtemp(join(tmpdir(), "practica-recovery-failure-"));
  const storage = new SessionStore(directory);
  const site = website();
  try {
    await new PracticaTest(site.fetcher, storage).login(
      "recovery@example.invalid",
      "synthetic-recovery-password",
    );
    await rm(storage.file);
    const restored = new PracticaTest(site.fetcher, storage);
    site.setOffline(true);
    await assert.rejects(() => restored.restoreLogin(), {
      code: "SITE_UNREACHABLE",
    });
    assert.equal(restored.status().credentialsRemembered, true);
    site.setOffline(false);
    site.rejectPassword();
    await assert.rejects(() => restored.restoreLogin(), {
      code: "INVALID_CREDENTIALS",
    });
    assert.equal(restored.status().credentialsRemembered, false);
    assert(!existsSync(storage.credentialsFile) && !existsSync(storage.keyFile));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("tampered credential ciphertext cannot trigger automatic login", async () => {
  const directory = await mkdtemp(join(tmpdir(), "practica-credential-tamper-"));
  const storage = new SessionStore(directory);
  const site = website();
  try {
    await new PracticaTest(site.fetcher, storage).login(
      "recovery@example.invalid",
      "synthetic-recovery-password",
    );
    const encrypted = await readFile(storage.credentialsFile);
    encrypted[encrypted.length - 1] ^= 1;
    await writeFile(storage.credentialsFile, encrypted);
    await rm(storage.file);
    const restored = new PracticaTest(site.fetcher, storage);
    assert.equal((await restored.restoreLogin()).authenticated, false);
    assert.equal(restored.status().credentialsRemembered, false);
    assert.equal(site.logins, 1);
    restored.logout();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a rejected read is retried at most once after login recovery", async () => {
  const directory = await mkdtemp(join(tmpdir(), "practica-recovery-bound-"));
  const site = website();
  try {
    const provider = new PracticaTest(site.fetcher, new SessionStore(directory));
    await provider.login("recovery@example.invalid", "synthetic-recovery-password");
    site.rejectManual();
    await assert.rejects(() => provider.sections("B", "en"), {
      code: "SESSION_EXPIRED",
    });
    assert.equal(site.logins, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("expired result submissions are never replayed automatically", async () => {
  const directory = await mkdtemp(join(tmpdir(), "practica-no-write-replay-"));
  const site = website();
  try {
    const provider = new PracticaTest(site.fetcher, new SessionStore(directory));
    await provider.login("recovery@example.invalid", "synthetic-recovery-password");
    const id = randomUUID();
    provider.remember(id, "synthetic-private-test-tracking");
    site.rejectSubmission();
    await assert.rejects(
      () => provider.finish(id, parseTest(fixture), new Map([
        ["q1", ["C"]],
        ["q2", ["A", "B"]],
      ]), 0),
      { code: "SESSION_EXPIRED" },
    );
    assert.equal(site.submissionRequests, 1);
    assert.equal(site.logins, 1);
    assert.equal(provider.status().credentialsRemembered, true);
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
