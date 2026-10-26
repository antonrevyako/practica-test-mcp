// Forward MCP stdio to the running local process; no web interface is required.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { localEndpoint, pairingToken } from "./local-client.mjs";

let target;
let token;
try {
  target = localEndpoint();
  token = process.env.MCP_TOKEN || (await pairingToken(target));
} catch (error) {
  console.error(
    error instanceof Error
      ? error.message
      : "Could not pair with the local app.",
  );
  process.exit(1);
}
const transport = new StdioServerTransport();
let pending = Promise.resolve();
transport.onmessage = (message) => {
  pending = pending
    .then(async () => {
      try {
        const send = () =>
          fetch(target, {
            method: "POST",
            signal: AbortSignal.timeout(90000),
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json, text/event-stream",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(message),
          });
        let response = await send();
        // A local process restart rotates the token; refresh without using a config file.
        if (response.status === 401 && !process.env.MCP_TOKEN) {
          await response.body?.cancel();
          token = await pairingToken(target);
          response = await send();
        }
        if (!response.ok) throw new Error("HTTP error");
        if (response.status !== 202 && message.id !== undefined)
          await transport.send(await response.json());
      } catch {
        if (message.id !== undefined)
          await transport.send({
            jsonrpc: "2.0",
            id: message.id,
            error: {
              code: -32603,
              message:
                "Cannot connect to the local MCP process. Check that it is running and PRACTICA_URL is correct.",
            },
          });
      }
    })
    .catch(() => {});
};
transport.onerror = () => console.error("MCP stdio transport error.");
await transport.start();
