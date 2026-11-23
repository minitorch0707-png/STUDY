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
];
