# Roadmap

Items marked ✅ are done. The next milestone is at the top. Want to help? Pick an unchecked item and open an issue saying you're on it.

## Milestone 1: Reliable on real student files (now)

- [x] Read real PowerPoint files (tested against decks made in PowerPoint, with notes, nested bullets and merged table cells)
- [x] Accept large, photo-heavy decks (up to 250 MB)
- [x] Clear guidance for `.ppt`, `.doc`, Keynote and Pages files
- [x] Tolerate small-model output quirks (numbers sent as text)
- [ ] Read scanned PDFs (render each page and send it to the vision model for text recognition)
- [ ] Convert `.ppt` automatically when LibreOffice is installed
- [ ] "Report a problem file" button that saves a diagnostic summary (no content) to attach to an issue
- [ ] Windows installer

## Milestone 2: Better teaching quality

- [ ] An evaluation set: 50 lessons and 100 questions rated against real slides, run with one command
- [ ] Compare `qwen3:4b` and `qwen3:8b` using that set; publish the results in `docs/`
- [ ] "Teach it back": the student explains a concept and the tutor grades it with the rubric pipeline
- [ ] Interactive concept map built from topics and keywords
- [ ] Export a study guide (PDF) per topic or per exam

## Milestone 3: Hosted version (needed before charging money; see [BUSINESS.md](BUSINESS.md))

- [ ] Accounts and login (Supabase Auth)
- [ ] Move data to Postgres + pgvector with row-level security, so students can never see each other's data
- [ ] File storage in private buckets
- [ ] Hosted open-weight model inference (vLLM, or a hosted API) via the existing OpenAI-compatible provider
- [ ] Usage limits per plan
- [ ] Stripe billing (checkout, customer portal, webhooks)
- [ ] Privacy policy, terms of service, data deletion

## Milestone 4: Social and advanced

- [ ] Shared flashcard decks and study rooms
- [ ] Voice tutoring (local speech-to-text and text-to-speech)
- [ ] Calendar export (.ics) and reminders
- [ ] Instructor dashboard (for institutional licences)

## Done

- [x] Courses, uploads, parsing, topics, document viewer
- [x] AI tutor with citations, quick actions, Socratic and adaptive modes
- [x] Practice exams in 7 formats with rubric grading and "Retake my mistakes"
- [x] Spaced-repetition flashcards
- [x] Syllabus date detection, study planner, Exam Cram
- [x] Progress analytics and recommendations
- [x] Local model management and benchmark
- [x] One-step Mac installer
