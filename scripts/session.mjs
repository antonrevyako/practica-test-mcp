import { hiddenPrompt } from "./terminal-input.mjs";
import { localEndpoint, localApi } from "./local-client.mjs";

try {
  const target = localEndpoint();
  const command = process.argv[2] ?? "status";
  if (command === "login") {
    // Validate connectivity before collecting credentials.
    await localApi(target, "health");
    console.log(
      "By default, successful sign-in saves encrypted credentials on this device. Sign out to delete them.",
    );
    let email = await hiddenPrompt(
      "PracticaTest email (hidden): ",
    );
    let password = await hiddenPrompt(
      "PracticaTest password (hidden): ",
    );
    try {
      const session = await localApi(target, "session", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      if (!session.authenticated)
        throw new Error("The website did not confirm authentication.");
      console.log(
        session.credentialsRemembered
          ? "Signed in. Email, password and session are saved encrypted; expired sessions can be restored automatically."
          : session.remembered
          ? "Signed in. The session is remembered; email and password are not saved."
          : "Signed in. This session is kept in memory only.",
      );
    } finally {
      email = "";
      password = "";
    }
  } else if (command === "logout") {
    await localApi(target, "session", { method: "DELETE" });
    console.log(
      "Signed out. Saved email, password, website session and encryption key have been cleared.",
    );
  } else if (command === "status") {
    const session = await localApi(target, "session");
    console.log(
      session.authenticated
        ? session.credentialsRemembered
          ? "Signed in. Encrypted sign-in details are saved for automatic session recovery."
          : session.remembered
          ? "Signed in. Session is remembered across restarts."
          : "Signed in. Session is kept in memory only."
        : "Signed out. Run npm run login.",
    );
  } else throw new Error("Use login, logout or status.");
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Session command failed.",
  );
  process.exitCode = 1;
}
