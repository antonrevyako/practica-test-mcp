"use client";

import { useEffect, useState } from "react";

const practicePrompt = `Use the PracticaTest MCP tools. First call session_status. If I am signed out, ask me to sign in using the local app, CLI or MCP login. For this active session, use permit B and language en. Offer a general test or a section-specific test, and retrieve section rules when requested. Ask one question at a time. After my answer, call submit_answer once and show its feedback and nextQuestion immediately. Fetch the website explanation only if I ask for it. Do not call finish_test unless I explicitly ask to submit.`;

export function ConnectionGuides({
  publicUrl,
  desktopConfig,
  onError,
}: {
  publicUrl: string;
  desktopConfig: string | null;
  onError: (message: string) => void;
}) {
  const [copied, setCopied] = useState("");
  useEffect(() => setCopied(""), [publicUrl, desktopConfig]);

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
    } catch {
      onError(
        "Could not copy. Select the displayed text and copy it manually.",
      );
    }
  }

  return (
    <aside className="connection-guides" aria-label="MCP connection guides">
      <section className="card guide" aria-labelledby="chatgpt-guide">
        <div className="eyebrow">PUBLIC HTTPS · STREAMABLE HTTP</div>
        <h3 id="chatgpt-guide">Connect ChatGPT</h3>
        <p className="small">
          Use ChatGPT on the web. Keep this app and its Cloudflare tunnel
          running.
        </p>
        <ol>
          <li>
            Open{" "}
            <a
              href="https://chatgpt.com/plugins"
              target="_blank"
              rel="noreferrer"
            >
              ChatGPT Plugins
            </a>
            . Select <strong>+</strong>, then{" "}
            <strong>Add custom MCP server</strong>.
          </li>
          <li>
            Enter <strong>PracticaTest</strong> as the name. Choose{" "}
            <strong>Server URL</strong>, then paste the full public URL from
            this page, including its access key.
          </li>
          <li>
            Set authentication to <strong>No authentication</strong>. If a
            transport field appears, choose <strong>Streamable HTTP</strong>.
            Review the warning and choose
            <strong> Create as a plugin</strong>.
          </li>
          <li>
            Open the new entry in{" "}
            <a
              href="https://chatgpt.com/plugins?view=personal"
              target="_blank"
              rel="noreferrer"
            >
              your personal plugins
            </a>{" "}
            and install it. Start a new <strong>Work</strong> chat, type{" "}
            <strong>@</strong> and select <strong>PracticaTest</strong>.
          </li>
          <li>
            Ask: <strong>Use PracticaTest to call session_status.</strong> A
            successful tool result confirms the connection. Then paste the
            session instructions.
          </li>
        </ol>
        <button
          className="secondary full"
          disabled={!publicUrl}
          onClick={() => void copy(publicUrl, "chatgpt-url")}
        >
          {copied === "chatgpt-url"
            ? "ChatGPT URL copied ✓"
            : "Copy URL for ChatGPT"}
        </button>
        <p className="small guide-note">
          A chat prompt cannot add or install its own MCP server. If the menu is
          missing, check your account and workspace permissions. After
          restarting this app, update the plugin with the new URL and refresh
          its tools.
        </p>
        <a
          className="guide-source"
          href="https://developers.openai.com/api/docs/guides/custom-mcp-server"
          target="_blank"
          rel="noreferrer"
        >
          Official ChatGPT setup guide ↗
        </a>
      </section>

      <section className="card guide" aria-labelledby="claude-guide">
        <div className="eyebrow">PUBLIC LINK · WORKS WITH DOCKER</div>
        <h3 id="claude-guide">Connect Claude Desktop</h3>
        <p className="small">
          The public connector uses the same Cloudflare URL and also works in
          Claude on the web.
        </p>
        <ol>
          <li>
            Open <strong>Customize → Connectors</strong> in Claude Desktop.
            Older layouts use <strong>Settings → Connectors</strong>.
          </li>
          <li>
            Select <strong>+ Add → Add custom connector</strong>. Name it
            <strong> PracticaTest</strong>, paste the full URL copied below and
            continue.
          </li>
          <li>
            Review authentication and choose <strong>No sign in</strong>. The
            URL already contains this app&apos;s access key; no OAuth client or
            request headers are needed. Complete setup with <strong>Add</strong>{" "}
            and connect it if prompted.
          </li>
          <li>
            Start a chat. Open <strong>+ → Connectors</strong> beside the
            message box and enable <strong>PracticaTest</strong>.
          </li>
          <li>
            Ask Claude to call <strong>session_status</strong> using
            PracticaTest, then paste the practice prompt below. Keep the app
            running.
          </li>
        </ol>
        <button
          className="secondary full"
          disabled={!publicUrl}
          onClick={() => void copy(publicUrl, "claude-url")}
        >
          {copied === "claude-url"
            ? "Claude URL copied ✓"
            : "Copy URL for Claude Desktop"}
        </button>
        <p className="small guide-note">
          Remote connectors connect from Claude&apos;s servers, so localhost
          URLs will not work here. Team and Enterprise accounts may need an
          owner to add the connector. Update its URL after this app or tunnel
          restarts.
        </p>
        <a
          className="guide-source"
          href="https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp"
          target="_blank"
          rel="noreferrer"
        >
          Official Claude connector guide ↗
        </a>

        <details className="local-guide">
          <summary>
            Alternative: local Desktop connection without a tunnel
          </summary>
          <p className="small">
            This option uses Node.js and the local stdio bridge on the same
            computer. Start the app first. Claude starts only the bridge, which
            pairs with the running app automatically. No account password or MCP
            token goes into the config.
          </p>
          <ol>
            <li>
              In Claude Desktop, open{" "}
              <strong>Settings → Developer → Edit Config</strong>.
            </li>
            <li>
              Copy the configuration below into{" "}
              <code>claude_desktop_config.json</code>. If you already have other
              servers, merge only the <code>practicatest</code> entry into the
              existing <code>mcpServers</code> object.
            </li>
            <li>
              Save, fully quit and reopen Claude Desktop. Enable PracticaTest
              from the chat&apos;s connectors menu and call{" "}
              <strong>session_status</strong>.
            </li>
          </ol>
          {desktopConfig ? (
            <>
              <button
                className="secondary full"
                onClick={() => void copy(desktopConfig, "claude-config")}
              >
                {copied === "claude-config"
                  ? "Desktop config copied ✓"
                  : "Copy local Claude Desktop config"}
              </button>
              <pre>{desktopConfig}</pre>
              <p className="small">
                Uses this computer&apos;s absolute Node.js and bridge paths and
                the current local port. Copy it again if you move the project or
                change the port.
              </p>
            </>
          ) : (
            <p className="small guide-note">
              A local configuration is available when the app runs natively on
              your computer. For Docker, use the public connector above;
              container paths cannot be used as Claude Desktop commands.
            </p>
          )}
          <p className="small config-paths">
            macOS:{" "}
            <code>
              ~/Library/Application Support/Claude/claude_desktop_config.json
            </code>
            <br />
            Windows: <code>%APPDATA%\Claude\claude_desktop_config.json</code>
          </p>
          <a
            className="guide-source"
            href="https://modelcontextprotocol.io/docs/develop/connect-local-servers"
            target="_blank"
            rel="noreferrer"
          >
            Official local Desktop setup ↗
          </a>
        </details>
      </section>

      <section className="card guide" aria-labelledby="practice-guide">
        <div className="eyebrow">AFTER CONNECTING EITHER CLIENT</div>
        <h3 id="practice-guide">Start practising</h3>
        <p className="small">
          Sign in through the Practice tab or run <code>npm run login</code> in
          the project directory. The MCP <code>login</code> tool is also
          available if you choose to send your credentials through chat. All
          methods share the same session.
        </p>
        <div className="quote">{practicePrompt}</div>
        <button
          className="secondary full"
          onClick={() => void copy(practicePrompt, "practice-prompt")}
        >
          {copied === "practice-prompt"
            ? "Practice prompt copied ✓"
            : "Copy practice prompt"}
        </button>
        <p className="small guide-note">
          Answer checks are local. Website explanations are fetched separately
          when requested. Only <code>finish_test</code> sends the completed exam
          to PracticaTest.
        </p>
      </section>
      <section className="card guide" aria-labelledby="archive-guide">
        <div className="eyebrow">SAVED ON THIS COMPUTER</div>
        <h3 id="archive-guide">Your question and answer archive</h3>
        <p className="small guide-note">
          Questions, option order, chosen and correct answers are saved to
          SQLite. Changing an answer adds a history event. Question images
          download in the background and are kept locally.
        </p>
        <ul className="archive-tools">
          <li>
            <code>get_statistics</code> — totals, accuracy and image-cache
            progress.
          </li>
          <li>
            <code>list_recorded_questions</code> — wording, options, last
            answers and mistakes.
          </li>
          <li>
            <code>get_answer_history</code> — every saved answer and correction.
          </li>
          <li>
            <code>get_recorded_question_image</code> — read a downloaded image.
          </li>
          <li>
            <code>cache_recorded_images</code> — retry missing images after
            signing in.
          </li>
        </ul>
        <p className="small">
          The archive and saved images remain available through MCP after
          sign-out. Correct options stay hidden until a question has been
          answered. Existing attempts are imported once using their last saved
          answers.
        </p>
      </section>
      <span className="small copy-status" role="status" aria-live="polite">
        {copied ? "Copied to clipboard." : ""}
      </span>
    </aside>
  );
}
