import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { runtimeDirectory } from "../tunnel/runtime-paths.js";

// Set the connection identity before security.ts is loaded; account sign-out does not rotate it.
if (!process.env.MCP_TOKEN) {
  const directory = runtimeDirectory();
  const file = join(directory, "mcp-token");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    writeFileSync(file, randomBytes(32).toString("hex"), {
      mode: 0o600,
      flag: "wx",
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const token = readFileSync(file, "utf8").trim();
  if (!/^[a-f0-9]{64}$/.test(token))
    throw new Error("The saved MCP identity is invalid.");
  chmodSync(file, 0o600);
  process.env.MCP_TOKEN = token;
}
