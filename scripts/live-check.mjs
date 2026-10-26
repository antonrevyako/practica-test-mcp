// Interactive only: credentials are never command arguments, environment variables or files.
import assert from "node:assert/strict";
import { hiddenPrompt } from "./terminal-input.mjs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";

const base = process.env.PRACTICA_URL ?? "http://127.0.0.1:3000";
const url = new URL(base);
assert(
  ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
    url.protocol === "http:",
  "Only a local app is supported.",
);
async function api(path, init) {
  const response = await fetch(`${base}/api/${path}`, {
    ...init,
    headers: { "Content-Type": "application/json" },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`${data.error}: ${data.message}`);
  return data;
}
let client;
let stdioClient;
try {
  let email = await hiddenPrompt(
    "Test account email (not displayed or saved): ",
  );
  let password = await hiddenPrompt(
    "Test account password (not displayed or saved): ",
  );
  const { token } = await api("connection");
  client = new Client({ name: "practica-live-check", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("/mcp", base), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  const tools = await client.listTools();
  assert(tools.tools.some((t) => t.name === "submit_answer"));
  const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    assert(!result.isError, "MCP tool failed");
    return JSON.parse(result.content[0].text);
  };
  const session = await call("login", { email, password });
  email = "";
  password = "";
  assert.equal(session.authenticated, true);
  assert.equal((await api("session")).authenticated, true);
  const sections = await call("list_sections", { permit: "B", language: "en" });
  assert(sections.length > 0);
  const rules = await call("get_section_rules", {
    sectionId: sections[0].id,
    permit: "B",
    language: "en",
    mode: "summary",
  });
  assert(rules.text.length > 0 || rules.images.length > 0);
  const links = await call("list_tests", { permit: "B", language: "en" });
  assert(links.length > 0);
  const test = await call("start_test", { url: "https://practicatest.com/en" });
  assert.equal(test.language, "en");
  assert.equal(test.permit, "B");
  assert(test.questions.length > 0);
  assert(!JSON.stringify(test).includes("sourceIds"));
  assert(!JSON.stringify(test).includes("correctOptionIds"));
  const question = await call("next_question", { runId: test.id });
  if (question.question.imageUrl) {
    const image = await client.callTool({
      name: "get_question_image",
      arguments: { runId: test.id, questionId: question.question.id },
    });
    assert(
      !image.isError,
      image.content.find((item) => item.type === "text")?.text ??
        "Could not fetch the question illustration.",
    );
    assert.equal(image.content[0].type, "image");
  }
  const answered = await call("submit_answer", {
    runId: test.id,
    questionId: question.question.id,
    optionIds: [question.question.options[0].id],
  });
  assert.equal(typeof answered.correct, "boolean");
  const fetched = await api(`attempts/${test.id}`);
  assert.equal(fetched.answers.length, 1);
  const spanish = await call("start_test", {
    url: "https://practicatest.com/tests/permiso-B/online",
  });
  assert.equal(spanish.language, "es");
  stdioClient = new Client({ name: "practica-stdio-check", version: "1.0.0" });
  await stdioClient.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL("./mcp-stdio.mjs", import.meta.url))],
      env: {
        ...process.env,
        PRACTICA_URL: new URL("/mcp", base).href,
      },
      stderr: "pipe",
    }),
  );
  const stdioStatus = await stdioClient.callTool({
    name: "session_status",
    arguments: {},
  });
  assert(!stdioStatus.isError);
  assert(JSON.parse(stdioStatus.content[0].text).authenticated);
  await call("logout");
  assert.equal((await api("session")).authenticated, false);
  console.log(
    `PASS: MCP login/logout, ${tools.tools.length} MCP tools, ${sections.length} manual sections and section rules, ${links.length} English exam links, ${test.questions.length} English and ${spanish.questions.length} Spanish questions, image content, HTTP and auto-paired stdio MCP, shared answer state.`,
  );
  console.log(
    "No exam results were sent to PracticaTest. Two local practice attempts were created.",
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : "Live check failed.");
  process.exitCode = 1;
} finally {
  await client?.close();
  await stdioClient?.close();
  await api("session", { method: "DELETE" }).catch(() => {});
}
