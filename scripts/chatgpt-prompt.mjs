import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export function connectionPrompt(root, port = 3000, options = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Port must be an integer between 1 and 65535.");
  const base = options.origin ?? `http://127.0.0.1:${port}`;
  if (options.publicUrl) {
    return `Use my running PracticaTest MCP server in ChatGPT for English category B driving theory in Spain.

First create, install and select the PracticaTest plugin using the app’s connection guide. An ordinary chat prompt cannot register or enable its own MCP tools. If the plugin is already selected, proceed directly to session_status.

Server URL: ${options.publicUrl}
Connection type: Server URL (public HTTPS via Cloudflare)
Transport: Streamable HTTP
ChatGPT authentication setting: No authentication. The private access key is already embedded in the Server URL and is verified by my server.

For MCP clients that support request headers, this alternative also works:
Endpoint: ${base}/mcp
Authorization: Bearer ${options.token ?? "<local MCP token>"}

The URL and token grant access to my personal MCP server. Use them only to establish this connection; do not repeat them in your answer or save them to files or logs. They are not my PracticaTest password.

The Cloudflare tunnel is already running. Do not use localhost URLs, create another tunnel, install a local connector or ask me to edit configuration files.

If you can operate the ChatGPT interface, open ChatGPT Plugins, add or reuse a custom MCP server named PracticaTest, enter the Server URL above, choose No authentication, create and install it, then verify an actual MCP call. If this chat cannot change its own connections, state that plainly and give the short path to Add custom MCP server; do not pretend that the connection has been installed. Official instructions: https://developers.openai.com/api/docs/guides/custom-mcp-server

Once connected, call session_status and check_account_access with permit B and language en to obtain current subscription access. Use these fresh results rather than earlier free-account restrictions. If sign-in is needed, let me choose between the MCP login tool, local CLI login and the existing web interface. Never repeat my email or password. List sections using permit B and language en, retrieve one section with get_section_rules, then offer a general exam or a test for a selected section. Topic-test access follows my PracticaTest subscription. Ask questions one at a time and wait for my answers. After each answer, call submit_answer once and show the result immediately. Its response includes progress and nextQuestion; use them without extra get_test or next_question calls. Fetch get_explanation only if I ask for the website explanation, since answer checking is local. Do not call finish_test unless I explicitly ask to submit the result.

Only report success after a real tool call from ChatGPT succeeds. The Cloudflare hostname and access key survive app-only restarts and change only when the independent tunnel restarts; ask me to copy a fresh instruction if the connection has expired.
`;
  }
  throw new Error("The public Cloudflare connection is not ready yet.");
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const index = process.argv.indexOf("--port");
    if (index >= 0 && !process.argv[index + 1])
      throw new Error("Provide a value after --port.");
    const port = Number(
      index >= 0 ? process.argv[index + 1] : (process.env.PORT ?? 3000),
    );
    const { localEndpoint, localApi } = await import("./local-client.mjs");
    const target = localEndpoint(
      process.env.PRACTICA_URL ?? `http://127.0.0.1:${port}`,
    );
    const connection = await localApi(target, "connection");
    if (!connection.prompt)
      throw new Error(
        connection.tunnel?.error ??
          "The public tunnel is not ready yet. Wait for Cloudflare in the MCP connection tab and retry.",
      );
    process.stdout.write(connection.prompt);
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Could not generate the prompt.",
    );
    process.exitCode = 1;
  }
}
