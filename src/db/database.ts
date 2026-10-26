import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { dirname, resolve, join } from "node:path";
import { mkdirSync, chmodSync } from "node:fs";
import * as schema from "./schema.js";

export class Store {
  readonly sqlite: Database.Database;
  readonly db;
  readonly imageDirectory: string | null;
  constructor(path = process.env.DATABASE_PATH ?? "./data/practica.sqlite") {
    if (path !== ":memory:")
      mkdirSync(dirname(resolve(path)), { recursive: true, mode: 0o700 });
    this.imageDirectory =
      path === ":memory:" ? null : join(dirname(resolve(path)), "images");
    this.sqlite = new Database(path);
    if (path !== ":memory:") chmodSync(path, 0o600);
    this.sqlite.pragma("journal_mode = WAL");
    this.sqlite.pragma("foreign_keys = ON");
    this.sqlite.pragma("busy_timeout = 5000");
    this.db = drizzle(this.sqlite, { schema });
    migrate(this.db, { migrationsFolder: resolve("drizzle") });
    // A crash during a remote write leaves its outcome unknown. Do not silently retry.
    this.sqlite
      .prepare(
        "UPDATE runs SET sync_state = 'uncertain' WHERE sync_state = 'sending'",
      )
      .run();
  }
  close() {
    this.sqlite.close();
  }
  onApplicationShutdown() {
    this.close();
  }
}
