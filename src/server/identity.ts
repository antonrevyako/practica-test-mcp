import { randomBytes } from "node:crypto";

export const localToken =
  process.env.MCP_TOKEN || randomBytes(32).toString("hex");
