import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import {
  workspacePreferencesSchema,
  type WorkspacePreferences,
} from "../shared/contracts.js";

export class WorkspacePreferencesStore {
  private memory: WorkspacePreferences = { premiumPurchased: false };
  constructor(private readonly path: string | null) {}
  get(): WorkspacePreferences {
    if (!this.path) return { ...this.memory };
    try {
      return workspacePreferencesSchema.parse(
        JSON.parse(readFileSync(this.path, "utf8")),
      );
    } catch {
      return { premiumPurchased: false };
    }
  }
  set(value: WorkspacePreferences): WorkspacePreferences {
    const preferences = workspacePreferencesSchema.parse(value);
    if (this.path) {
      mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      try {
        writeFileSync(temporary, JSON.stringify(preferences) + "\n", {
          mode: 0o600,
          flag: "wx",
        });
        renameSync(temporary, this.path);
      } finally {
        rmSync(temporary, { force: true });
      }
    } else this.memory = preferences;
    return { ...preferences };
  }
}
