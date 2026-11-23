# LectureLab

LectureLab turns your lecture slides, readings and syllabi into structured lessons, practice exams, flashcards and a study plan. Its AI tutor runs **on your own computer** using free, open-weight models, so you pay nothing for AI and your course files stay on your machine.

- **Courses & uploads**: drag in PDF, PowerPoint (.pptx), Word (.docx), text or markdown files. LectureLab reads them page by page or slide by slide and keeps headings, tables and speaker notes.
- **AI Tutor**: structured lessons, quick actions ("Explain simpler", "Quiz me", …), Socratic mode, and teaching that adapts when you struggle. Every claim links to the exact slide or page it came from.
- **Practice exams**: multiple choice, true/false, short answer, essay, definitions, scenarios and matching. Objective answers are graded instantly; written answers are graded against a visible rubric, and "Retake my mistakes" builds a new quiz on what you got wrong.
- **Flashcards** with spaced repetition (Again / Hard / Good / Easy) and keyboard shortcuts.
- **Study planner**: exam dates detected from your syllabus (you confirm them), day-by-day plans and an Exam Cram mode.
- **Progress**: mastery per topic, calculated only from your real answers.

## Run it on your Mac (about 10 minutes)

1. **Install Node.js 22 or later** from <https://nodejs.org>.
2. **Install Ollama** from <https://ollama.com/download> and open it. It runs in the menu bar.
3. **Download the AI models.** You can do this from LectureLab's Settings page, or in Terminal:

   ```bash
   ollama pull qwen3:4b
   ```

   ```bash
   ollama pull nomic-embed-text
   ```

   Optional, to describe diagrams on slides:

   ```bash
   ollama pull gemma3:4b
   ```

4. **Install and start LectureLab** from this folder:

   ```bash
   npm install
   ```

   ```bash
   npm run build && npm start
   ```

   Then open <http://127.0.0.1:3000>. For development with live reload, use `npm run dev`.

The disk space needed is about 3 GB for the models plus your course files. While a model is answering, it uses about 4–5 GB of memory; after 15 minutes without use it is unloaded automatically.

### Optional: YouTube videos

Paste a free YouTube Data API v3 key in **Settings → YouTube videos** (the page explains how to get one), or put `YOUTUBE_API_KEY=...` in `.env.local`. Wikipedia explainers work without a key.

## Where your data lives

Everything is stored in the `data/` folder: the `lecturelab.db` database and `uploads/`. To back up, copy that folder. To start fresh, delete it. The app only listens on `127.0.0.1`, so other devices on your Wi-Fi can't open it.

## For developers

```bash
npm test
```

```bash
npm run typecheck && npm run lint
```

The tests cover parsing, retrieval, spaced repetition, mastery, grading, syllabus detection, the planner and the full backend flow (using a scripted test model). Architecture, database design, the retrieval approach, the roadmap and the plan for a public launch are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
