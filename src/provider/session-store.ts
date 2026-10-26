import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { AppError } from "../server/errors.js";

const sessionSchema = z
  .object({
    version: z.literal(1),
    jar: z.unknown(),
    csrf: z.string().max(8192),
    verifiedAt: z.iso.datetime(),
    tracking: z.record(z.uuid(), z.string().max(8192)),
  })
  .strict();
export type SavedSession = z.infer<typeof sessionSchema>;

export class SessionStore {
  readonly file: string;
  readonly keyFile: string;
  constructor(
    readonly directory: string,
    readonly enabled = true,
  ) {
    this.file = join(directory, "session.enc");
    this.keyFile = join(directory, "session.key");
  }
  private key(create: boolean) {
    if (create) {
      mkdirSync(this.directory, { recursive: true, mode: 0o700 });
      try {
        writeFileSync(this.keyFile, randomBytes(32), {
          flag: "wx",
          mode: 0o600,
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
    const key = readFileSync(this.keyFile);
    if (key.length !== 32) throw new Error("Invalid session key.");
    chmodSync(this.keyFile, 0o600);
    return key;
  }
  load(): SavedSession | null {
    if (!this.enabled || !existsSync(this.file)) return null;
    try {
      if (statSync(this.file).size > 8 * 1024 * 1024) return null;
      const stored = readFileSync(this.file);
      if (stored.length < 29 || stored[0] !== 1) return null;
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.key(false),
        stored.subarray(1, 13),
      );
      decipher.setAuthTag(stored.subarray(13, 29));
      const plaintext = Buffer.concat([
        decipher.update(stored.subarray(29)),
        decipher.final(),
      ]);
      chmodSync(this.file, 0o600);
      return sessionSchema.parse(JSON.parse(plaintext.toString("utf8")));
    } catch {
      return null;
    }
  }
  save(value: SavedSession) {
    if (!this.enabled) return;
    let temporary: string | undefined;
    try {
      const session = sessionSchema.parse(value);
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", this.key(true), iv);
      const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(session), "utf8"),
        cipher.final(),
      ]);
      const stored = Buffer.concat([
        Buffer.from([1]),
        iv,
        cipher.getAuthTag(),
        ciphertext,
      ]);
      temporary = `${this.file}.${randomUUID()}.tmp`;
      writeFileSync(temporary, stored, { flag: "wx", mode: 0o600 });
      renameSync(temporary, this.file);
    } catch {
      throw new AppError(
        500,
        "SESSION_SAVE_FAILED",
        "Could not remember the session. Check that the application data directory is writable.",
      );
    } finally {
      if (temporary) rmSync(temporary, { force: true });
    }
  }
  clear() {
    rmSync(this.file, { force: true });
    rmSync(this.keyFile, { force: true });
  }
}
