import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { siteUrl } from "../provider/parser.js";
import { AppError } from "../server/errors.js";

export type StoredImage = { mimeType: string; data: string };
const formats: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};
type Job = {
  url: string;
  key: string;
  controller: AbortController;
  resolve: () => void;
  reject: (error: unknown) => void;
};

export class ImageCache {
  private memory = new Map<string, StoredImage>();
  private pending = new Map<string, Promise<void>>();
  private jobs: Job[] = [];
  private active = new Set<Job>();
  private failed = new Set<string>();
  private closed = false;
  constructor(
    readonly directory: string | null,
    private readonly download: (
      url: string,
      signal: AbortSignal,
    ) => Promise<StoredImage>,
  ) {}

  private key(url: string) {
    const parsed = siteUrl(url);
    if (!parsed.pathname.startsWith("/static/img/test/"))
      throw new AppError(
        400,
        "INVALID_IMAGE",
        "Only question illustrations are supported.",
      );
    return createHash("sha256").update(parsed.href).digest("hex");
  }
  status(url: string) {
    const key = this.key(url);
    const memory = this.memory.get(key);
    if (memory)
      return {
        key,
        cached: true,
        status: "cached",
        mimeType: memory.mimeType,
        bytes: Buffer.byteLength(memory.data, "base64"),
        filename: null,
      };
    if (this.directory) {
      for (const [mimeType, ext] of Object.entries(formats)) {
        const filename = `${key}.${ext}`;
        const file = join(this.directory, filename);
        if (existsSync(file))
          return {
            key,
            cached: true,
            status: "cached",
            mimeType,
            bytes: statSync(file).size,
            filename,
          };
      }
    }
    return {
      key,
      cached: false,
      status: this.pending.has(key)
        ? "pending"
        : this.failed.has(key)
          ? "error"
          : "missing",
      mimeType: null,
      bytes: 0,
      filename: null,
    };
  }
  summary() {
    let images = this.memory.size;
    let bytes = [...this.memory.values()].reduce(
      (sum, image) => sum + Buffer.byteLength(image.data, "base64"),
      0,
    );
    if (this.directory && existsSync(this.directory)) {
      for (const filename of readdirSync(this.directory)) {
        if (!/^[a-f0-9]{64}\.(png|jpg|webp|gif)$/.test(filename)) continue;
        images++;
        bytes += statSync(join(this.directory, filename)).size;
      }
    }
    return {
      images,
      bytes,
      pending: this.pending.size,
      failed: this.failed.size,
    };
  }
  async cached(url: string): Promise<StoredImage | null> {
    const info = this.status(url);
    if (!info.cached) return null;
    if (!info.filename) return this.memory.get(info.key) ?? null;
    try {
      const buffer = await readFile(join(this.directory!, info.filename));
      return { mimeType: info.mimeType!, data: buffer.toString("base64") };
    } catch {
      return null;
    }
  }
  enqueue(url: string) {
    try {
      void this.ensure(url).catch(() => {
        /* Failed downloads are visible in archive statistics and can be retried. */
      });
    } catch {
      // Unsupported remote illustrations must never prevent an attempt from being saved.
      this.failed.add(createHash("sha256").update(url).digest("hex"));
    }
  }
  private ensure(url: string): Promise<void> {
    const info = this.status(url);
    if (info.cached) return Promise.resolve();
    const existing = this.pending.get(info.key);
    if (existing) return existing;
    if (this.closed) return Promise.reject(new Error("Image cache is closed."));
    this.failed.delete(info.key);
    const promise = new Promise<void>((resolve, reject) => {
      this.jobs.push({
        url,
        key: info.key,
        controller: new AbortController(),
        resolve,
        reject,
      });
    });
    this.pending.set(info.key, promise);
    this.pump();
    return promise;
  }
  async get(url: string): Promise<StoredImage> {
    await this.ensure(url);
    const image = await this.cached(url);
    if (!image)
      throw new AppError(
        502,
        "IMAGE_CACHE_MISS",
        "Could not read the saved illustration. Retry caching the image.",
      );
    return image;
  }
  private pump() {
    while (!this.closed && this.active.size < 2 && this.jobs.length) {
      const job = this.jobs.shift()!;
      this.active.add(job);
      void this.run(job);
    }
  }
  private async run(job: Job) {
    let temporary: string | undefined;
    let failure: unknown;
    try {
      const image = await this.download(job.url, job.controller.signal);
      if (job.controller.signal.aborted)
        throw new Error("Image download cancelled.");
      const extension = formats[image.mimeType];
      const buffer = Buffer.from(image.data, "base64");
      if (!extension || !buffer.length || buffer.length > 5 * 1024 * 1024)
        throw new Error("Unsupported image.");
      if (this.directory) {
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        temporary = join(this.directory, `${job.key}.${randomUUID()}.tmp`);
        await writeFile(temporary, buffer, { flag: "wx", mode: 0o600 });
        if (job.controller.signal.aborted)
          throw new Error("Image download cancelled.");
        await rename(
          temporary,
          join(this.directory, `${job.key}.${extension}`),
        );
      } else this.memory.set(job.key, image);
    } catch (error) {
      if (!job.controller.signal.aborted) this.failed.add(job.key);
      failure = error;
    } finally {
      if (temporary) await rm(temporary, { force: true }).catch(() => {});
      this.pending.delete(job.key);
      this.active.delete(job);
      this.pump();
      if (failure) job.reject(failure);
      else job.resolve();
    }
  }
  async idle() {
    while (this.pending.size)
      await Promise.allSettled([...this.pending.values()]);
  }
  private async cancel() {
    this.closed = true;
    for (const job of this.jobs.splice(0)) {
      this.pending.delete(job.key);
      job.reject(new Error("Image download cancelled."));
    }
    for (const job of this.active) job.controller.abort();
    await this.idle();
  }
  async clear() {
    await this.cancel();
    this.memory.clear();
    this.failed.clear();
    if (this.directory)
      await rm(this.directory, { recursive: true, force: true });
    this.closed = false;
  }
  async close() {
    await this.cancel();
  }
}
