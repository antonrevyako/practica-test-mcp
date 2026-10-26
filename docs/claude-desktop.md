# Connect Claude Desktop

The **MCP connection** page includes both options below, current connection details and copy buttons. Keep the app running while using either connection.

## Public connector: native app or Docker

1. Wait for **CLOUDFLARE HTTPS · READY** on the MCP page. Select **Copy URL for Claude Desktop**. The full HTTPS URL includes the private access key.
2. In Claude Desktop, open **Customize → Connectors** (older layouts: **Settings → Connectors**), then **+ Add → Add custom connector**.
3. Name it **PracticaTest**, paste the full URL and continue. Select **No sign in** for authentication; the app validates the key embedded in the URL. No OAuth client or request headers are needed. Finish adding and connecting it.
4. In a chat, open **+ → Connectors** beside the message box and enable **PracticaTest**.
5. Ask Claude to call `session_status`. Only a successful tool call confirms the connection. Use **Copy practice prompt** on the MCP page to start practising.

Remote connectors originate from Claude's infrastructure, including when you use Desktop. A localhost URL will not work in this form. The same public connector can be used on the web. Team and Enterprise accounts may need an owner to register it. The temporary URL changes after restarting the app or tunnel; update the connector with the new URL.

See [Claude's official custom connector instructions](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

## Local stdio bridge: native app on the same computer

1. Start the app locally with Node.js. You can disable the tunnel with `TUNNEL_ENABLED=false`.
2. On the MCP page, expand **Alternative: local Desktop connection without a tunnel** and select **Copy local Claude Desktop config**. The generated JSON uses the current absolute Node.js path, bridge path and local port.
3. Open Claude Desktop **Settings → Developer → Edit Config**. Paste the JSON into `claude_desktop_config.json`. If other servers already exist, merge just `practicatest` into the existing `mcpServers` object.
4. Save, completely quit and reopen Claude Desktop. Enable PracticaTest and call `session_status`.

Configuration file locations:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Claude launches `scripts/mcp-stdio.mjs`, which pairs with the already running app through its loopback API. The configuration contains no PracticaTest credentials or MCP token. The bridge refreshes its token if the daemon restarts. Copy the config again after moving the project or changing its port.

The native config is intentionally unavailable when the app runs inside Docker: container paths cannot be used as desktop commands. Use the public connector for Docker. Remote HTTP configuration with a `url` field belongs in the connector form, rather than the local stdio config file.

See [the official local MCP setup guide](https://modelcontextprotocol.io/docs/develop/connect-local-servers).

## Sign in and practise

Sign in from the Practice tab, run `npm run login` in the project directory, or choose the MCP `login` tool. MCP login arguments are processed by the chat client. All three methods share the in-memory session; the app never persists the website credentials.

`submit_answer` grades locally and includes progress and the next question. Ask for the website explanation when needed. Only `finish_test` submits the completed exam, following an explicit user request.
