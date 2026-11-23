import "server-only";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { MIGRATIONS } from "./migrations";

/**
 * LectureLab stores everything in one local SQLite file (./data/lecturelab.db)
 * plus the original uploads in ./data/uploads. SQLite is a single file, needs no
 * server, and is fast enough for one student's entire degree.
 */

export const DATA_DIR = process.env.LECTURELAB_DATA_DIR || path.join(process.cwd(), "data");
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

type DB = Database.Database;

const globalForDb = globalThis as unknown as { __lecturelabDb?: DB };

export function openDatabase(file: string): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  return db;
}

export function migrate(db: DB) {
  db.exec("CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  const applied = new Set(
    (db.prepare("SELECT id FROM _migrations").all() as { id: number }[]).map((r) => r.id),
  );
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)").run(m.id, new Date().toISOString());
    })();
  }
}

/** Shared connection (survives hot reloads in development). */
export function db(): DB {
  if (!globalForDb.__lecturelabDb) {
    globalForDb.__lecturelabDb = openDatabase(path.join(DATA_DIR, "lecturelab.db"));
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
  return globalForDb.__lecturelabDb;
}

/** For tests: swap in an isolated database. */
export function setDatabaseForTests(instance: DB) {
  globalForDb.__lecturelabDb = instance;
}

export const newId = () => crypto.randomUUID();
export const nowIso = () => new Date().toISOString();

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
