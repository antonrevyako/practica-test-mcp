export function localEndpoint(
  value = process.env.PRACTICA_URL ?? "http://127.0.0.1:3000",
) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("PRACTICA_URL must be a local HTTP address.");
  }
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.protocol !== "http:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["/", "/mcp", "/mcp/"].includes(url.pathname)
  ) {
    throw new Error(
      "PRACTICA_URL must be a local HTTP address without credentials or query parameters.",
    );
  }
  return new URL("/mcp", url);
}
export async function localApi(target, path, init = {}) {
  let response;
  try {
    response = await fetch(new URL(`/api/${path}`, target), {
      ...init,
      signal: AbortSignal.timeout(90000),
      redirect: "error",
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    throw new Error(
      "Cannot reach the local MCP app. Start it with npm run start:mcp and check PRACTICA_URL.",
    );
  }
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      typeof data.message === "string"
        ? data.message
        : "The local app rejected the request.",
    );
  return data;
}
export async function pairingToken(target) {
  const { token } = await localApi(target, "connection");
  if (typeof token !== "string" || token.length < 16 || token.length > 4096)
    throw new Error("The local app returned an invalid pairing token.");
  return token;
}
