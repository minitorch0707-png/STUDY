# LectureLab

LectureLab turns your lecture slides, readings and syllabi into structured lessons, practice exams, flashcards and a study plan. Its AI tutor runs **on your own computer** using free, open-weight models, so you pay nothing for AI and your course files stay on your machine.

- **Courses & uploads**: drag in PDF, PowerPoint (.pptx), Word (.docx), text or markdown files. LectureLab reads them page by page or slide by slide and keeps headings, tables and speaker notes.
- **AI Tutor**: structured lessons, quick actions ("Explain simpler", "Quiz me", …), Socratic mode, and teaching that adapts when you struggle. Every claim links to the exact slide or page it came from.
- **Practice exams**: multiple choice, true/false, short answer, essay, definitions, scenarios and matching. Objective answers are graded instantly; written answers are graded against a visible rubric, and "Retake my mistakes" builds a new quiz on what you got wrong.
- **Flashcards** with spaced repetition (Again / Hard / Good / Easy) and keyboard shortcuts.
- **Study planner**: exam dates detected from your syllabus (you confirm them), day-by-day plans and an Exam Cram mode.
- **Progress**: mastery per topic, calculated only from your real answers.

## Install on your Mac (one step)

1. Open **Terminal**: press `⌘ Command` + `Space`, type `Terminal`, press `Return`.
2. Copy this line, paste it into Terminal, and press `Return`:

   ```bash
   bash -c "$(curl -fsSL https://raw.githubusercontent.com/minitorch0707-png/study/main/install.sh)"
   ```

3. Wait. It installs everything (Node.js, LectureLab, the Ollama AI app and the AI models, about 3 GB in total) and opens LectureLab in your browser when it's finished. The model download is the slowest part (usually 5–15 minutes). If Ollama shows a welcome window, click through it.

After that, **double-click `LectureLab` on your Desktop** whenever you want to study. Keep the Terminal window it opens running while you use the app; close it to stop.

- To **update**, run the same line again. Your courses and progress are kept.
- Everything goes into a `LectureLab` folder in your home folder. Your data is in `~/LectureLab/data`.
- No admin password is needed. The only thing installed outside that folder is the Ollama app (into Applications).

<details>
<summary>Manual setup (for developers)</summary>

Install Node.js 22+ and Ollama, then run `ollama pull qwen3:4b`, `ollama pull nomic-embed-text`, `npm install`, `npm run build && npm start`, and open http://127.0.0.1:3000. Use `npm run dev` for live reload.

</details>

### Optional: YouTube videos

Paste a free YouTube Data API v3 key in **Settings → YouTube videos** (the page explains how to get one), or put `YOUTUBE_API_KEY=...` in `.env.local`. Wikipedia explainers work without a key.

## Where your data lives

Everything is stored in one folder: `~/LectureLab/data` with the one-step installer, or `data/` in the project folder for a manual setup. It holds the `lecturelab.db` database and `uploads/`. To back up, copy that folder. To start fresh, delete it. The app only listens on `127.0.0.1`, so other devices on your Wi-Fi can't open it.

## For developers

```bash
npm test
```

```bash
npm run typecheck && npm run lint
```

The tests cover parsing, retrieval, spaced repetition, mastery, grading, syllabus detection, the planner and the full backend flow (using a scripted test model). Architecture, database design, the retrieval approach, the roadmap and the plan for a public launch are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
