# Connect to ChatGPT

## Copy the public connection from the interface

1. Start the app and open **MCP connection**.
2. Wait for **CLOUDFLARE HTTPS · READY**. On first launch, the app downloads the official `cloudflared` connector and verifies the release checksum. No Cloudflare account or domain is needed.
3. The public HTTPS URL is displayed in the interface. Select **Copy public server URL**, or **Copy setup prompt with token** to copy the complete instruction. **Preview the instruction** shows exactly what will be copied.
4. In ChatGPT Plugins, add a custom MCP server, choose **Server URL**, paste the copied URL, and choose **No authentication**. The link already contains a random private access key that the server validates. Select **Create as a plugin**, open it in your personal plugins and install it. Start a new **Work** chat, type **@** and select **PracticaTest**.
5. Once the plugin is selected, paste the session instructions or practice prompt from the MCP page. Ask ChatGPT to call `session_status`, then `list_sections` with `permit=B` and `language=en`. Sign in using the MCP `login` tool, the local CLI, or the existing web interface.

The Cloudflare tunnel is already created by the application. You do not need an OpenAI tunnel, a local connector, an API key or configuration files. The current ChatGPT connection flow is documented in [Add custom MCP server](https://developers.openai.com/api/docs/guides/custom-mcp-server). A normal chat cannot change its own plugin connections from a prompt alone; register and select the plugin first, then use the generated prompt to start practising.

## Authentication and what is exposed

The ChatGPT URL includes a private access key. Anyone with that full URL can use this single-user MCP connection, so share it only with your intended client. Choosing No authentication in ChatGPT means no separate OAuth step; the application's gateway still validates the key on every request.

Clients that support request headers can use the public `/mcp` endpoint with `Authorization: Bearer <local MCP token>` instead. This alternative appears in the copyable configuration. The prompt includes both connection forms, but never your PracticaTest password.

MCP credentials authorize only MCP requests. The web interface, `/api/connection`, login form and other administrative API routes require the separate private interface link and browser session cookie; a valid MCP key alone cannot reach them. The gateway adds local authorization while forwarding MCP and does not log request paths or tokens. The local MCP identity is saved privately beside the database. URL access keys stay in the independent tunnel process memory; connection responses use `Cache-Control: no-store`.

The app uses Streamable HTTP with JSON responses. Cloudflare Quick Tunnels do not support SSE, so no long-lived event stream is required.

## Start locally

With the existing interface:

```sh
npm ci
npm run build
npm start
```

Without Next.js or the interface:

```sh
npm run build:mcp
npm run start:mcp
```

Both modes automatically start the tunnel. The CLI can print the same public instruction when the daemon is ready:

```sh
npm run chatgpt:prompt
```

For a custom port, use `PORT=3210 npm start` and `npm run chatgpt:prompt -- --port 3210`.

## Sign in

- MCP: call `login` with `email` and `password`, then `session_status`. The app does not persist or return these credentials, but ChatGPT processes them as tool arguments.
- CLI: run `npm run login` in a second terminal. Both fields use hidden input. Use `npm run session` to check and `npm run logout` to clear the session. Set `PRACTICA_URL=http://127.0.0.1:3210` for a custom port.
- Web: use the existing sign-in form.

All three methods share the same remembered session. Its cookies and CSRF state are encrypted beside the database, while the login email and password are never saved. Restarting restores the session; explicit sign-out or expiration by PracticaTest requires signing in again. Set `PERSIST_SESSION=false` for memory-only sign-in.

## Docker

```sh
docker compose up --build -d
```

The image includes the official Cloudflare connector. The local UI and API bind to loopback on the host, while the connector opens an outbound tunnel to the authenticated gateway. To omit the interface:

```sh
docker compose -f compose.yaml -f compose.mcp.yaml up --build -d
```

## Tunnel lifecycle

[Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/) create temporary `trycloudflare.com` hostnames. The public URL and private URL key survive app-only restarts and change when the independent tunnel process stops and restarts. The interface refreshes its status and copied instruction automatically; update your ChatGPT connection with the new URL. Keep the app running while using it.

If startup fails, the interface shows an error and **Retry Cloudflare Tunnel**. The local app remains available. Quick Tunnels are intended for testing and personal development and have no uptime guarantee; use a managed tunnel with a stable hostname for production.

Set `TUNNEL_ENABLED=false` to keep everything local. `CLOUDFLARED_PATH` can point to an already installed binary. Otherwise, the app uses `cloudflared` from PATH or downloads its pinned official release into the user's cache, outside the repository.

## Verification boundaries

Automated tests check public-gateway authorization, blocked administrative routes, MCP calls through the gateway, generated public instructions, tunnel lifecycle and headless operation. A successful call through the public endpoint proves network and MCP access; connecting your ChatGPT account additionally requires creating/installing the plugin and a real tool call originating in ChatGPT.

## Fast answer feedback

`submit_answer` checks the saved answer key locally. It returns correctness, correct options, `progress` and `nextQuestion` in a single response. The assistant should display the feedback immediately and use that next question directly. Additional `get_test` and `next_question` calls are unnecessary for the same turn. `get_explanation` makes a separate PracticaTest request; use it when the learner asks for the website explanation.

## Private browser interface

The MCP page also shows **Copy private interface URL** and **Open interface**. Use that separate `/app/<private-key>` URL to open the web interface from your phone. It sets a Secure, HttpOnly browser cookie and redirects to `/`, removing the entry key from the address bar. Cross-site writes are rejected. The link grants access to the interface and account controls, so keep it private. It survives app-only restarts, is regenerated when the independent tunnel restarts and is unavailable in MCP-only mode.

The native tunnel runs in the background after the app exits; `npm run tunnel:stop` explicitly ends it. Docker uses a separate `tunnel` service. Use `docker compose restart practica` or rebuild/recreate only `practica` to keep the public URLs. See [the update commands](../README.md#keep-the-public-url-during-app-updates).
