import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
export const CLOUDFLARED_VERSION = "2026.10.4";

export async function ensureCloudflared(
  onDownload: () => void,
): Promise<string> {
  if (process.env.CLOUDFLARED_PATH) {
    await exec(process.env.CLOUDFLARED_PATH, ["--version"], { timeout: 5000 });
    return process.env.CLOUDFLARED_PATH;
  }
  try {
    await exec("cloudflared", ["--version"], { timeout: 5000 });
    return "cloudflared";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      throw new Error("The installed cloudflared binary could not start.");
  }

  const platform = process.platform;
  const arch = process.arch;
  if (
    !["darwin", "linux", "win32"].includes(platform) ||
    !["arm64", "x64"].includes(arch)
  )
    throw new Error(
      "Install cloudflared and set CLOUDFLARED_PATH for this platform.",
    );
  const name = `cloudflared-${platform === "win32" ? "windows" : platform}-${arch === "x64" ? "amd64" : "arm64"}${platform === "darwin" ? ".tgz" : platform === "win32" ? ".exe" : ""}`;
  const directory = join(
    homedir(),
    ".cache",
    "practica-test-mcp",
    "cloudflared",
    CLOUDFLARED_VERSION,
    `${platform}-${arch}`,
  );
  const binary = join(
    directory,
    platform === "win32" ? "cloudflared.exe" : "cloudflared",
  );
  try {
    await access(binary, constants.X_OK);
    return binary;
  } catch {
    /* Install the official release once. */
  }
  onDownload();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const staging = await mkdtemp(join(directory, ".download-"));
  try {
    const metadata = await fetch(
      `https://api.github.com/repos/cloudflare/cloudflared/releases/tags/${CLOUDFLARED_VERSION}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "PracticaTestLocal",
        },
        signal: AbortSignal.timeout(30000),
      },
    );
    if (!metadata.ok)
      throw new Error(
        "Could not fetch the official cloudflared release metadata.",
      );
    const release = (await metadata.json()) as {
      assets: {
        name: string;
        digest: string | null;
        browser_download_url: string;
      }[];
    };
    const asset = release.assets.find((a) => a.name === name);
    if (
      !asset ||
      !/^sha256:[a-f0-9]{64}$/.test(asset.digest ?? "") ||
      !asset.browser_download_url.startsWith(
        `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/`,
      )
    )
      throw new Error(
        "The official cloudflared release has no verified asset for this platform.",
      );
    const response = await fetch(asset.browser_download_url, {
      signal: AbortSignal.timeout(120000),
    });
    if (!response.ok) throw new Error("Could not download cloudflared.");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (
      `sha256:${createHash("sha256").update(bytes).digest("hex")}` !==
      asset.digest
    )
      throw new Error("cloudflared checksum verification failed.");
    const binaryName = platform === "win32" ? "cloudflared.exe" : "cloudflared";
    const downloaded = join(
      staging,
      platform === "darwin" ? "release.tgz" : binaryName,
    );
    await writeFile(downloaded, bytes, { mode: 0o700 });
    if (platform === "darwin")
      await exec("tar", ["-xzf", downloaded, "-C", staging, "cloudflared"], {
        timeout: 30000,
      });
    const executable = join(staging, binaryName);
    await chmod(executable, 0o700);
    await exec(executable, ["--version"], { timeout: 10000 });
    await rename(executable, binary);
    return binary;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
