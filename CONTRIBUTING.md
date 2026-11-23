# Contributing to LectureLab

Thanks for helping! This guide is written for people who are new to the project, and new to coding.

## 1. Run it locally

You need [Node.js 22+](https://nodejs.org) and, for the AI features, [Ollama](https://ollama.com).

```bash
npm install
```

```bash
npm run dev
```

Open http://127.0.0.1:3000. The page reloads automatically when you change code.

To use the AI, install the models once:

```bash
ollama pull qwen3:4b && ollama pull nomic-embed-text
```

## 2. Find where to make your change

| I want to… | Look in |
|---|---|
| Change how a page looks | `src/app/<page>/page.tsx` (for example `src/app/flashcards/page.tsx`) |
| Change a shared button, card or colour | `src/components/ui.tsx` and `src/app/globals.css` |
| Make the AI tutor teach differently | `src/lib/ai/prompts.ts` |
| Fix how a PowerPoint/PDF/Word file is read | `src/lib/ingest/parsers/` |
| Change flashcard scheduling or mastery scores | `src/lib/learning/` |
| Add a database field | add a **new** migration at the end of `src/lib/db/migrations.ts` (never edit old ones) |

## 3. Check your work

Run these before opening a pull request. Automatic checks run the same commands on GitHub:

```bash
npm run typecheck && npm run lint && npm test
```

If you fix a bug, add a test that would have caught it (see the `tests/` folder for examples). If a file failed to upload or parse, you can add a small sample of it to `test-fixtures/files/` (only files you have the right to share).

## 4. Open a pull request

1. Create a branch: `git checkout -b fix/short-description`.
2. Commit with a clear message ("Fix: PowerPoint tables lose their last row").
3. Push and open a pull request. The template will ask what you changed and how you tested it.

## Ground rules

- **Never fake AI output.** If the AI is unavailable, show a helpful message instead.
- **Ground answers in course files.** Anything not from the student's materials must be labelled as such.
- **Keep it private.** Student files must never be sent anywhere without the student's clear action.
- **Keep it simple for students.** If something needs explaining, the design probably needs work.
