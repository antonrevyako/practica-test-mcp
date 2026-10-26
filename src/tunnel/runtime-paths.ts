import { dirname, resolve, join } from "node:path";
import { readFileSync } from "node:fs";

export function runtimeDirectory() {
  return dirname(
    resolve(process.env.DATABASE_PATH ?? "./data/practica.sqlite"),
  );
}
export function registryPath() {
  return join(runtimeDirectory(), "tunnel-runtime.json");
}
export type TunnelRegistry = {
  version: 1;
  pid: number;
  port: number;
  token: string;
};
export function readRegistry(): TunnelRegistry | null {
  try {
    const value = JSON.parse(readFileSync(registryPath(), "utf8"));
    if (
      value.version !== 1 ||
      !Number.isInteger(value.pid) ||
      value.pid < 1 ||
      !Number.isInteger(value.port) ||
      value.port < 1 ||
      value.port > 65535 ||
      !/^[a-f0-9]{64}$/.test(value.token)
    )
      return null;
    return value;
  } catch {
    return null;
  }
}
