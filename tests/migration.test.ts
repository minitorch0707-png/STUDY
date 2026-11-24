import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { MIGRATIONS } from "@/lib/db/migrations";
import { migrate } from "@/lib/db";

describe("schema migration preserves existing course data", () => {
  it("upgrades a v4 database (chats, notes, confirmed + unconfirmed dates) without losing anything", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    db.exec("CREATE TABLE _migrations (id INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
    for (const m of MIGRATIONS.filter((m) => m.id <= 4)) {
      db.exec(m.sql);
      db.prepare("INSERT INTO _migrations VALUES (?, ?)").run(m.id, "2026-11-01");
    }
    const t = "2026-11-01T10:00:00.000Z";
    db.prepare("INSERT INTO courses (id,title,color,created_at,updated_at) VALUES ('c1','Econ','indigo',?,?)").run(t, t);
    db.prepare("INSERT INTO documents (id,course_id,stored_name,original_name,display_name,ext,size,sha256,kind,status,created_at,updated_at) VALUES ('d1','c1','d1.pdf','Syllabus.pdf','Syllabus','pdf',1,'x','syllabus','ready',?,?)").run(t, t);
    db.prepare("INSERT INTO topics (id,course_id,title,created_at) VALUES ('t1','c1','Elasticity',?)").run(t);
    db.prepare("INSERT INTO chat_messages (id,topic_id,role,content,created_at) VALUES ('m1','t1','user','What is elasticity?','2026-11-01T10:00:01Z')").run();
    db.prepare("INSERT INTO chat_messages (id,topic_id,role,content,created_at) VALUES ('m2','t1','assistant','Responsiveness [S1].','2026-11-01T10:00:05Z')").run();
    db.prepare("INSERT INTO notes (id,course_id,topic_id,title,content,kind,created_at,updated_at) VALUES ('n1','c1','t1','Elasticity','My notes','auto',?,?)").run(t, t);
    db.prepare("INSERT INTO calendar_events (id,course_id,title,kind,date,weight,source_document_id,confirmed,created_at) VALUES ('e1','c1','Midterm','exam','2026-12-03',25,'d1',1,?)").run(t);
    db.prepare("INSERT INTO calendar_events (id,course_id,title,kind,date,weight,source_document_id,source_text,confirmed,created_at) VALUES ('e2','c1','Problem set 3','assignment','2026-11-27',10,'d1','PS3 due Nov 27',0,?)").run(t);

    migrate(db);

    expect(db.prepare("SELECT COUNT(*) n FROM _migrations").get()).toEqual({ n: MIGRATIONS.length });
    const msgs = db.prepare("SELECT id, seq, status, thread_id, reply_to FROM chat_messages ORDER BY seq").all() as { id: string; seq: number; status: string; thread_id: string; reply_to: string | null }[];
    expect(msgs.map((m) => [m.id, m.seq, m.status])).toEqual([["m1", 1, "complete"], ["m2", 2, "complete"]]);
    expect(msgs[1].reply_to).toBe("m1");
    expect(msgs[0].thread_id).toBeTruthy();
    expect(db.prepare("SELECT content FROM notes WHERE id='n1'").get()).toEqual({ content: "My notes" });
    // Confirmed event kept and marked as from the syllabus; unconfirmed one became a pending suggestion.
    expect(db.prepare("SELECT origin, confirmed FROM calendar_events WHERE id='e1'").get()).toEqual({ origin: "syllabus", confirmed: 1 });
    expect(db.prepare("SELECT COUNT(*) n FROM calendar_events WHERE id='e2'").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT action, title, date, weight, source_quote FROM syllabus_suggestions").get()).toEqual({ action: "add", title: "Problem set 3", date: "2026-11-27", weight: 10, source_quote: "PS3 due Nov 27" });
    expect(db.prepare("SELECT status FROM syllabus_imports").get()).toEqual({ status: "pending" });
  });
});
