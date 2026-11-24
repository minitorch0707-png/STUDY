/**
 * End-to-end backend flow with a SCRIPTED model. The stand-in model lives only in
 * this test file so the pipeline can be tested without downloading real
 * models; the application itself never uses canned AI responses.
 */
import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ChatRequest, EmbeddingProvider, LLMProvider } from "@/lib/ai/types";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lecturelab-test-"));
process.env.LECTURELAB_DATA_DIR = tmp;
const F = (n: string) => fs.readFileSync(path.join(import.meta.dirname, "../test-fixtures/files", n));

function lastUser(req: ChatRequest) {
  return req.messages.filter((m) => m.role === "user").at(-1)!.content;
}

const DEFAULT_PIECES = ["## In a nutshell\nMens rea is the guilty mind [S1].\n", "**Beyond your materials:** Many systems use similar ideas."];
const streamPlan = { pieces: DEFAULT_PIECES, delayMs: 0, hangAfter: null as number | null, emitted: 0, kill: () => {}, reportUsage: true };

const fakeLLM: LLMProvider & { calls: string[] } = {
  name: "scripted",
  model: "scripted-test-model",
  calls: [],
  async chat(req) {
    const p = lastUser(req);
    this.calls.push(p.slice(0, 60));
    let out: unknown;
    if (p.includes("main teachable topics")) {
      out = { topics: [
        { title: "Subjective mens rea", summary: "What the accused knew.", objectives: ["Explain recklessness"], keywords: ["intention", "recklessness"], sections: [2, 3], importance: 3 },
        { title: "Objective mens rea", summary: "Reasonable person.", objectives: ["Explain negligence"], keywords: ["negligence"], sections: [4, 5], importance: 2 },
      ] };
    } else if (p.includes("exam question")) {
      out = { questions: [
        { type: "mcq", prompt: "Which state of mind requires conscious awareness of a risk?", options: ["Recklessness", "Negligence", "Strict liability", "Necessity"], correctIndex: 0, explanation: "Recklessness requires awareness [S1].", sourceId: "S1", difficulty: "medium" },
        { type: "mcq", prompt: "Bad question with duplicate options", options: ["A", "A", "B", "C"], correctIndex: 0, explanation: "", sourceId: "S1" },
        { type: "true_false", prompt: "Criminal negligence requires proof that the accused was actually aware of the risk.", correctBoolean: false, explanation: "Objective standard [S1].", sourceId: "S1" },
        { type: "short_answer", prompt: "Explain the difference between recklessness and negligence.", modelAnswer: "Recklessness is subjective awareness; negligence is an objective marked departure.", rubric: ["Recklessness involves awareness of risk", "Negligence is measured objectively"], explanation: "See slides.", sourceId: "S2" },
      ] };
    } else if (p.includes("Mark the student's answer")) {
      out = { points: [{ met: "yes", comment: "Good." }, { met: "partial", comment: "Mention reasonable person." }], missing: ["reasonable person standard"], feedback: "Solid start." };
    } else if (p.includes("flashcards")) {
      out = { cards: [{ front: "What is recklessness?", back: "Awareness of a risk and proceeding anyway.", sourceId: "S1" }, { front: "What is wilful blindness?", back: "Deliberately avoiding confirming a suspicion.", sourceId: "S1" }] };
    } else if (p.includes("personal study notes")) {
      this.calls.push(p);
      return { text: "## Key ideas\n- Recklessness requires awareness of the risk (Slide 3, Week 3 - Lecture 3 - Mens Rea)\n## Questions I asked\n- **Q:** simpler? — **A:** aware vs should have known", model: this.model };
    } else if (p.includes("knowledge checks")) {
      out = { checks: [{ question: "Mens rea means?", options: ["Guilty mind", "Guilty act", "Defence", "Sentence"], correctIndex: 0, explanation: "[S1]" }] };
    } else out = {};
    req.onUsage?.({ inputTokens: 500, outputTokens: 40, outputDurationMs: 4000 });
    return { text: JSON.stringify(out), model: this.model, outputTokens: 10, durationMs: 1 };
  },
  async *stream(req) {
    // Controlled by `streamPlan` so tests can pause a generation mid-answer.
    for (const piece of streamPlan.pieces) {
      if (streamPlan.hangAfter !== null && streamPlan.emitted >= streamPlan.hangAfter) {
        // Simulates the app quitting mid-answer; the test "kills" it with streamPlan.kill().
        await new Promise((_, reject) => (streamPlan.kill = () => reject(new Error("process exited"))));
      }
      streamPlan.emitted++;
      await new Promise((r) => setTimeout(r, streamPlan.delayMs));
      yield piece;
    }
    if (streamPlan.reportUsage) req.onUsage?.({ inputTokens: 900, outputTokens: 60, outputDurationMs: 8000 });
  },
};

const fakeEmbed: EmbeddingProvider = {
  model: "hash-embed",
  async embed(texts) {
    return texts.map((t) => {
      const v = new Array(64).fill(0);
      for (const w of t.toLowerCase().match(/[a-z]+/g) ?? []) v[[...w].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 64, 7)] += 1;
      return v;
    });
  },
};

async function until<T>(fn: () => T | undefined | null | false, ms = 10000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("timed out");
}

let m: {
  courses: typeof import("@/lib/services/courses");
  docs: typeof import("@/lib/services/documents");
  topics: typeof import("@/lib/services/topics");
  tutor: typeof import("@/lib/services/tutor");
  quiz: typeof import("@/lib/services/quiz");
  cards: typeof import("@/lib/services/flashcards");
  planner: typeof import("@/lib/services/planner");
  progress: typeof import("@/lib/services/progress");
  rag: typeof import("@/lib/rag/retrieve");
  db: typeof import("@/lib/db");
  notes: typeof import("@/lib/services/notes");
};

beforeAll(async () => {
  const ai = await import("@/lib/ai");
  ai.setProvidersForTests(fakeLLM, fakeEmbed);
  m = {
    courses: await import("@/lib/services/courses"),
    docs: await import("@/lib/services/documents"),
    topics: await import("@/lib/services/topics"),
    tutor: await import("@/lib/services/tutor"),
    quiz: await import("@/lib/services/quiz"),
    cards: await import("@/lib/services/flashcards"),
    planner: await import("@/lib/services/planner"),
    progress: await import("@/lib/services/progress"),
    rag: await import("@/lib/rag/retrieve"),
    db: await import("@/lib/db"),
    notes: await import("@/lib/services/notes"),
  };
});

describe("full learning flow", () => {
  let courseId: string;
  let lectureId: string;
  let topicId: string;

  it("creates a course, ingests files, finds topics and syllabus dates", async () => {
    courseId = m.courses.createCourse({ title: "LAW 101 Criminal Law", code: "LAW101" }).id;
    const r1 = m.docs.addUpload(courseId, "Week 3 - Lecture 3 - Mens Rea.pptx", F("Week 3 - Lecture 3 - Mens Rea.pptx"));
    const r2 = m.docs.addUpload(courseId, "LAW101 Syllabus.docx", F("LAW101 Syllabus.docx"));
    const bad = m.docs.addUpload(courseId, "virus.pdf", Buffer.from("MZ...."));
    expect(bad.ok).toBe(false);
    if (!r1.ok || !r2.ok) throw new Error("upload failed");
    lectureId = r1.document.id;
    await until(() => m.docs.listDocuments(courseId).every((d) => d.status === "ready" || d.status === "failed"));
    const docs = m.docs.listDocuments(courseId);
    expect(docs.map((d) => d.status)).toEqual(["ready", "ready"]);
    expect(docs.find((d) => d.id === lectureId)!.week).toBe(3);

    // Duplicate upload is recognised, not reprocessed.
    const dup = m.docs.addUpload(courseId, "copy.pptx", F("Week 3 - Lecture 3 - Mens Rea.pptx"));
    expect(dup.ok && dup.duplicate).toBe(true);

    const topics = m.topics.listTopics(courseId);
    expect(topics.map((t) => t.title)).toEqual(["Subjective mens rea", "Objective mens rea"]);
    topicId = topics[0].id;
    expect(m.topics.topicSections(topicId).map((s) => s.label)).toEqual(["Slide 2", "Slide 3"]);

    const events = m.planner.listCalendar({ courseId, includeUnconfirmed: true });
    expect(events.map((e) => e.title)).toContain("Midterm Exam");
    expect(events.every((e) => e.confirmed === 0)).toBe(true); // student must confirm
  });

  it("retrieves grounded sources with hybrid search", async () => {
    const { chunks, mode } = await m.rag.retrieve({ courseId, query: "conscious awareness of a risk recklessness" });
    expect(mode).toBe("hybrid");
    expect(chunks[0].sectionLabel).toBe("Slide 3");
    const { block } = m.rag.formatSources(chunks.slice(0, 1));
    expect(block).toContain('<source id="S1"');
  });

  it("writes the lesson in the background; a viewer can leave and re-attach mid-stream", async () => {
    Object.assign(streamPlan, { pieces: ["## In a nutshell\n", "Mens rea is the guilty mind [S1].\n", "**Beyond your materials:** Many systems use similar ideas."], delayMs: 60, emitted: 0 });
    const lessonId = m.tutor.startLesson(topicId);
    // First viewer reads a little, then "leaves the page".
    const first = m.tutor.followLesson(lessonId, 0);
    const seen: string[] = [];
    for await (const ev of first) {
      if (ev.type === "text") seen.push(ev.text);
      if (seen.length === 1) break;
    }
    expect(m.tutor.startLesson(topicId)).toBe(lessonId); // revisiting doesn't start a second lesson
    // Second viewer re-attaches from where the first left off and gets the rest exactly once.
    const offset = seen.join("").length;
    let rest = "";
    const events: string[] = [];
    for await (const ev of m.tutor.followLesson(lessonId, offset)) {
      events.push(ev.type);
      if (ev.type === "text") rest += ev.text;
    }
    expect(events.at(-1)).toBe("done");
    expect(seen.join("") + rest).toBe(streamPlan.pieces.join(""));
    Object.assign(streamPlan, { pieces: DEFAULT_PIECES, delayMs: 0 });
    const lesson = m.tutor.getLesson(topicId)!;
    expect(lesson.status).toBe("complete");
    expect(lesson.verification).toMatchObject({ cited: [1], invalid: [] });
    expect(lesson.content).toContain("[S1]");
    expect(lesson.sources.length).toBeGreaterThan(0);
    const checks = await m.tutor.lessonChecks(topicId);
    expect(checks[0].options[checks[0].correctIndex]).toBe("Guilty mind");
  });

  it("adapts teaching after repeated wrong answers", async () => {
    m.tutor.answerCheck(topicId, false);
    m.tutor.answerCheck(topicId, false);
    const { assistantMessageId } = m.tutor.sendTutorMessage({ topicId, action: "simpler", clientId: "c-simpler" });
    const evs = [];
    for await (const ev of m.tutor.followMessage(assistantMessageId, 0)) evs.push(ev);
    expect(evs.find((e) => e.type === "meta" && "adaptive" in e)).toMatchObject({ adaptive: true });
    expect(m.tutor.getMessage(assistantMessageId)!.status).toBe("complete");
  });

  it("survives a restart mid-answer: draft, partial text, sources, interrupted state, retry without duplicates", async () => {
    m.tutor.updateThread(topicId, { draft: "and what about wilful blindness?" });
    Object.assign(streamPlan, { pieces: ["Recklessness means ", "being aware of a risk [S1]", " and taking it anyway."], delayMs: 10, hangAfter: 2, emitted: 0 });
    const sent = m.tutor.sendTutorMessage({ topicId, message: "Explain recklessness", clientId: "c-reckless" });
    m.tutor.updateThread(topicId, { draft: "and what about wilful blindness?" });
    await until(() => (m.tutor.getMessage(sent.assistantMessageId)!.content.length > 20 ? true : null), 3000); // checkpointed to disk
    // Simulate the app quitting: the in-memory generation is gone; restart marks it interrupted.
    (globalThis as { __llLive?: Map<string, unknown> }).__llLive!.clear();
    streamPlan.kill(); // the old process's generation ends; it must not touch the database any more
    await new Promise((r) => setTimeout(r, 50));
    m.tutor.markInterruptedGenerations();
    const after = m.tutor.getMessage(sent.assistantMessageId)!;
    expect(after.status).toBe("interrupted");
    expect(after.content).toBe("Recklessness means being aware of a risk [S1]"); // last checkpoint kept
    expect(after.sources.length).toBeGreaterThan(0);
    expect(m.tutor.getThread(topicId)!.draft).toBe("and what about wilful blindness?");
    expect(m.tutor.getThread(topicId)!.resume_message_id).toBe(sent.assistantMessageId);
    expect(m.tutor.resumeTarget()!.topic_id).toBe(topicId);

    // Sending again with the same client id (e.g. a double click or a network retry) creates nothing new.
    const before = m.tutor.getChat(topicId).length;
    const again = m.tutor.sendTutorMessage({ topicId, message: "Explain recklessness", clientId: "c-reckless" });
    expect(again).toMatchObject({ duplicate: true, assistantMessageId: sent.assistantMessageId });
    // Retry finishes the same message in place.
    Object.assign(streamPlan, { hangAfter: null, emitted: 0, delayMs: 0 });
    expect(m.tutor.retryAnswer(sent.assistantMessageId)).toBe(true);
    await until(() => (m.tutor.getMessage(sent.assistantMessageId)!.status === "complete" ? true : null));
    expect(m.tutor.getChat(topicId).length).toBe(before);
    expect(m.tutor.getMessage(sent.assistantMessageId)!.content).toBe("Recklessness means being aware of a risk [S1] and taking it anyway.");
    Object.assign(streamPlan, { pieces: DEFAULT_PIECES });
  });

  it("turns the tutor conversation into notes, keeping the student's edits", async () => {
    const chat = m.tutor.getChat(topicId);
    const answer = chat.find((c) => c.role === "assistant" && c.status === "complete")!;
    // One-click save works without AI, makes citations readable, and is idempotent.
    expect(m.notes.saveMessageToNotes(topicId, answer.id).alreadySaved).toBe(false);
    expect(m.notes.saveMessageToNotes(topicId, answer.id).alreadySaved).toBe(true);
    let { note } = m.notes.topicNote(topicId);
    expect(note!.content.match(/### Saved:/g)).toHaveLength(1);
    expect(note!.content).not.toMatch(/\[S\d\]/);
    // The student edits their notes; the automatic update must be told to keep that.
    m.notes.updateNote(note!.id, { content: note!.content + "\nMY OWN MNEMONIC: aware = reckless" });
    await m.notes.refreshTopicNotes(topicId);
    const prompt = fakeLLM.calls.filter((c) => c.includes("personal study notes")).at(-1)!;
    expect(prompt).toContain("MY OWN MNEMONIC");
    expect(prompt).toContain("KEEP their wording");
    note = m.notes.topicNote(topicId).note;
    expect(note!.content).toContain("## Key ideas");
    expect(note!.synced_until).toBeTruthy();
    expect(m.notes.listNotes({ q: "Recklessness" }).length).toBe(1);
  });

  it("generates a quiz, rejects bad questions, grades objective + written answers", async () => {
    const quizId = m.quiz.createQuiz(m.quiz.quizConfigSchema.parse({ courseId, count: 3, topicIds: [topicId], types: ["mcq", "true_false", "short_answer"] }));
    await until(() => m.quiz.getQuiz(quizId)!.status !== "generating");
    expect(m.quiz.getQuiz(quizId)!.status).toBe("ready");
    const attemptId = m.quiz.startAttempt(quizId);
    const a = m.quiz.getAttempt(attemptId)!;
    expect(a.questions).toHaveLength(3);
    expect(a.questions.some((q) => q.prompt.startsWith("Bad question"))).toBe(false);
    expect("answer" in a.questions[0]).toBe(false); // answers hidden before submitting

    const mcq = a.questions.find((q) => q.type === "mcq")! as unknown as { id: string; options: string[] };
    const tf = a.questions.find((q) => q.type === "true_false")!;
    const sa = a.questions.find((q) => q.type === "short_answer")!;
    m.quiz.saveAnswer(attemptId, mcq.id, mcq.options.indexOf("Negligence")); // wrong
    m.quiz.saveAnswer(attemptId, tf.id, false); // right
    m.quiz.saveAnswer(attemptId, sa.id, "Recklessness means being aware of the risk.");
    m.quiz.submitAttempt(attemptId);
    await until(() => m.quiz.getAttempt(attemptId)!.attempt.status === "graded");
    const done = m.quiz.getAttempt(attemptId)!;
    // mcq 0/1 + tf 1/1 + short answer 1.5 of 2 rubric points × 3 = 2.25
    expect(done.attempt.score).toBeCloseTo(3.25);
    expect(done.attempt.max_score).toBe(5);
    const saDone = done.questions.find((q) => q.id === sa.id)! as unknown as { response: { feedback: { missing: string[] } }; source: unknown };
    expect(saDone.response.feedback.missing).toContain("reasonable person standard");
    expect(saDone.source).toBeTruthy();

    // Retake my mistakes creates a new focused quiz.
    const retakeId = m.quiz.retakeMistakes(attemptId);
    expect(retakeId).toBeTruthy();
    await until(() => m.quiz.getQuiz(retakeId!)!.status !== "generating");
  });

  it("generates flashcards and schedules reviews", async () => {
    const deckId = m.cards.generateDeck(topicId, 5);
    await until(() => m.cards.listDecks(courseId).find((d) => d.id === deckId)?.status === "ready");
    const q = m.cards.reviewQueue({ deckId });
    expect(q).toHaveLength(2);
    expect((q[0] as Record<string, unknown>).source_label).toBeTruthy(); // traceable to a slide
    const r = m.cards.reviewCard(q[0].id, 4);
    expect(r.state).toBe("review");
    expect(m.cards.reviewQueue({ deckId })).toHaveLength(1);
  });

  it("builds mastery, recommendations and a study plan from real activity", () => {
    const weak = m.topics.topicMastery(topicId);
    expect(weak.attempts).toBeGreaterThanOrEqual(3);
    const exam = m.planner.listCalendar({ courseId, includeUnconfirmed: true }).find((e) => e.kind === "exam")!;
    const future = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    m.planner.updateEvent(exam.id, { confirmed: true, date: future });
    const planId = m.planner.createPlan({ courseId, examDate: future, dailyMinutes: 60, examEventId: exam.id });
    const plan = m.planner.listPlans().find((p) => p.id === planId)!;
    expect(plan.items.some((i) => i.kind === "mock_exam")).toBe(true);
    const dash = m.progress.dashboard();
    expect(dash.upcoming[0].title).toBe("Midterm Exam");
    expect(dash.plan.length).toBeGreaterThan(0);
    const report = m.progress.progressReport(courseId);
    expect(report.scores).toHaveLength(1);
    expect(report.flashcards.total).toBe(2);
  });

  it("records Study activity (metadata only), counts a retried answer once, and keeps totals after a restart", async () => {
    const act = await import("@/lib/services/activity");
    const r = act.activityReport("7d");
    expect(r.runs).toBeGreaterThan(5);
    expect(r.tokensProcessed).toBeGreaterThan(0);
    expect(r.allLocal).toBe(true);
    // The restart test's answer was retried; it still counts as exactly one completed reply.
    const replies = m.db.db().prepare("SELECT COUNT(*) n FROM usage_events WHERE task='tutor' AND completed=1").get() as { n: number };
    expect(r.completedReplies).toBeLessThanOrEqual(replies.n);
    expect(r.completedReplies).toBe(new Set((m.db.db().prepare("SELECT reply_id FROM usage_events WHERE task='tutor' AND completed=1").all() as { reply_id: string }[]).map((x) => x.reply_id)).size);
    // No content is stored: the table has no text columns for prompts or answers.
    const cols = (m.db.db().prepare("PRAGMA table_info(usage_events)").all() as { name: string }[]).map((c) => c.name);
    expect(cols.some((c) => /prompt|answer|content|course|file/.test(c))).toBe(false);

    // A run whose runtime reports no counts is shown as "missing", not silently as zero.
    streamPlan.reportUsage = false;
    const sent = m.tutor.sendTutorMessage({ topicId, message: "One more question", clientId: "c-nocount" });
    await until(() => (m.tutor.getMessage(sent.assistantMessageId)!.status === "complete" ? true : null));
    streamPlan.reportUsage = true;
    const r2 = act.activityReport("7d");
    expect(r2.runsMissingCounts).toBe(r.runsMissingCounts + 1);
    expect(r2.tokensProcessed).toBe(r.tokensProcessed);

    // "Restart": a fresh database connection to the same file sees the same totals.
    const file = path.join(tmp, "lecturelab.db");
    const original = m.db.db();
    m.db.setDatabaseForTests(m.db.openDatabase(file));
    expect(act.activityReport("7d")).toEqual(r2);
    m.db.setDatabaseForTests(original);
  });

  it("deleting a course removes its files and data", () => {
    m.courses.deleteCourse(courseId);
    expect(m.docs.getDocument(lectureId)).toBeNull();
    const n = (m.db.db().prepare("SELECT COUNT(*) n FROM chunks").get() as { n: number }).n;
    expect(n).toBe(0);
    expect(fs.existsSync(path.join(tmp, "uploads", courseId))).toBe(false);
  });
});
