/**
 * Database schema. Each migration runs once, in order. Never edit a migration
 * that has shipped — add a new one instead.
 */
export const MIGRATIONS: { id: number; sql: string }[] = [
  {
    id: 1,
    sql: `
CREATE TABLE courses (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  code TEXT,
  semester TEXT,
  professor TEXT,
  description TEXT,
  color TEXT NOT NULL DEFAULT 'indigo',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  stored_name TEXT NOT NULL,
  original_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  ext TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'lecture',      -- lecture | syllabus | reading | notes | other
  week INTEGER,
  lecture_label TEXT,
  status TEXT NOT NULL DEFAULT 'queued',     -- queued | parsing | embedding | analyzing | ready | failed
  status_detail TEXT,
  progress REAL NOT NULL DEFAULT 0,
  section_count INTEGER NOT NULL DEFAULT 0,
  warnings TEXT NOT NULL DEFAULT '[]',
  parser_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_documents_course ON documents(course_id);

-- A section is one page (PDF), one slide (PPTX) or one heading block (DOCX/TXT).
CREATE TABLE sections (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  label TEXT NOT NULL,          -- "Slide 4", "Page 12", "Section 3"
  title TEXT,
  content TEXT NOT NULL,        -- markdown, tables preserved where possible
  notes TEXT,                   -- speaker notes (PPTX)
  has_text INTEGER NOT NULL DEFAULT 1,
  image_count INTEGER NOT NULL DEFAULT 0,
  image_descriptions TEXT       -- from the optional vision model
);
CREATE INDEX idx_sections_doc ON sections(document_id, idx);

CREATE TABLE chunks (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  section_id TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL,
  text TEXT NOT NULL,
  embedding BLOB,
  embedding_model TEXT
);
CREATE INDEX idx_chunks_course ON chunks(course_id);
CREATE INDEX idx_chunks_section ON chunks(section_id);

CREATE TABLE topics (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  summary TEXT,
  objectives TEXT NOT NULL DEFAULT '[]',
  keywords TEXT NOT NULL DEFAULT '[]',
  importance INTEGER NOT NULL DEFAULT 2,     -- 1 low, 2 normal, 3 core
  ord INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_topics_course ON topics(course_id);

CREATE TABLE topic_sections (
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  section_id TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  PRIMARY KEY (topic_id, section_id)
);

CREATE TABLE lessons (
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  sources TEXT NOT NULL DEFAULT '[]',
  checks TEXT NOT NULL DEFAULT '[]',
  model TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  role TEXT NOT NULL,           -- user | assistant
  content TEXT NOT NULL,
  action TEXT,                  -- quick action that produced it, if any
  strategy TEXT,                -- teaching strategy used (for adaptive teaching)
  sources TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_chat_topic ON chat_messages(topic_id, created_at);

CREATE TABLE quizzes (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  config TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'generating', -- generating | ready | failed
  status_detail TEXT,
  progress REAL NOT NULL DEFAULT 0,
  parent_attempt_id TEXT,                    -- set for "Retake my mistakes"
  created_at TEXT NOT NULL
);

CREATE TABLE questions (
  id TEXT PRIMARY KEY,
  quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
  chunk_id TEXT REFERENCES chunks(id) ON DELETE SET NULL,
  ord INTEGER NOT NULL,
  type TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  prompt TEXT NOT NULL,
  data TEXT NOT NULL,           -- options / answer / pairs / rubric / model answer (JSON)
  explanation TEXT,
  max_score REAL NOT NULL,
  fingerprint TEXT NOT NULL
);
CREATE INDEX idx_questions_quiz ON questions(quiz_id, ord);
CREATE INDEX idx_questions_course ON questions(course_id);

CREATE TABLE attempts (
  id TEXT PRIMARY KEY,
  quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'in_progress', -- in_progress | grading | graded
  started_at TEXT NOT NULL,
  submitted_at TEXT,
  score REAL,
  max_score REAL
);

CREATE TABLE responses (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  answer TEXT,
  score REAL,
  status TEXT NOT NULL DEFAULT 'pending',      -- pending | graded | needs_self_grade
  feedback TEXT,
  graded_by TEXT,                              -- auto | ai | self
  UNIQUE (attempt_id, question_id)
);

CREATE TABLE decks (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready',        -- generating | ready | failed
  status_detail TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE cards (
  id TEXT PRIMARY KEY,
  deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  front TEXT NOT NULL,
  back TEXT NOT NULL,
  chunk_id TEXT REFERENCES chunks(id) ON DELETE SET NULL,
  state TEXT NOT NULL DEFAULT 'new',           -- new | learning | review | relearning
  step INTEGER NOT NULL DEFAULT 0,
  ease REAL NOT NULL DEFAULT 2.5,
  interval_days REAL NOT NULL DEFAULT 0,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  due_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_cards_deck ON cards(deck_id);
CREATE INDEX idx_cards_due ON cards(due_at);

CREATE TABLE reviews (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL,                     -- 1 again, 2 hard, 3 good, 4 easy
  reviewed_at TEXT NOT NULL,
  prev_interval REAL NOT NULL,
  new_interval REAL NOT NULL,
  duration_ms INTEGER
);
CREATE INDEX idx_reviews_time ON reviews(reviewed_at);

-- Every graded interaction, used for mastery estimates.
CREATE TABLE learning_events (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  topic_id TEXT REFERENCES topics(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,           -- quiz | flashcard | check | lesson
  score REAL NOT NULL,          -- 0..1
  ref_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_events_topic ON learning_events(topic_id, created_at);
CREATE INDEX idx_events_course ON learning_events(course_id, created_at);

CREATE TABLE calendar_events (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,           -- exam | assignment | reading | other
  date TEXT NOT NULL,           -- YYYY-MM-DD
  weight REAL,
  source_document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  source_text TEXT,
  confirmed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_calendar_date ON calendar_events(date);

CREATE TABLE study_plans (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  exam_event_id TEXT REFERENCES calendar_events(id) ON DELETE SET NULL,
  exam_date TEXT NOT NULL,
  daily_minutes INTEGER NOT NULL,
  cram INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE TABLE plan_items (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES study_plans(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  kind TEXT NOT NULL,           -- learn | review | flashcards | quiz | mock_exam
  topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  minutes INTEGER NOT NULL,
  done INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_plan_items_date ON plan_items(date);

CREATE TABLE resources (
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,       -- youtube | wikipedia
  external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  thumbnail TEXT,
  channel TEXT,
  duration TEXT,
  description TEXT,
  reason TEXT,
  fetched_at TEXT NOT NULL
);
CREATE INDEX idx_resources_topic ON resources(topic_id);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`,
  },
  {
    id: 2,
    sql: `
-- Every AI generation is logged with the task, prompt and output, plus any
-- student rating. This is the evaluation baseline and, later, the raw material
-- for a LoRA fine-tuning dataset.
CREATE TABLE ai_generations (
  id TEXT PRIMARY KEY,
  task TEXT NOT NULL,            -- lesson | tutor | quiz | grade | flashcards | topics | checks
  model TEXT NOT NULL,
  prompt TEXT NOT NULL,
  output TEXT NOT NULL,
  duration_ms INTEGER,
  output_tokens INTEGER,
  rating INTEGER,                -- 1 helpful, -1 not helpful
  ref_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_gen_task ON ai_generations(task, created_at);
ALTER TABLE chat_messages ADD COLUMN generation_id TEXT;
`,
  },
  {
    id: 3,
    sql: `
-- Errors and warnings shown on Settings → Help & diagnostics (never file contents).
CREATE TABLE app_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT NOT NULL,           -- error | warn | info
  source TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`,
  },
  {
    id: 4,
    sql: `
-- Study notes. "auto" notes (one per topic) are kept up to date from the tutor
-- conversation; "manual" notes are written by the student.
CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'manual',   -- auto | manual
  synced_until TEXT,                     -- last chat message folded into an auto note
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_notes_course ON notes(course_id, updated_at);
CREATE UNIQUE INDEX idx_notes_auto_topic ON notes(topic_id) WHERE kind = 'auto';
`,
  },
  {
    id: 5,
    sql: `
-- ── Release 1: dependable course workspace ─────────────────────────────────
-- Additive only: no existing column is dropped, and existing data is moved
-- into the new structures below.

-- Tutor threads: one per course topic, with the unsent draft and resume position.
CREATE TABLE tutor_threads (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  topic_id TEXT NOT NULL UNIQUE REFERENCES topics(id) ON DELETE CASCADE,
  draft TEXT NOT NULL DEFAULT '',
  resume_message_id TEXT,
  last_active_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
ALTER TABLE chat_messages ADD COLUMN thread_id TEXT REFERENCES tutor_threads(id) ON DELETE CASCADE;
ALTER TABLE chat_messages ADD COLUMN seq INTEGER;
ALTER TABLE chat_messages ADD COLUMN status TEXT NOT NULL DEFAULT 'complete'; -- streaming | complete | interrupted | failed
ALTER TABLE chat_messages ADD COLUMN client_id TEXT;                          -- idempotency key from the app
ALTER TABLE chat_messages ADD COLUMN reply_to TEXT;                           -- the student message an answer replies to
ALTER TABLE chat_messages ADD COLUMN verification TEXT;                       -- citation check results (JSON)
ALTER TABLE chat_messages ADD COLUMN error TEXT;
ALTER TABLE chat_messages ADD COLUMN updated_at TEXT;
ALTER TABLE chat_messages ADD COLUMN options TEXT;                          -- generation options (JSON), so a retry repeats the same request
CREATE UNIQUE INDEX idx_chat_client ON chat_messages(topic_id, client_id) WHERE client_id IS NOT NULL;
CREATE INDEX idx_chat_thread ON chat_messages(thread_id, seq);

INSERT INTO tutor_threads (id, course_id, topic_id, last_active_at, created_at)
  SELECT lower(hex(randomblob(16))), t.course_id, t.id, MAX(m.created_at), MIN(m.created_at)
  FROM chat_messages m JOIN topics t ON t.id = m.topic_id GROUP BY t.id;
UPDATE chat_messages SET thread_id = (SELECT th.id FROM tutor_threads th WHERE th.topic_id = chat_messages.topic_id);
UPDATE chat_messages SET seq = (
  SELECT COUNT(*) FROM chat_messages m2 WHERE m2.topic_id = chat_messages.topic_id
    AND (m2.created_at < chat_messages.created_at OR (m2.created_at = chat_messages.created_at AND m2.rowid <= chat_messages.rowid)));
UPDATE chat_messages SET reply_to = (
  SELECT m2.id FROM chat_messages m2 WHERE m2.topic_id = chat_messages.topic_id AND m2.role = 'user' AND m2.seq < chat_messages.seq ORDER BY m2.seq DESC LIMIT 1)
  WHERE role = 'assistant';

ALTER TABLE lessons ADD COLUMN status TEXT NOT NULL DEFAULT 'complete';      -- streaming | complete | interrupted | failed
ALTER TABLE lessons ADD COLUMN verification TEXT;
ALTER TABLE lessons ADD COLUMN error TEXT;
ALTER TABLE lessons ADD COLUMN updated_at TEXT;

-- "Save to notes" is idempotent: each answer is saved into a note at most once.
CREATE TABLE note_saves (
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (note_id, message_id)
);

-- Approved calendar records (shared by Calendar, Planner, Grades and Home).
ALTER TABLE calendar_events ADD COLUMN all_day INTEGER NOT NULL DEFAULT 1;
ALTER TABLE calendar_events ADD COLUMN start_time TEXT;                       -- local HH:MM, optional
ALTER TABLE calendar_events ADD COLUMN category TEXT;
ALTER TABLE calendar_events ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual'; -- manual | syllabus
ALTER TABLE calendar_events ADD COLUMN origin_key TEXT;                       -- stable key for re-imports
ALTER TABLE calendar_events ADD COLUMN source_section_idx INTEGER;
ALTER TABLE calendar_events ADD COLUMN edited_fields TEXT NOT NULL DEFAULT '[]'; -- fields the student changed by hand
ALTER TABLE calendar_events ADD COLUMN updated_at TEXT;

-- Syllabus imports are proposals until the student confirms them.
CREATE TABLE syllabus_imports (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',      -- pending | applied | discarded | superseded
  notes TEXT NOT NULL DEFAULT '[]',            -- import-level warnings (JSON)
  created_at TEXT NOT NULL,
  applied_at TEXT
);
CREATE INDEX idx_syllabus_imports_course ON syllabus_imports(course_id, created_at);
CREATE TABLE syllabus_suggestions (
  id TEXT PRIMARY KEY,
  import_id TEXT NOT NULL REFERENCES syllabus_imports(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL DEFAULT 0,
  action TEXT NOT NULL,                        -- add | update | remove
  origin_key TEXT NOT NULL,
  event_id TEXT REFERENCES calendar_events(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,                          -- exam | assignment | reading | quiz | other
  title TEXT NOT NULL,
  date TEXT,                                   -- NULL = not stated or ambiguous
  start_time TEXT,
  weight REAL,                                 -- NULL = not stated or ambiguous
  category TEXT,
  previous TEXT,                               -- current approved values (JSON) for updates
  ambiguity TEXT NOT NULL DEFAULT '[]',
  conflicts TEXT NOT NULL DEFAULT '[]',
  kept_user_edits TEXT NOT NULL DEFAULT '[]',
  source_document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  source_section_idx INTEGER,
  source_label TEXT,
  source_quote TEXT,
  include INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_syllabus_suggestions_import ON syllabus_suggestions(import_id, ord);

-- Grades: categories/policies from the syllabus, assessments, scores and feedback.
CREATE TABLE grade_categories (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  weight REAL,
  expected_count INTEGER,                      -- e.g. "4 problem sets", if stated
  created_at TEXT NOT NULL
);
CREATE TABLE course_policies (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                          -- drop_lowest | curve | bonus | late | other
  text TEXT NOT NULL,
  source_document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  source_label TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE assessments (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  event_id TEXT UNIQUE REFERENCES calendar_events(id) ON DELETE SET NULL,
  category_id TEXT REFERENCES grade_categories(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  weight REAL,                                 -- % of the final grade; NULL = share of its category
  points_possible REAL NOT NULL DEFAULT 100,
  points_earned REAL,                          -- NULL = not graded yet
  excused INTEGER NOT NULL DEFAULT 0,
  what_if REAL,                                -- hypothetical % for planning, never a real score
  feedback TEXT,
  feedback_source TEXT,                        -- provenance (JSON)
  score_source TEXT NOT NULL DEFAULT 'manual', -- manual | confirmed_extraction
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_assessments_course ON assessments(course_id);
CREATE TABLE grade_proposals (
  id TEXT PRIMARY KEY,
  assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
  points_earned REAL,
  points_possible REAL,
  feedback TEXT,
  source_label TEXT,
  source_quote TEXT,
  uncertain INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',      -- pending | accepted | rejected
  created_at TEXT NOT NULL
);
CREATE TABLE study_suggestions (
  id TEXT PRIMARY KEY,
  assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  model TEXT,
  created_at TEXT NOT NULL
);

ALTER TABLE documents ADD COLUMN partial INTEGER NOT NULL DEFAULT 0;         -- some pages/slides had no readable text
ALTER TABLE documents ADD COLUMN mime TEXT;
ALTER TABLE documents ADD COLUMN assessment_id TEXT REFERENCES assessments(id) ON DELETE SET NULL;

-- Existing approved events: mark their origin and give syllabus ones a stable key.
UPDATE calendar_events SET origin = CASE WHEN source_document_id IS NOT NULL THEN 'syllabus' ELSE 'manual' END, updated_at = created_at;
UPDATE calendar_events SET origin_key = 'legacy|' || kind || '|' || lower(trim(title)) || '|' || date || '|' || id
  WHERE confirmed = 1 AND origin = 'syllabus';
-- Existing unconfirmed detections become a pending syllabus review (nothing is lost).
INSERT INTO syllabus_imports (id, course_id, document_id, status, notes, created_at)
  SELECT lower(hex(randomblob(16))), course_id, MAX(source_document_id), 'pending', '["Moved from the previous version of LectureLab."]', MIN(created_at)
  FROM calendar_events WHERE confirmed = 0 GROUP BY course_id;
INSERT INTO syllabus_suggestions (id, import_id, course_id, ord, action, origin_key, kind, title, date, weight, source_document_id, source_quote)
  SELECT lower(hex(randomblob(16))), (SELECT i.id FROM syllabus_imports i WHERE i.course_id = e.course_id AND i.status = 'pending' ORDER BY i.created_at DESC LIMIT 1),
         e.course_id, 0, 'add', e.kind || '|' || lower(trim(e.title)) || '|' || e.date, e.kind, e.title, e.date, e.weight, e.source_document_id, e.source_text
  FROM calendar_events e WHERE e.confirmed = 0;
DELETE FROM calendar_events WHERE confirmed = 0;
`,
  },
  {
    id: 6,
    sql: `
-- Study activity: local AI usage metadata only (no prompts, answers, course
-- names or file contents). One row per model run.
CREATE TABLE usage_events (
  id TEXT PRIMARY KEY,
  run_key TEXT NOT NULL UNIQUE,                -- one row per run, even if reported twice
  day TEXT NOT NULL,                           -- local date (YYYY-MM-DD)
  created_at TEXT NOT NULL,
  task TEXT NOT NULL,                          -- tutor | lesson | quiz | notes | other …
  reply_id TEXT,                               -- tutor message id, so a retried answer counts as one reply
  completed INTEGER NOT NULL DEFAULT 0,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  local_only INTEGER NOT NULL,                 -- 1 = verified loopback (on this computer)
  input_tokens INTEGER,                        -- NULL = the runtime didn't report it
  output_tokens INTEGER,
  duration_ms INTEGER,
  first_text_ms INTEGER,
  output_tokens_per_s REAL
);
CREATE INDEX idx_usage_day ON usage_events(day);
`,
  },
];
