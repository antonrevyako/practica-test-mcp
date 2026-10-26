"use client";
import { useEffect, useState, type FormEvent } from "react";
import { ConnectionGuides } from "./components/connection-guides";
import type {
  Answer,
  SessionStatus,
  TestLink,
  TestView,
  ManualSection,
  SectionRules,
  ConnectionInfo,
  WorkspacePreferences,
} from "../src/shared/contracts";

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    ...options,
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.message ?? "Could not complete the request.");
  return data;
}
type Attempt = {
  id: string;
  title: string;
  answered: number;
  total: number;
  correct: number;
  createdAt: string;
  syncState: string;
};
type Tab = "practice" | "mcp" | "history";
const permits = [
  "B",
  "A2-A1",
  "AM",
  "C",
  "D",
  "BE",
  "CE-DE",
  "CAP",
  "ADR",
  "puntos",
];

function Mark({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <span className={`mark ${className}`}>{children}</span>;
}
function Road() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7 3 3 21M17 3l4 18M12 3v3m0 5v3m0 5v2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function Home() {
  const [session, setSession] = useState<SessionStatus | null>(null);
  const [tab, setTab] = useState<Tab>("practice");
  const [preferences, setPreferences] = useState<WorkspacePreferences | null>(
    null,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [permit, setPermit] = useState("B");
  const [language, setLanguage] = useState<"en" | "es">("en");
  const [links, setLinks] = useState<TestLink[]>([]);
  const [sections, setSections] = useState<ManualSection[]>([]);
  const [sectionId, setSectionId] = useState("");
  const [rules, setRules] = useState<SectionRules | null>(null);
  const [run, setRun] = useState<TestView | null>(null);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [explanation, setExplanation] = useState("");
  const [history, setHistory] = useState<Attempt[]>([]);
  const [token, setToken] = useState("");
  const [copied, setCopied] = useState(false);
  const [publicUrl, setPublicUrl] = useState("");
  const [chatgptUrl, setChatgptUrl] = useState("");
  const [webUrl, setWebUrl] = useState("");
  const [webUrlCopied, setWebUrlCopied] = useState(false);
  const [tunnel, setTunnel] = useState<ConnectionInfo["tunnel"] | null>(null);
  const [urlCopied, setUrlCopied] = useState(false);
  const [claudeDesktopConfig, setClaudeDesktopConfig] = useState<string | null>(
    null,
  );

  function applyConnection(connection: ConnectionInfo) {
    setToken(connection.token);
    setPublicUrl(connection.publicUrl ?? "");
    setChatgptUrl(connection.chatgptUrl ?? "");
    setWebUrl(connection.webUrl ?? "");
    setTunnel(connection.tunnel);
    setClaudeDesktopConfig(connection.claudeDesktopConfig);
  }
  useEffect(() => {
    if (tab !== "mcp") return;
    let active = true;
    const timer = setInterval(() => {
      void api<ConnectionInfo>("connection")
        .then((connection) => {
          if (active) applyConnection(connection);
        })
        .catch(() => {});
    }, 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [tab]);
  useEffect(() => {
    setUrlCopied(false);
    setWebUrlCopied(false);
    setCopied(false);
  }, [token, publicUrl, chatgptUrl, webUrl]);

  useEffect(() => {
    api<SessionStatus>("session")
      .then(setSession)
      .catch((e) => setError(e.message));
    api<WorkspacePreferences>("preferences")
      .then(setPreferences)
      .catch((e) => setError(e.message));
    if (new URLSearchParams(window.location.search).get("tab") === "mcp") {
      void switchTab("mcp");
    }
  }, []);
  useEffect(() => {
    setSections([]);
    setSectionId("");
    setRules(null);
    if (!session?.authenticated) return;
    let active = true;
    void api<ManualSection[]>(`sections?permit=${permit}&language=${language}`)
      .then((next) => {
        if (active) {
          setSections(next);
          void api<SessionStatus>("session")
            .then((status) => {
              if (active) setSession(status);
            })
            .catch(() => {});
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [permit, language, session?.authenticated]);
  const storedOptions =
    run?.answers
      .find((a) => a.questionId === run.questions[index]?.id)
      ?.optionIds.join(",") ?? "";
  useEffect(() => {
    setSelected(storedOptions ? storedOptions.split(",") : []);
    setExplanation("");
  }, [run?.id, index, storedOptions]);
  useEffect(() => {
    if (!run?.id || !session?.authenticated || busy) return;
    let active = true;
    const runId = run.id;
    const timer = setInterval(() => {
      void api<TestView>(`attempts/${runId}`)
        .then((next) => {
          if (active)
            setRun((previous) => (previous?.id === next.id ? next : previous));
        })
        .catch(() => {});
    }, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [run?.id, session?.authenticated, busy]);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not complete the request.",
      );
      const status = await api<SessionStatus>("session").catch(() => null);
      if (status) setSession(status);
    } finally {
      setBusy(false);
    }
  }
  function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const payload = JSON.stringify({
      email: data.get("email"),
      password: data.get("password"),
    });
    form.reset();
    void action(async () => {
      setSession(
        await api<SessionStatus>("session", { method: "POST", body: payload }),
      );
    });
  }
  async function loadTests(url?: string) {
    await action(async () => {
      setLinks(
        await api<TestLink[]>(
          `tests?language=${language}&permit=${encodeURIComponent(permit)}${url ? `&url=${encodeURIComponent(url)}` : sectionId ? `&sectionId=${sectionId}` : ""}`,
        ),
      );
    });
  }
  async function start(url: string) {
    await action(async () => {
      setRules(null);
      setRun(
        await api<TestView>("attempts", {
          method: "POST",
          body: JSON.stringify({ url }),
        }),
      );
      setIndex(0);
    });
  }
  async function switchTab(next: Tab) {
    setTab(next);
    setError("");
    if (next === "mcp")
      await action(async () => {
        setToken("");
        setCopied(false);
        const connection = await api<ConnectionInfo>("connection");
        applyConnection(connection);
      });
    if (next === "history" && session?.authenticated)
      await action(async () => {
        setHistory(await api<Attempt[]>("attempts"));
      });
  }
  const question = run?.questions[index];
  const result = run?.answers.find((a) => a.questionId === question?.id);
  const complete = !!run && run.answers.length === run.questions.length;
  const config = JSON.stringify(
    {
      mcpServers: {
        practicatest: {
          url: publicUrl || "<Cloudflare URL is being generated>",
          headers: {
            Authorization: `Bearer ${token || "<token from the local UI>"}`,
          },
        },
      },
    },
    null,
    2,
  );

  const verifiedPremium =
    session?.access?.some(
      (access) =>
        access.permit === permit &&
        access.language === language &&
        access.premiumAccess === "available",
    ) ?? false;
  return (
    <div className="shell">
      <header className="header">
        <a className="brand" href="/" aria-label="Practica home">
          <span className="logo">
            <Road />
          </span>
          practica<span className="local">LOCAL</span>
        </a>
        <div className="header-right">
          <span className="private">
            <span className="dot" />
            On your device
          </span>
          <span className="header-divider" />
          <span className="avatar">P</span>
        </div>
      </header>
      <main>
        <div className="intro">
          <div>
            <div className="eyebrow">YOUR ROAD TO A DRIVING LICENCE</div>
            <h1>Practice with purpose.</h1>
            <p>PracticaTest questions, your own pace, and a little AI help.</p>
          </div>
          <div className="intro-badge">
            <Road />
            <span>
              Small steps.
              <br />
              <strong>Confidence behind the wheel.</strong>
            </span>
          </div>
        </div>
        <div className="toolbar">
          <nav aria-label="Sections">
            <button
              className={tab === "practice" ? "active" : ""}
              onClick={() => void switchTab("practice")}
            >
              Practice
            </button>
            <button
              className={tab === "history" ? "active" : ""}
              onClick={() => void switchTab("history")}
            >
              History
            </button>
            <button
              className={tab === "mcp" ? "active" : ""}
              onClick={() => void switchTab("mcp")}
            >
              MCP connection <span className="mini-tag">AI</span>
            </button>
          </nav>
          <div className="toolbar-account">
            {(verifiedPremium || preferences?.premiumPurchased) && (
              <span
                className="premium-badge"
                title={
                  verifiedPremium
                    ? "Topic-test access confirmed by PracticaTest for the selected language and category"
                    : "Purchase marked for this local workspace"
                }
              >
                <span aria-hidden="true">★</span>{" "}
                {verifiedPremium
                  ? "Premium access verified"
                  : "Premium purchased"}
              </span>
            )}
            <span
              className={`status ${session?.authenticated ? "connected" : ""}`}
            >
              <span className="dot" />
              {session === null
                ? "Connecting…"
                : session.authenticated
                  ? "PracticaTest connected"
                  : "Not connected"}
            </span>
          </div>
        </div>
        {error && (
          <div className="error" role="alert">
            <span>{error}</span>
            <button aria-label="Dismiss message" onClick={() => setError("")}>
              ×
            </button>
          </div>
        )}

        {tab === "mcp" ? (
          <div className="mcp-layout">
            <section className="card mcp-card">
              <Mark>↗</Mark>
              <div className="eyebrow">YOUR AI STUDY PARTNER</div>
              <h2>Make practice a conversation.</h2>
              <p>
                Follow the ChatGPT or Claude Desktop guide to connect, then
                practise in chat. Sign in from the Practice tab, CLI or MCP.
              </p>
              <div className="endpoint">
                <span>
                  CLOUDFLARE HTTPS ·{" "}
                  {tunnel?.status.toUpperCase() ?? "STARTING"}
                </span>
                <code>
                  {chatgptUrl ||
                    publicUrl ||
                    (tunnel?.status === "installing"
                      ? "Installing Cloudflare connector…"
                      : tunnel?.status === "disabled"
                        ? "Cloudflare Tunnel is disabled."
                        : "Creating a public MCP link…")}
                </code>
              </div>
              {chatgptUrl && (
                <>
                  <button
                    className="secondary full"
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        await navigator.clipboard.writeText(chatgptUrl);
                        setUrlCopied(true);
                        setTimeout(() => setUrlCopied(false), 2500);
                      })
                    }
                  >
                    {urlCopied
                      ? "Server URL copied ✓"
                      : "Copy public server URL"}
                  </button>
                  <p className="small tunnel-note">
                    Use the full URL in either client. It already contains a
                    private access key, so no separate OAuth sign-in is needed.
                    Keep this app running while you practise.
                  </p>
                </>
              )}
              {webUrl && (
                <div className="remote-interface">
                  <div className="endpoint">
                    <span>PRIVATE WEB INTERFACE · OPEN FROM YOUR PHONE</span>
                    <code>{webUrl}</code>
                  </div>
                  <div className="remote-interface-actions">
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        void action(async () => {
                          await navigator.clipboard.writeText(webUrl);
                          setWebUrlCopied(true);
                          setTimeout(() => setWebUrlCopied(false), 2500);
                        })
                      }
                    >
                      {webUrlCopied
                        ? "Interface link copied ✓"
                        : "Copy private interface URL"}
                    </button>
                    <a
                      className="secondary"
                      href={webUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open interface ↗
                    </a>
                  </div>
                  <p className="small tunnel-note">
                    Open this link to use the interface away from your computer.
                    It grants access to your app and account controls, so keep
                    it private. The computer or Docker container must stay
                    running.
                  </p>
                </div>
              )}
              {tunnel?.error && (
                <div className="tunnel-error" role="alert">
                  <p>{tunnel.error}</p>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        await api("tunnel", { method: "POST" });
                        applyConnection(
                          await api<ConnectionInfo>("connection"),
                        );
                      })
                    }
                  >
                    Retry Cloudflare Tunnel
                  </button>
                </div>
              )}
              <div className="code-title">
                <strong>Other HTTP clients · Bearer token</strong>
                <button
                  className="text-button"
                  disabled={!token || !publicUrl || tunnel?.status !== "ready"}
                  onClick={() =>
                    void action(async () => {
                      await navigator.clipboard.writeText(config);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    })
                  }
                >
                  {copied ? "Copied ✓" : "Copy"}
                </button>
              </div>
              <pre>{config}</pre>
              <p className="small">
                This token grants access to the local app and is saved privately
                on this device. It survives restarts. Your account credentials
                are never included.
              </p>
              <p className="small">
                You can sign in through the MCP login tool or{" "}
                <code>npm run login</code> as well as this interface.
              </p>
            </section>
            <ConnectionGuides
              publicUrl={chatgptUrl}
              desktopConfig={claudeDesktopConfig}
              onError={setError}
            />
          </div>
        ) : !session?.authenticated ? (
          <div className="welcome-grid">
            <section className="card login-card">
              <Mark>↪</Mark>
              <h2>Connect to PracticaTest</h2>
              <p>
                Sign in to your account to access your tests and start
                practising.
              </p>
              {session?.credentialsRemembered && (
                <button
                  className="secondary full"
                  disabled={busy}
                  onClick={() =>
                    void action(async () =>
                      setSession(await api<SessionStatus>("session")),
                    )
                  }
                >
                  Retry saved sign-in
                </button>
              )}
              <form onSubmit={login} autoComplete="off">
                <label>
                  Email
                  <input
                    name="email"
                    type="email"
                    placeholder="you@example.com"
                    required
                    autoComplete="off"
                    disabled={busy}
                  />
                </label>
                <label>
                  Password
                  <input
                    name="password"
                    type="password"
                    placeholder="Your PracticaTest password"
                    required
                    autoComplete="off"
                    disabled={busy}
                  />
                </label>
                <button
                  className="primary full"
                  disabled={busy || session === null}
                >
                  {busy ? "Connecting…" : "Connect account"}
                  <span>→</span>
                </button>
              </form>
              <div className="privacy-note">
                <span>◇</span>
                <span>
                  By default, your email, password and session are saved
                  encrypted on this device. Expired sessions are restored
                  automatically. Sign out to delete saved sign-in details.
                </span>
              </div>
            </section>
            <section className="welcome-panel">
              <div className="road-art" aria-hidden="true">
                <div className="art-orbit one" />
                <div className="art-orbit two" />
                <div className="road-sign">
                  <Road />
                </div>
                <span className="art-pill">UN PASO MÁS CERCA</span>
              </div>
              <div className="eyebrow">LEARN AT YOUR OWN PACE</div>
              <h2>
                More than
                <br />
                the right answer.
              </h2>
              <p>
                Understand the situation, notice the details, and revisit the
                tricky questions.
              </p>
              <div className="features">
                <span>
                  <b>01</b> Original questions
                </span>
                <span>
                  <b>02</b> Feedback and explanations
                </span>
                <span>
                  <b>03</b> Conversations with MCP
                </span>
              </div>
            </section>
          </div>
        ) : tab === "history" ? (
          <section className="card history-card">
            <div className="section-heading">
              <div>
                <div className="eyebrow">ONE STEP AT A TIME</div>
                <h2>Your practice</h2>
              </div>
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void action(async () =>
                    setHistory(await api<Attempt[]>("attempts")),
                  )
                }
              >
                Refresh
              </button>
            </div>
            {!history.length ? (
              <p className="empty">
                Your tests will appear here. Start with your first question.
              </p>
            ) : (
              <div className="history-list">
                {history.map((h) => (
                  <button
                    className="history-row"
                    key={h.id}
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        setRun(await api<TestView>(`attempts/${h.id}`));
                        setIndex(0);
                        setTab("practice");
                      })
                    }
                  >
                    <span>
                      <strong>{h.title}</strong>
                      <small>
                        {new Date(h.createdAt).toLocaleString("en-GB")}
                      </small>
                    </span>
                    <span>
                      {h.answered}/{h.total} answers
                    </span>
                    <span className="score">{h.correct} correct</span>
                    <span>→</span>
                  </button>
                ))}
              </div>
            )}
            <p className="small">
              History stays in SQLite on this device. This app is designed for a
              single user.
            </p>
          </section>
        ) : (
          <div className="study-layout">
            <aside className="card source-panel">
              <div className="eyebrow">QUESTION SOURCE</div>
              <h3>Choose your route</h3>
              <label>
                Question language
                <select
                  value={language}
                  disabled={busy}
                  onChange={(e) => {
                    const next = e.target.value as "en" | "es";
                    setLanguage(next);
                    if (next === "en") setPermit("B");
                    setLinks([]);
                  }}
                >
                  <option value="en">English · Spain · B</option>
                  <option value="es">Spanish · Spain</option>
                </select>
              </label>
              <label>
                Licence category
                <select
                  value={permit}
                  disabled={busy}
                  onChange={(e) => {
                    setPermit(e.target.value);
                    if (e.target.value !== "B") setLanguage("es");
                    setLinks([]);
                  }}
                >
                  {permits.map((p) => (
                    <option key={p} value={p}>
                      {p === "puntos" ? "Points recovery" : `Permiso ${p}`}
                    </option>
                  ))}
                </select>
              </label>

              <label className="section-select">
                Test selection
                <select
                  value={sectionId}
                  disabled={busy}
                  onChange={(e) => {
                    setSectionId(e.target.value);
                    setLinks([]);
                    setRules(null);
                  }}
                >
                  <option value="">General exams · all topics</option>
                  {sections.map((section) => (
                    <option value={section.id} key={section.id}>
                      {section.number}. {section.title}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="primary full"
                disabled={busy}
                onClick={() => void loadTests()}
              >
                {busy ? "Loading…" : "Find tests"}
                <span>→</span>
              </button>
              <button
                className="secondary full"
                disabled={busy || !sectionId}
                onClick={() =>
                  void action(async () => {
                    setRules(
                      await api<SectionRules>(
                        `sections/${sectionId}/rules?permit=${permit}&language=${language}`,
                      ),
                    );
                  })
                }
              >
                Read section rules ↗
              </button>
              {sectionId &&
                !sections.find((s) => s.id === sectionId)?.testUrl && (
                  <p className="small section-note">
                    Topic tests are not included in the access currently
                    provided by your PracticaTest account.
                  </p>
                )}
              <div className="source-links">
                {links.map((link) => (
                  <div key={link.url}>
                    <button
                      disabled={busy}
                      onClick={() => void start(link.url)}
                    >
                      {link.title}
                      <span>↗</span>
                    </button>
                    <button
                      className="text-button small"
                      disabled={busy}
                      onClick={() => void loadTests(link.url)}
                    >
                      Browse this test listing
                    </button>
                  </div>
                ))}
              </div>
              <form
                className="url-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const url = String(new FormData(e.currentTarget).get("url"));
                  void start(url);
                }}
              >
                <label>
                  Or open a specific test URL
                  <input
                    name="url"
                    type="url"
                    placeholder="https://practicatest.com/en"
                    required
                    disabled={busy}
                  />
                </label>
                <button className="secondary full" disabled={busy}>
                  Open test
                </button>
              </form>
              <button
                className="secondary full refresh-access"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    const status = await api<SessionStatus>(
                      `account/access?permit=${permit}&language=${language}`,
                    );
                    setSession(status);
                    setSections(
                      await api<ManualSection[]>(
                        `sections?permit=${permit}&language=${language}`,
                      ),
                    );
                    setLinks(
                      await api<TestLink[]>(
                        `tests?permit=${permit}&language=${language}`,
                      ),
                    );
                  })
                }
              >
                Refresh account access
              </button>
              <label className="premium-setting">
                <input
                  type="checkbox"
                  checked={preferences?.premiumPurchased ?? false}
                  disabled={busy || !preferences}
                  onChange={(event) => {
                    const premiumPurchased = event.currentTarget.checked;
                    void action(async () =>
                      setPreferences(
                        await api<WorkspacePreferences>("preferences", {
                          method: "PATCH",
                          body: JSON.stringify({ premiumPurchased }),
                        }),
                      ),
                    );
                  }}
                />
                <span>
                  <strong>Premium purchased</strong>
                  <small>Purchase marker saved on this device</small>
                </span>
              </label>
              <div className="account-note">
                <span className="dot" />
                Account connected
                <button
                  disabled={busy}
                  className="text-button"
                  onClick={() =>
                    void action(async () => {
                      setSession(
                        await api<SessionStatus>("session", {
                          method: "DELETE",
                        }),
                      );
                      setRun(null);
                      setLinks([]);
                      setHistory([]);
                    })
                  }
                >
                  Sign out
                </button>
              </div>
              {session.credentialsRemembered && (
                <p className="small">
                  Email and password saved encrypted on this device. Sign out
                  to forget them.
                </p>
              )}
            </aside>
            <section className="question-area">
              {rules ? (
                <article
                  className="card rules-card"
                  lang={rules.section.language}
                >
                  <div className="eyebrow">
                    SECTION {rules.section.number} · {rules.mode.toUpperCase()}
                  </div>
                  <h2>{rules.title}</h2>
                  <p className="small">
                    <a href={rules.url} target="_blank" rel="noreferrer">
                      Read on PracticaTest ↗
                    </a>
                  </p>
                  <div className="rules-text">{rules.text}</div>
                  {rules.tables.map((rows, i) => (
                    <div className="rules-table" key={i}>
                      <table>
                        <tbody>
                          {rows.map((cells, j) => (
                            <tr key={j}>
                              {cells.map((cell, k) => (
                                <td key={k}>{cell}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                  {rules.images.map((image, i) => (
                    <figure key={`${image.url}-${i}`}>
                      <img
                        src={image.url}
                        alt={image.alt || "Section illustration"}
                        referrerPolicy="no-referrer"
                      />
                      {image.alt && <figcaption>{image.alt}</figcaption>}
                    </figure>
                  ))}
                  <div className="question-actions">
                    <button
                      className="secondary"
                      onClick={() => setRules(null)}
                    >
                      ← Back to practice
                    </button>
                    {rules.section.testUrl && (
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() => void start(rules.section.testUrl!)}
                      >
                        Practise this section →
                      </button>
                    )}
                  </div>
                </article>
              ) : run && question ? (
                <>
                  <div className="card progress-card">
                    <div className="progress-top">
                      <span>CURRENT TEST</span>
                      <span>
                        {run.answers.length} of {run.questions.length} answered
                      </span>
                    </div>
                    <h3>{run.title}</h3>
                    <div className="progress-track">
                      <div
                        style={{
                          width: `${(100 * run.answers.length) / run.questions.length}%`,
                        }}
                      />
                    </div>
                    <div
                      className="question-dots"
                      aria-label="Question navigation"
                    >
                      {run.questions.map((q, i) => {
                        const answer = run.answers.find(
                          (a) => a.questionId === q.id,
                        );
                        const status = answer
                          ? answer.correct
                            ? "correct"
                            : "incorrect"
                          : "unanswered";
                        const label = `Question ${i + 1}: ${answer ? (answer.correct ? "Correct answer" : "Incorrect answer") : "Unanswered"}`;
                        return (
                          <button
                            key={q.id}
                            className={`${i === index ? "current" : ""} ${status}`}
                            onClick={() => setIndex(i)}
                            aria-label={label}
                            aria-current={i === index ? "step" : undefined}
                            title={label}
                          >
                            {i + 1}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <article className="card question-card">
                    <div className="question-top">
                      <span className="eyebrow">
                        QUESTION {index + 1} / {run.questions.length}
                      </span>
                      <span className="category">
                        {run.permit} · {run.language.toUpperCase()}
                      </span>
                    </div>
                    <h2 lang={run.language}>{question.text}</h2>
                    {question.imageUrl && (
                      <div className="question-image">
                        <img
                          src={question.imageUrl}
                          alt="Road situation illustration for this question"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                    )}
                    <p className="small">
                      {question.multiple
                        ? "Choose all correct options."
                        : "Choose one answer."}
                    </p>
                    <div className="options" lang={run.language}>
                      {question.options.map((o) => (
                        <button
                          key={o.id}
                          disabled={
                            busy || run.syncState !== "local" || !!result
                          }
                          className={`option ${selected.includes(o.id) ? "selected" : ""} ${result?.correctOptionIds.includes(o.id) ? "right" : result?.optionIds.includes(o.id) ? "wrong" : ""}`}
                          onClick={() =>
                            setSelected((old) =>
                              question.multiple
                                ? old.includes(o.id)
                                  ? old.filter((id) => id !== o.id)
                                  : [...old, o.id]
                                : [o.id],
                            )
                          }
                        >
                          <span className="option-letter">{o.id}</span>
                          <span>{o.text}</span>
                          {result?.correctOptionIds.includes(o.id) && (
                            <span className="option-check">✓</span>
                          )}
                        </button>
                      ))}
                    </div>
                    {result && (
                      <div
                        className={`feedback ${result.correct ? "success" : ""}`}
                        role="status"
                      >
                        <strong>
                          {result.correct
                            ? "Correct. Keep up the momentum."
                            : `Correct answer: ${result.correctOptionIds.join(", ")}.`}
                        </strong>
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() =>
                            void action(async () => {
                              setExplanation(
                                (
                                  await api<{ text: string | null }>(
                                    `attempts/${run.id}/explanation/${question.id}`,
                                  )
                                ).text ??
                                  "No explanation is available for this question.",
                              );
                            })
                          }
                        >
                          Website explanation ↗
                        </button>
                        {explanation && (
                          <p lang={run.language}>{explanation}</p>
                        )}
                      </div>
                    )}
                    <div className="question-actions">
                      <button
                        className="secondary"
                        disabled={index === 0 || busy}
                        onClick={() => setIndex((i) => i - 1)}
                      >
                        ← Back
                      </button>
                      {!result ? (
                        <button
                          className="primary"
                          disabled={
                            !selected.length ||
                            busy ||
                            run.syncState !== "local"
                          }
                          onClick={() =>
                            void action(async () => {
                              const answer = await api<Answer>(
                                `attempts/${run.id}/answers`,
                                {
                                  method: "POST",
                                  body: JSON.stringify({
                                    questionId: question.id,
                                    optionIds: selected,
                                  }),
                                },
                              );
                              setRun({
                                ...run,
                                answers: [
                                  ...run.answers.filter(
                                    (a) => a.questionId !== question.id,
                                  ),
                                  answer,
                                ],
                              });
                            })
                          }
                        >
                          Check answer →
                        </button>
                      ) : (
                        <button
                          className="primary"
                          disabled={index === run.questions.length - 1 || busy}
                          onClick={() => setIndex((i) => i + 1)}
                        >
                          Next question →
                        </button>
                      )}
                    </div>
                  </article>
                  {complete && (
                    <div className="card completion">
                      <Mark>✓</Mark>
                      <div>
                        <h3>Test complete</h3>
                        <p>
                          {run.answers.filter((a) => a.correct).length} of{" "}
                          {run.questions.length} correct. Your answers are saved
                          on this device.
                        </p>
                        <p className="small">
                          {run.syncState === "submitted"
                            ? "Result submitted to PracticaTest."
                            : run.syncState === "uncertain" ||
                                run.syncState === "sending"
                              ? "Submission status is unknown. Check the result on the website."
                              : "Submitting updates your PracticaTest statistics."}
                        </p>
                      </div>
                      <button
                        className="primary"
                        disabled={busy || run.syncState !== "local"}
                        onClick={() =>
                          void action(async () => {
                            const result = await api<{ test: TestView }>(
                              `attempts/${run.id}/finish`,
                              { method: "POST" },
                            );
                            setRun(result.test);
                          })
                        }
                      >
                        {run.syncState === "submitted"
                          ? "Submitted ✓"
                          : "Submit to website"}
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="card empty-state">
                  <Mark>
                    <Road />
                  </Mark>
                  <div className="eyebrow">ONE QUESTION AT A TIME</div>
                  <h2>
                    Your next step:
                    <br />
                    start practising.
                  </h2>
                  <p>
                    Choose a category on the left and open a test.
                    <br />
                    Questions will appear here, with progress saved locally.
                  </p>
                  <div className="empty-tags">
                    <span>Original illustrations</span>
                    <span>Answers with explanations</span>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}
        <footer>
          <span>
            practica local <span className="footer-dot">·</span> Your own space
            to practise
          </span>
          <a href="https://practicatest.com/" target="_blank" rel="noreferrer">
            Questions provided by PracticaTest ↗
          </a>
        </footer>
      </main>
    </div>
  );
}
