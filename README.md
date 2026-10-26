# PracticaTest MCP

A local Node.js app for [PracticaTest](https://practicatest.com/) questions, with a study interface and an MCP server for AI clients. Built with TypeScript, NestJS, Next.js, React, SQLite, Drizzle ORM and Zod 4.

## Start with Docker

Install Docker Desktop or Docker Engine with the Compose plugin. Node.js is not required on the host. Clone or download this repository, open a terminal in the `practica-test-mcp` directory, then run:

```sh
docker compose up --build -d
```

The first build installs dependencies and creates the application image. Open **http://localhost:3000** and sign in to PracticaTest on the **Practice** tab. Then open **[MCP connection](http://localhost:3000/?tab=mcp)** for the ChatGPT and Claude Desktop connection guides. The app starts its Cloudflare tunnel automatically; no Cloudflare account or environment file is needed.

You can also sign in through an interactive terminal inside the running container:

```sh
docker compose exec practica npm run login
docker compose exec practica npm run session
```

Both sign-in fields use hidden input. Your website credentials are not saved. To inspect startup logs or stop the application:

```sh
docker compose logs --tail=50 practica
docker compose down
```

Questions, answer history and downloaded images remain in the `practica-data` named volume when the container stops or is recreated. The container runs as the `node` user and publishes the UI and API on host loopback only. Restarting clears the in-memory login and creates a new temporary Cloudflare URL; sign in again and update the MCP client with the new URL.

If port 3000 is occupied, start on another port (macOS/Linux):

```sh
PORT=3210 docker compose up --build -d
```

Then open **http://localhost:3210**.

### Docker without the web interface

Use the MCP-only override instead of the normal startup command:

```sh
docker compose -f compose.yaml -f compose.mcp.yaml up --build -d
docker compose exec practica npm run login
docker compose exec practica npm run chatgpt:prompt
```

This mode serves MCP and the local administrative API without loading Next.js. The last command prints the current public connection instruction once the tunnel is ready. Stop it with `docker compose -f compose.yaml -f compose.mcp.yaml down`.

## Start without Docker

Install **Node.js 22.13 or newer** and npm. The Docker image and application have been tested with Node.js 24. Clone or download this repository and run these commands from its root directory:

```sh
npm ci
npm run build
npm start
```

Keep this terminal running. Open **http://localhost:3000**, sign in on the **Practice** tab and choose a test. You can paste **https://practicatest.com/en** to open today's English category B exam in Spain; Spanish exams are also supported. Open **[MCP connection](http://localhost:3000/?tab=mcp)** to connect ChatGPT or Claude Desktop.

Alternatively, sign in from a second terminal in the project directory:

```sh
npm run login
npm run session
```

Stop the application with **Ctrl+C**. SQLite migrations run automatically, and the database is created at `data/practica.sqlite`. Question images are saved in `data/images/`. These files remain after stopping, while the login session and temporary public connection URL are renewed on the next launch.

If `better-sqlite3` has no prebuilt binary for your platform, installation needs Python 3 and C++ build tools: Xcode Command Line Tools on macOS, or `python3 make g++` on Debian/Ubuntu. The Docker build already includes them.

To use a different port on macOS/Linux:

```sh
PORT=3210 npm start
```

Then open **http://localhost:3210**. CLI commands in another terminal should use the same port:

```sh
PRACTICA_URL=http://127.0.0.1:3210 npm run login
PRACTICA_URL=http://127.0.0.1:3210 npm run session
```

For development with automatic reload, use `npm run dev` after `npm ci`. After changing source files for a production installation, stop the app, run `npm run build` again and restart with `npm start`.

### Node.js without the web interface

Build and start only the NestJS daemon:

```sh
npm ci
npm run build:mcp
npm run start:mcp
```

Keep the daemon running, then use a second terminal to sign in and print the public connection instruction:

```sh
npm run login
npm run chatgpt:prompt
```

## Use it from ChatGPT or Claude Desktop

The **MCP connection** page shows the current Cloudflare HTTPS URL with **Copy public server URL** and **Copy setup prompt with token** buttons. It includes separate step-by-step guides and copyable connection details for each client. Create, install and select the connector first; pasting a prompt alone cannot register MCP tools in a normal chat.

For ChatGPT, add the full public Server URL and choose **No authentication**: the URL already includes a private access key verified by this app. Claude Desktop can use the same public URL, or the generated local stdio configuration when this app runs natively on the same computer. The web interface and administrative API remain local.

Keep the app running while practising. The temporary URL changes after restarting; copy the new link and update your client. See [ChatGPT setup and authentication](docs/chatgpt.md) and [Claude Desktop setup](docs/claude-desktop.md).

## MCP connection

The **MCP connection** tab provides the public Cloudflare endpoint, a key-protected ChatGPT URL, token and copyable configuration. The server uses [Streamable HTTP](https://modelcontextprotocol.io/docs/learn/architecture). ChatGPT and Claude can use the key-protected URL above. Other HTTP clients that support an Authorization header can use the alternative Bearer-token endpoint. Configuration syntax varies by client; a typical HTTP-client example is:

```json
{
  "mcpServers": {
    "practicatest": {
      "url": "https://<generated-host>.trycloudflare.com/mcp",
      "headers": {
        "Authorization": "Bearer <token from the local UI>"
      }
    }
  }
}
```

This local token is separate from your PracticaTest password. By default, it is generated in memory at startup; update your client after restarting. You can optionally supply a persistent **local MCP token** using `MCP_TOKEN`. Website credentials are never accepted through environment variables.

For clients that only support stdio, use the bridge to the same running app:

```json
{
  "mcpServers": {
    "practicatest": {
      "command": "node",
      "args": ["/absolute/path/practica-test-mcp/scripts/mcp-stdio.mjs"],
      "env": {
        "PRACTICA_URL": "http://127.0.0.1:3000/mcp"
      }
    }
  }
}
```

The stdio bridge pairs with the local daemon automatically; setting MCP_TOKEN is optional. It can also connect to the Docker app: run it on the host from this checkout after `npm ci`. The UI and MCP clients share the same in-memory login session and local history.

| Tool                 | Purpose                                                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `login`              | Sign in with email/password supplied through MCP; credentials are not saved by the app                                                                                          |
| `logout`             | Clear the shared website session                                                                                                                                                |
| `session_status`     | Check authentication                                                                                                                                                            |
| `list_tests`         | List accessible exam links; `language=en` (default) selects English category B exams; `language=es` selects Spanish; `sectionId` selects topic exams; omit it for general exams |
| `start_test`         | Open an exam using exactly one of `url` or `sectionId`, create an attempt and return its `runId`                                                                                |
| `list_sections`      | Discover section IDs, titles, rules and topic-test availability                                                                                                                 |
| `get_section_rules`  | Fetch rules for `sectionId`, with text, headings, image URLs and tables; `mode=summary` or `full`                                                                               |
| `get_test`           | Retrieve questions and progress                                                                                                                                                 |
| `next_question`      | Retrieve the first unanswered question                                                                                                                                          |
| `submit_answer`      | Accept `runId`, `questionId` and `optionIds`; grade and save locally                                                                                                            |
| `get_question_image` | Return an illustration as MCP image content for vision-capable clients                                                                                                          |
| `get_explanation`    | Fetch the website explanation after answering                                                                                                                                   |
| `finish_test`        | Submit a completed exam to PracticaTest and update website statistics                                                                                                           |
| `list_attempts`      | List local attempts and scores                                                                                                                                                  |

Example prompt: “Find an English category B test in Spain, open today's exam and ask one question at a time. Wait for my answer, then explain mistakes. Submit the result to the website when I ask.”

Option IDs are `A`, `B`, `C`; use an array for questions with multiple answers. Question illustrations are included as `imageUrl`; `get_question_image` returns their image content directly. Correct options become available through the API/MCP after answering. `submit_answer` saves locally and returns correctness, progress and `nextQuestion` in one call. Use this response directly without an extra `get_test` or `next_question` call. Fetch `get_explanation` separately only when the learner asks for the website explanation; **only `finish_test` writes the result to the website**, after every question is answered. Repeating a successful submission returns the saved result. If a request fails or the process exits during submission, the attempt is marked `uncertain` and cannot be retried automatically; check the result on the website.

## Section rules and topic exams

Call `list_sections` with `permit` and `language` to discover section IDs. Then call `get_section_rules` with `sectionId` to retrieve that section's summary. It returns the source URL, plain text, headings, image references and structured tables. Request `mode=full` only when `fullUrl` is available. Rules are fetched live and are not persisted to SQLite.

For topic tests, call `list_tests` or `start_test` with a `sectionId`. Omit it for general exams. Never combine a section ID and a URL. The interface includes a section selector and a rules reader. Website permissions apply: a missing `testUrl` or `fullUrl` means the account has no accessible link, commonly because Premium is required. The app reports this and does not substitute an unrelated general exam.

Example MCP arguments:

```json
{"name":"list_sections","arguments":{"permit":"B","language":"en"}}
{"name":"get_section_rules","arguments":{"sectionId":"13","language":"en","mode":"summary"}}
{"name":"list_tests","arguments":{"permit":"B","language":"en","sectionId":"13"}}
{"name":"start_test","arguments":{"sectionId":"13","permit":"B","language":"en"}}
```

The live section ID `13` is the English Speed chapter; discover IDs with `list_sections` instead of relying on chapter numbers. Section numbers and IDs are different.

## Persistent question and answer statistics

Each opened test archives the exact question wording, option text and order, and correct choices. Each first answer or changed selection is saved as an immutable event; repeating the same choice does not inflate statistics. `submit_answer` still checks locally in one call. Images download in the background with two concurrent requests and are stored at `data/images/` by default. The database and images share the persistent Docker volume.

Additional MCP tools work directly with this local archive, including while signed out:

| Tool                          | Purpose                                                                                                                |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `get_statistics`              | Attempts, unique questions, latest and first-answer accuracy, answer-event counts and image-cache progress             |
| `list_recorded_questions`     | Paginated question text, options, latest answers and local image availability; supports text search and `mistakesOnly` |
| `get_answer_history`          | Paginated answer and correction events, with chosen and correct options and timestamps                                 |
| `get_recorded_question_image` | Read a locally saved illustration by `runId` and `questionId`, without a website request                               |
| `cache_recorded_images`       | Retry missing or failed downloads in the background; requires sign-in                                                  |

Filter statistics by `permit`, `language`, `runId`, `questionKey` and ISO `from`/`to` dates. Question content is identified independently of option letters, so shuffled options can be grouped across attempts. Correct options remain hidden for unanswered questions. Existing attempts are imported automatically; only their last saved choices can be recovered from the older database. See [statistics, persistence and image caching](docs/statistics.md).

## Data and authentication

- Email and password are forwarded to PracticaTest over HTTPS. They are never saved to SQLite, files or application logs.
- Cookies and CSRF tokens stay in process memory. Sign-out, restart or a two-hour expiry clears the local session. The website session may expire earlier.
- SQLite stores parsed questions, exact option order, exam identifiers and append-only answer events. Downloaded question images are saved beside the database in an `images/` directory. Full HTML and session parameters are not persisted. `data/`, databases and `.env*` files are excluded from Git and the Docker context.
- This is a single-user app for a trusted local machine. History belongs to the local workspace and remains after sign-out. Archive statistics and saved images can still be read through authenticated MCP while signed out. There is no multi-user isolation.
- Local HTTP MCP requires a Bearer token. The Cloudflare gateway accepts the public MCP endpoint with that token or the key-protected ChatGPT URL, and blocks all UI and administrative routes.
- Access follows the permissions and subscription of your account. Website limits still apply. HTML changes may require adapter updates. CAPTCHA bypass is not implemented.

## Configuration

| Variable           | Default                     | Purpose                                                                         |
| ------------------ | --------------------------- | ------------------------------------------------------------------------------- |
| `PORT`             | `3000`                      | Shared UI, API and MCP port                                                     |
| `HOST`             | `127.0.0.1`                 | Listen address; Docker uses `0.0.0.0`                                           |
| `DATABASE_PATH`    | `./data/practica.sqlite`    | SQLite path                                                                     |
| `MCP_TOKEN`        | Random at startup           | Optional persistent local MCP token                                             |
| `TUNNEL_ENABLED`   | `true`                      | Automatically start the Cloudflare Quick Tunnel; set `false` for local-only use |
| `CLOUDFLARED_PATH` | Auto-detected or downloaded | Optional path to the Cloudflare connector                                       |
| `PRACTICA_URL`     | Local endpoint              | App address for the stdio bridge and live check                                 |

Run commands from the project root. With a custom port, open `http://localhost:<PORT>`. For example, use `PORT=3210 npm start` or `PORT=3210 docker compose up --build -d` if port 3000 is already occupied.

## Verification

```sh
npm run typecheck
npm test
npm run build
npm audit
```

Tests cover shuffled and multiple-choice answers, hidden answer keys, cookie/CSRF authentication, absence of credentials in SQLite, grading, result submission, ambiguous network failures, URL/Origin restrictions and the official MCP client. Fixtures contain synthetic questions and dummy credentials; tests do not access real accounts.

To verify a real account, start the app and run this in a second terminal:

```sh
npm run test:live
```

The script prompts for email and password with hidden input. It verifies authentication, retrieves manual sections and rules, loads English and Spanish tests, checks images and both HTTP/stdio MCP, and sends one local answer through HTTP MCP. No exam result is sent to PracticaTest. The script signs out when finished. Credentials are not passed as command arguments or through files.

## Project layout

```text
app/                 Next.js / React: login, practice, history, MCP
src/shared/          Shared contracts and Zod 4 schemas
src/provider/        HTTP cookies/CSRF and PracticaTest HTML parsing
src/archive/         Persistent statistics and background image cache
src/db/              Drizzle schema, SQLite and migration setup
src/server/          NestJS, REST API, MCP and attempt management
drizzle/             SQL migrations
scripts/             Stdio bridge and interactive live check
test/                Synthetic fixtures and automated checks
```

One Node process serves the app. NestJS handles `/api/*` and `/mcp`; other requests are handled by Next.js. Website credentials enter the MCP protocol only when the user chooses the login tool; terminal and web sign-in keep them out of MCP. Question content is treated as external data, never as instructions to the AI.
