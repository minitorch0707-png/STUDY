# LectureLab: architecture and roadmap

## 1. Stack, and why

| Layer | Choice | Why |
|---|---|---|
| App | Next.js 16 (App Router) + TypeScript | One project for the UI and the server API. Strong typing catches mistakes early. |
| Styling | Tailwind CSS 4 + a small component set in `src/components/ui.tsx` | Consistent design tokens for light and dark themes, with no heavy UI library. |
| Database | SQLite (`better-sqlite3`) in `data/lecturelab.db` | One file, no server to run, very fast for a single student. Schema migrations are in `src/lib/db/migrations.ts`. |
| File storage | Local `data/uploads/<courseId>/` | Private by default. Files are validated by extension *and* by their actual bytes. |
| AI inference | **Ollama** behind a provider interface | Free, local and private. A second provider supports any OpenAI-compatible server (LM Studio, llama.cpp, vLLM, hosted open-weight APIs). |
| Chat model | `qwen3:4b-instruct-2507-q4_K_M` (Q4, ~2.5 GB) | The non-thinking 2507 update of Qwen3 4B: answers start straight away instead of after a hidden reasoning step. Best quality-to-size ratio for 16 GB of memory. "Quick replies" (default) keeps answers short so they finish fast. |
| Vision model | `gemma3:4b`, optional | Describes diagrams and images in PPTX/DOCX files during upload. |
| Embeddings | `nomic-embed-text` (274 MB) | Small, strong retrieval quality, uses task prefixes. |
| Vector search | Float32 vectors in SQLite + in-memory cosine similarity, behind a `VectorStore` interface | A student's materials are a few thousand chunks, so a search takes milliseconds. A separate vector database would add setup without benefit. The interface allows moving to pgvector later. |
| Tests | Vitest | 43 tests covering core logic, real PowerPoint files and the end-to-end backend flow. |

**Why I didn't use Supabase yet:** it needs accounts, network access and authentication setup. For a private, single-user, local-first app, SQLite is simpler and fully private. Supabase (Postgres + pgvector + Auth + Storage) is the planned path for a public launch (section 7).

## 2. How it fits together

**As a desktop app** (what students download), the Electron shell in `desktop/` does three things:

1. Starts the LectureLab server (the same Next.js app, built in "standalone" mode) using a **private copy of Node.js bundled inside the app**.
2. Opens a window pointing at it.
3. Checks for updates.

On first run, the `/setup` screen asks the server to download **Ollama** (open source) into the app's data folder (`src/lib/engine.ts`). The server runs Ollama on a private port (11435), then downloads the model that fits the computer's memory. If the student already runs Ollama on its usual port, that one is used instead.

```
LectureLab.app / LectureLab.exe (Electron)
  ├─ bundled Node.js ──► LectureLab server (Next.js standalone) ──► SQLite + files in the app data folder
  │                                   └─ starts ──► private Ollama (downloaded on first run) ──► AI models
  └─ window ──► http://127.0.0.1:47321 (local only)
```

Pro licences (`src/lib/license.ts`, configured in `src/lib/product.ts`) are checked directly against the Lemon Squeezy or Gumroad licence APIs, with a 30-day offline grace period. The server enforces Pro limits, so they can't be bypassed from the browser.

**Inside the server:**

```
Browser (React pages in src/app)
   │  fetch / streaming NDJSON
   ▼
API routes (src/app/api/**)       validation (zod), rate limits, friendly errors (src/lib/api.ts)
   ▼
Services (src/lib/services/*)     courses, documents, topics, tutor, quiz, flashcards, planner, progress, resources, models
   │                 │                      │
   ▼                 ▼                      ▼
Pure logic          RAG (src/lib/rag)      AI layer (src/lib/ai)
(src/lib/learning)  BM25 + vectors + RRF    provider interface → Ollama / OpenAI-compatible
srs, mastery,                               one-at-a-time queue, JSON-schema output + validation + retry
grading, planner,                           prompts.ts (all prompts in one place)
syllabus
   ▼
SQLite + data/uploads
```

- **Background jobs** (document processing, quiz and flashcard generation, grading) run inside the server process. Their status is stored in the database and the UI polls it. After a restart, interrupted document processing resumes automatically.
- **One model call at a time**: a laptop runs one generation efficiently, so calls queue instead of competing for memory.

## 3. Minimum viable product (built)

1. Courses (create, edit, colour, delete).
2. Uploads (PDF/PPTX/DOCX/TXT/MD) → parsing → sections (page, slide or heading) → chunks → embeddings → topics. Duplicate files are detected and not processed again.
3. A document viewer that every citation links to. PDFs can be shown side by side with the original page.
4. AI tutor: a cached structured lesson, knowledge checks, chat with quick actions, Socratic mode, adaptive re-explanation, and a clear split between "from your course" and "Beyond your materials".
5. Practice exams in 7 question formats, with practice or exam-simulation modes, timers, rubric grading, model answers, source links and "Retake my mistakes".
6. Flashcards: generated or manual, SM-2 spaced repetition, flip animation, keyboard shortcuts.
7. Syllabus date detection (confirmed by the student), a study planner and Exam Cram mode.
8. A progress dashboard and a recommendation engine.
9. Model management: status, install with progress, choosing models, memory in use, a benchmark.
10. External resources: YouTube (API key) and Wikipedia, cached for 7 days.

## 4. Database (main tables)

- `courses` → `documents` → `sections` (one per page, slide or heading block, kept in order) → `chunks` (retrieval units with `embedding` and `embedding_model`).
- `topics` ↔ `topic_sections` (which slides teach a topic).
- `lessons`, `chat_messages` (tutor). `chat_messages` records the action used and the teaching strategy, which drives adaptive teaching.
- `quizzes` → `questions` (each with `chunk_id`, so it can be traced to its source) → `attempts` → `responses` (score, rubric verdicts, graded by auto/ai/self).
- `decks` → `cards` (SRS state) → `reviews`.
- `learning_events`: every graded answer (quiz, check, flashcard). **Mastery is calculated only from this table.**
- `calendar_events` (with `confirmed`), `study_plans` → `plan_items`.
- `resources` (external links cache), `settings`, `ai_generations` (log of each prompt, output, timing and student rating).

Deleting a course removes all of its rows (via cascading deletes) and its folder of uploaded files.

## 5. How answers stay grounded in your files (RAG)

1. **Parsing preserves structure.** PPTX slides are read in presentation order, with titles, bullet levels, tables and speaker notes. PDFs are read page by page, with line reconstruction and title detection. DOCX headings and tables are converted to markdown. Pages with no text layer (such as scans) are **flagged, not faked**.
2. **Chunking:** about 1,100 characters per chunk with a small overlap. A slide is usually a single chunk, so citations stay precise. Before embedding, each chunk gets a header with its document name and slide or page.
3. **Hybrid retrieval:** BM25 keyword search (catches exact terms, and works with no AI running) plus embedding search (catches meaning), merged with Reciprocal Rank Fusion. Slides linked to the current topic get a boost.
4. **Prompting:** sources go into numbered `<source id="S1" document=… location=…>` blocks. The model must cite `[S#]` and label anything outside the sources as "Beyond your materials". The UI turns each `[S#]` into a chip that opens the exact slide.
5. **Prompt-injection defence:** uploaded text is treated as data. Tag-like text such as `</source>` or `<system>` is neutralised, and the model is told never to follow instructions found in sources. The model also has no tools, so a hostile document has nothing it could trigger.
6. **Structured output:** quizzes, flashcards, topics and grades use a JSON schema (Ollama's `format`), are checked with zod, and are retried once with the error message. Generated questions are also quality-checked: MCQs need 4–5 distinct options and no "all of the above", written questions need a rubric, near-duplicates of past questions are rejected, and option order is shuffled.

## 6. Measuring quality, then LoRA fine-tuning (later)

- Each AI call is logged in `ai_generations` with the task, prompt, output, time and the student's 👍/👎 rating. Settings shows per-task counts, average times and ratings, and has a benchmark that measures speed (tokens per second) and whether the model follows citation instructions.
- **Recommended order:** (1) gather a baseline with `qwen3:4b`; (2) build a small evaluation set (around 50 lessons and 100 questions rated against your slides); (3) try a better prompt or a larger model (`qwen3:8b`) first; (4) only if gaps remain, export highly rated generations as a dataset and train a LoRA adapter (MLX-LM runs well on Apple Silicon). The adapter loads into Ollama through a Modelfile `ADAPTER` line, so no application code changes.

## 7. If a hosted (website) version is ever wanted

The current plan is local-only: each student's computer runs everything, so there are no server costs. If a website version is wanted later:

| Area | Local version (now) | Public version |
|---|---|---|
| Accounts | none (single user, localhost only) | Supabase Auth; `user_id` on every table plus Postgres Row-Level Security so no student can ever read another's data |
| Database | SQLite | Supabase Postgres (the schema maps over directly) |
| Vectors | in-memory search | pgvector with an HNSW index (`VectorStore` swap) |
| Files | `data/uploads` | Supabase Storage with private buckets and signed URLs; a virus scan on upload |
| Inference | Ollama on your laptop | A GPU inference server running the same open-weight models with vLLM (one rented GPU such as an L4/A10G serves dozens of concurrent students with batching), or a hosted open-weight API through the existing OpenAI-compatible provider |
| Background jobs | in-process | a proper job queue (Postgres-backed, e.g. pg-boss) with separate workers |
| Rate limits | in-memory | per-user quotas in Redis or Postgres, plus usage tracking per account |
| Costs | free | caching (lessons, resources), small models for grading and flashcards, prompt caching, and daily generation quotas |

The app is already layered this way (provider interface, `VectorStore`, services separate from routes), so this is a migration rather than a rewrite.

## 8. Roadmap

- **Phase 1, foundation:** done (design system, shell, courses, uploads, parsing, persistence).
- **Phase 2, core learning:** done (tutor, lessons, exams, grading, flashcards).
- **Phase 3, connected learning:** done in a first version (YouTube and Wikipedia, syllabus calendar, recommendations, analytics, Exam Cram). Next: OCR for scanned PDFs (render pages and send them to the vision model), exporting the calendar to `.ics`.
- **Phase 4, advanced:** voice tutoring (local Whisper + TTS), Teach-It-Back mode (the grading pipeline already exists), concept maps (from topic and keyword links), collaboration (requires the public architecture), exportable study guides.
