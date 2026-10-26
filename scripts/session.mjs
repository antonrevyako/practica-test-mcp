import { hiddenPrompt } from "./terminal-input.mjs";
import { localEndpoint, localApi } from "./local-client.mjs";

try {
  const target = localEndpoint();
  const command = process.argv[2] ?? "status";
  if (command === "login") {
    // Validate connectivity before collecting credentials.
    await localApi(target, "health");
    let email = await hiddenPrompt(
      "PracticaTest email (hidden, never saved): ",
    );
    let password = await hiddenPrompt(
      "PracticaTest password (hidden, never saved): ",
    );
    try {
      const session = await localApi(target, "session", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      if (!session.authenticated)
        throw new Error("The website did not confirm authentication.");
      console.log(
        `Signed in. MCP clients can use this session until ${session.expiresAt}.`,
      );
    } finally {
      email = "";
      password = "";
    }
  } else if (command === "logout") {
    await localApi(target, "session", { method: "DELETE" });
    console.log("Signed out. The in-memory website session has been cleared.");
  } else if (command === "status") {
    const session = await localApi(target, "session");
    console.log(
      session.authenticated
        ? `Signed in until ${session.expiresAt}.`
        : "Signed out. Run npm run login.",
    );
  } else throw new Error("Use login, logout or status.");
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Session command failed.",
  );
  process.exitCode = 1;
}
