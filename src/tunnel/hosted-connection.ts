import type { TunnelStatus } from "./cloudflare-tunnel.js";

/** Explicit operator configuration only: never derive public links from request headers. */
export function hostedConnection(
  env: Record<string, string | undefined>,
  webEnabled = true,
): TunnelStatus | null {
  if (env.HOSTED_PUBLIC_URL === undefined) return null;
  try {
    const url = new URL(env.HOSTED_PUBLIC_URL);
    if (
      url.protocol !== "https:" || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash ||
      !/^[a-f0-9]{64}$/.test(env.HOSTED_ACCESS_KEY ?? "") ||
      (env.HOSTED_WEB_ACCESS_KEY !== undefined &&
        !/^[a-f0-9]{64}$/.test(env.HOSTED_WEB_ACCESS_KEY))
    ) throw new Error("Invalid configuration");
    return {
      provider: "hosted",
      status: "ready",
      publicUrl: `${url.origin}/mcp`,
      chatgptUrl: `${url.origin}/mcp/${env.HOSTED_ACCESS_KEY}`,
      webUrl: webEnabled && env.HOSTED_WEB_ACCESS_KEY
        ? `${url.origin}/app/${env.HOSTED_WEB_ACCESS_KEY}` : null,
      error: null,
    };
  } catch {
    // Configuration can contain secrets; never echo input or URL parser errors.
    return {
      provider: "hosted", status: "error", publicUrl: null,
      chatgptUrl: null, webUrl: null,
      error: "Invalid hosted connection configuration. Check the HTTPS origin and gateway access keys in the server environment.",
    };
  }
}
