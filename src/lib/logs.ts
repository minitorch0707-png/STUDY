import "server-only";
import { db, nowIso } from "@/lib/db";

/** Small local log for troubleshooting. Messages only — never file contents or keys. */
export function logEvent(level: "error" | "warn" | "info", source: string, message: string) {
  try {
    db().prepare("INSERT INTO app_logs (level, source, message, created_at) VALUES (?,?,?,?)").run(level, source, message.slice(0, 2000), nowIso());
    db().prepare("DELETE FROM app_logs WHERE id <= (SELECT MAX(id) - 500 FROM app_logs)").run();
  } catch {
    /* logging must never break the app */
  }
}

export function recentLogs(limit = 60) {
  return db().prepare("SELECT level, source, message, created_at FROM app_logs ORDER BY id DESC LIMIT ?").all(limit) as {
    level: string;
    source: string;
    message: string;
    created_at: string;
  }[];
}
