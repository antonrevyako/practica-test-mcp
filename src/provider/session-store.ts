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
import { credentialsSchema } from "../shared/contracts.js";

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
  readonly credentialsFile: string;
  constructor(
    readonly directory: string,
    readonly enabled = true,
    readonly credentialsEnabled = enabled,
  ) {
    this.file = join(directory, "session.enc");
    this.keyFile = join(directory, "session.key");
    this.credentialsFile = join(directory, "credentials.enc");
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
  private read(file: string, maximum: number): unknown {
    if (!existsSync(file)) return null;
    try {
      if (statSync(file).size > maximum) return null;
      const stored = readFileSync(file);
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
      chmodSync(file, 0o600);
      return JSON.parse(plaintext.toString("utf8"));
    } catch {
      return null;
    }
  }
  load(): SavedSession | null {
    if (!this.enabled) return null;
    const result = sessionSchema.safeParse(this.read(this.file, 8 * 1024 * 1024));
    return result.success ? result.data : null;
  }
  loadCredentials(): z.infer<typeof credentialsSchema> | null {
    if (!this.enabled || !this.credentialsEnabled) return null;
    const result = credentialsSchema.safeParse(
      this.read(this.credentialsFile, 16 * 1024),
    );
    return result.success ? result.data : null;
  }
  private write(file: string, value: unknown) {
    let temporary: string | undefined;
    try {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", this.key(true), iv);
      const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(value), "utf8"),
        cipher.final(),
      ]);
      const stored = Buffer.concat([
        Buffer.from([1]),
        iv,
        cipher.getAuthTag(),
        ciphertext,
      ]);
      temporary = `${file}.${randomUUID()}.tmp`;
      writeFileSync(temporary, stored, { flag: "wx", mode: 0o600 });
      renameSync(temporary, file);
    } catch {
      throw new AppError(
        500,
        "SESSION_SAVE_FAILED",
        "Could not remember sign-in. Check that the application data directory is writable.",
      );
    } finally {
      if (temporary) rmSync(temporary, { force: true });
    }
  }
  save(value: SavedSession) {
    if (this.enabled) this.write(this.file, sessionSchema.parse(value));
  }
  saveCredentials(value: z.infer<typeof credentialsSchema>) {
    if (this.enabled && this.credentialsEnabled)
      this.write(this.credentialsFile, credentialsSchema.parse(value));
  }
  clearSession() {
    rmSync(this.file, { force: true });
    if (!existsSync(this.credentialsFile))
      rmSync(this.keyFile, { force: true });
  }
  clear() {
    rmSync(this.file, { force: true });
    rmSync(this.credentialsFile, { force: true });
    rmSync(this.keyFile, { force: true });
  }
}
