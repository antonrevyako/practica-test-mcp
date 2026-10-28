import { test } from "node:test";
import assert from "node:assert/strict";
import { hostedConnection } from "../src/tunnel/hosted-connection.js";

const mcpKey = "a".repeat(64);
const webKey = "b".repeat(64);
const env = {
  HOSTED_PUBLIC_URL: "https://study.example.com",
  HOSTED_ACCESS_KEY: mcpKey,
  HOSTED_WEB_ACCESS_KEY: webKey,
};

test("without opt-in, existing Cloudflare and disabled behavior is unchanged", () => {
  assert.equal(hostedConnection({}), null);
  assert.equal(hostedConnection({ TUNNEL_ENABLED: "false" }), null);
  assert.equal(hostedConnection({ HOSTED_ACCESS_KEY: mcpKey }), null);
});

test("hosted links use explicit HTTPS origin and gateway keys", () => {
  assert.deepEqual(hostedConnection(env), {
    provider: "hosted", status: "ready", error: null,
    publicUrl: "https://study.example.com/mcp",
    chatgptUrl: `https://study.example.com/mcp/${mcpKey}`,
    webUrl: `https://study.example.com/app/${webKey}`,
  });
  assert.equal(hostedConnection({ ...env, TUNNEL_ENABLED: "false" })?.status, "ready");
  assert.equal(hostedConnection(env, false)?.webUrl, null);
  assert.equal(hostedConnection({ ...env, HOSTED_WEB_ACCESS_KEY: undefined })?.webUrl, null);
});

test("invalid hosted configuration fails closed without echoing secrets", () => {
  for (const origin of ["", "http://study.example.com", "https://user:private@study.example.com", "https://study.example.com/private", "https://study.example.com/?private=value", "https://study.example.com/#private", "not-a-url"]) {
    const status = hostedConnection({ ...env, HOSTED_PUBLIC_URL: origin });
    assert.equal(status?.status, "error");
    assert.equal(status?.chatgptUrl, null);
    assert.equal(status?.webUrl, null);
    assert.ok(!JSON.stringify(status).includes("private"));
    assert.ok(!JSON.stringify(status).includes(mcpKey));
  }
  for (const key of [undefined, "", "short", "x".repeat(64), "a/b".repeat(32)]) {
    assert.equal(hostedConnection({ ...env, HOSTED_ACCESS_KEY: key })?.status, "error");
  }
  assert.equal(hostedConnection({ ...env, HOSTED_WEB_ACCESS_KEY: "bad" })?.status, "error");
});
