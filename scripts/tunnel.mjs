import { readFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";

try {
  const command = process.argv[2] ?? "status";
  if (!["status", "stop", "restart"].includes(command))
    throw new Error("Use status, stop or restart.");
  if (
    command === "stop" &&
    (process.env.TUNNEL_SERVICE_URL ||
      process.env.TUNNEL_BIND_HOST === "0.0.0.0")
  )
    throw new Error(
      "Use docker compose stop tunnel to stop the tunnel container.",
    );
  const directory = dirname(
    resolve(process.env.DATABASE_PATH ?? "./data/practica.sqlite"),
  );
  let registry;
  try {
    registry = JSON.parse(
      readFileSync(join(directory, "tunnel-runtime.json"), "utf8"),
    );
  } catch {
    throw new Error("The independent tunnel is not running.");
  }
  if (
    registry.version !== 1 ||
    !Number.isInteger(registry.port) ||
    registry.port < 1 ||
    registry.port > 65535 ||
    !/^[a-f0-9]{64}$/.test(registry.token)
  )
    throw new Error("The tunnel registry is invalid.");
  const base = new URL(
    process.env.TUNNEL_SERVICE_URL ?? `http://127.0.0.1:${registry.port}`,
  );
  if (
    base.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]", "tunnel"].includes(base.hostname) ||
    base.username ||
    base.password ||
    base.pathname !== "/" ||
    base.search ||
    base.hash
  )
    throw new Error("Invalid tunnel service address.");
  const response = await fetch(new URL(`/${command}`, base), {
    method: command === "status" ? "GET" : "POST",
    redirect: "error",
    signal: AbortSignal.timeout(5000),
    headers: { Authorization: `Bearer ${registry.token}` },
  });
  if (!response.ok) throw new Error("The tunnel process rejected the command.");
  const value = await response.json();
  if (command === "status") {
    if (value.service !== "practica-test-tunnel" || value.version !== 1)
      throw new Error("Tunnel protocol is unsupported.");
    console.log(
      JSON.stringify(
        { pid: value.pid, backendPort: value.backendPort, ...value.status },
        null,
        2,
      ),
    );
  } else
    console.log(
      command === "stop"
        ? "The independent tunnel is stopping. Its public links will no longer work."
        : "The tunnel is restarting. Copy its new public links when ready.",
    );
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Tunnel command failed.",
  );
  process.exitCode = 1;
}
