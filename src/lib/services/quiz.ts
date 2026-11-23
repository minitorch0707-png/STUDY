import "server-only";
import { z } from "zod";
import { db, newId, nowIso, parseJson } from "@/lib/db";
import { generateJson, getLLM, requireChatModel } from "@/lib/ai";
import { QUESTION_TYPES, TUTOR_SYSTEM, gradePrompt, quizPrompt, type QuestionType } from "@/lib/ai/prompts";
import { chunksByIds, formatSources, retrieve, type RetrievedChunk } from "@/lib/rag/retrieve";
import { fingerprint, gradeObjective, isWritten, maxScoreFor, scoreRubric, seededShuffle, similarity, type QuestionData, type RubricVerdict } from "@/lib/learning/grading";
import { logGeneration, runInBackground } from "./generations";
import { getTopic, recordEvent, topicMastery, topicSectionIds } from "./topics";
import { isPro } from "@/lib/license";

export const quizConfigSchema = z.object({
  courseId: z.string(),
  title: z.string().max(120).optional(),
  count: z.number().int().min(1).max(40).default(10),
  difficulty: z.enum(["easy", "medium", "hard", "mixed"]).default("medium"),
  topicIds: z.array(z.string()).default([]),
  types: z.array(z.enum(QUESTION_TYPES)).min(1).default(["mcq", "true_false", "short_answer"]),
  mode: z.enum(["practice", "exam"]).default("practice"),
  timeLimitMinutes: z.number().int().min(1).max(300).nullable().default(null),
  immediateFeedback: z.boolean().default(true),
});
export type QuizConfig = z.infer<typeof quizConfigSchema>;

/** "2" → 2, but null/undefined stay missing (so an incomplete question is rejected, not guessed). */
export const numericString = (v: unknown) => (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v)) ? Number(v) : v);

const questionSchema = z.object({
  questions: z.array(
    z.object({
      type: z.enum(QUESTION_TYPES),
      prompt: z.string().min(8).max(2000),
      options: z.array(z.string()).nullable().optional(),
      correctIndex: z.preprocess(numericString, z.number().int().nullable().optional()),
      correctBoolean: z.preprocess((v) => (typeof v === "string" ? v.toLowerCase() === "true" : v), z.boolean().nullable().optional()),
      pairs: z.array(z.object({ left: z.string(), right: z.string() })).nullable().optional(),
      modelAnswer: z.string().nullable().optional(),
      rubric: z.array(z.union([z.string(), z.object({ point: z.string() }).transform((r) => r.point)])).nullable().optional(),
      explanation: z.string().default(""),
      sourceId: z.string().nullable().optional(),
      difficulty: z.string().nullable().optional(),
    }),
  ),
});
type RawQuestion = z.infer<typeof questionSchema>["questions"][number];

/** Check a generated question is complete and usable; normalise its data. Exported for tests. */
export function normaliseQuestion(q: RawQuestion, allowed: QuestionType[], seed: string): { data: QuestionData; type: QuestionType } | null {
  if (!allowed.includes(q.type)) return null;
  if (q.type === "mcq") {
    const opts = (q.options ?? []).map((o) => o.trim()).filter(Boolean);
    if (opts.length < 4 || opts.length > 5 || new Set(opts.map((o) => o.toLowerCase())).size !== opts.length) return null;
    if (q.correctIndex == null || q.correctIndex < 0 || q.correctIndex >= opts.length) return null;
    if (opts.some((o) => /^(all|none) of the above$/i.test(o))) return null;
    const order = seededShuffle(opts.map((_, i) => i), seed);
    return { type: "mcq", data: { options: order.map((i) => opts[i]), correctIndex: order.indexOf(q.correctIndex) } };
  }
  if (q.type === "true_false") {
    if (typeof q.correctBoolean !== "boolean") return null;
    return { type: "true_false", data: { correctBoolean: q.correctBoolean } };
  }
  if (q.type === "matching") {
    const pairs = (q.pairs ?? []).filter((p) => p.left.trim() && p.right.trim());
    if (pairs.length < 3 || new Set(pairs.map((p) => p.right)).size !== pairs.length) return null;
    return { type: "matching", data: { pairs, shuffledRights: seededShuffle(pairs.map((p) => p.right), seed) } };
  }
  // Written questions need a model answer and a rubric to be marked fairly.
  const rubric = (q.rubric ?? []).map((r) => r.trim()).filter(Boolean);
  if (!q.modelAnswer?.trim() || rubric.length < 2) return null;
  return { type: q.type, data: { modelAnswer: q.modelAnswer.trim(), rubric: rubric.slice(0, 6).map((point) => ({ point, weight: 1 })) } };
}

export function createQuiz(config: QuizConfig, parentAttemptId?: string, focus?: { topicId: string | null; prompt: string; chunkId: string | null }[]) {
  const id = newId();
  const title =
    config.title ||
    (parentAttemptId ? "Retake: my mistakes" : config.mode === "exam" ? "Mock exam" : `Practice quiz`) + ` · ${new Date().toLocaleDateString("en", { month: "short", day: "numeric" })}`;
  db()
    .prepare("INSERT INTO quizzes (id, course_id, title, config, status, progress, parent_attempt_id, created_at) VALUES (?,?,?,?, 'generating', 0, ?, ?)")
    .run(id, config.courseId, title, JSON.stringify(config), parentAttemptId ?? null, nowIso());
  runInBackground("quiz", () => generateQuestions(id, config, focus));
  return id;
}

function setQuizStatus(id: string, status: string, detail: string | null, progress: number) {
  db().prepare("UPDATE quizzes SET status = ?, status_detail = ?, progress = ? WHERE id = ?").run(status, detail, progress, id);
}

async function generateQuestions(quizId: string, config: QuizConfig, focus?: { topicId: string | null; prompt: string; chunkId: string | null }[]) {
  try {
    await requireChatModel();
    let topicIds = config.topicIds.length
      ? config.topicIds
      : (db().prepare("SELECT id FROM topics WHERE course_id = ? ORDER BY importance DESC, ord").all(config.courseId) as { id: string }[]).map((r) => r.id);
    if (focus?.length) topicIds = [...new Set(focus.map((f) => f.topicId).filter((t): t is string => Boolean(t)))];
    if (!topicIds.length) throw new Error("This course has no topics yet. Upload and process some lecture material first.");

    // Weight topics toward the student's weak areas (more questions where they struggle).
    const weights = topicIds.map((t) => {
      const m = topicMastery(t);
      return m.status === "weak" ? 2 : m.status === "developing" ? 1.4 : 1;
    });
    const plan: string[] = [];
    const totalW = weights.reduce((a, b) => a + b, 0);
    topicIds.forEach((t, i) => {
      const n = Math.max(1, Math.round((config.count * weights[i]) / totalW));
      for (let k = 0; k < n; k++) plan.push(t);
    });
    const order = plan.slice(0, config.count);
    while (order.length < config.count) order.push(topicIds[order.length % topicIds.length]);

    // Group into batches of up to 4 questions per topic.
    const batches: { topicId: string; count: number }[] = [];
    for (const t of topicIds) {
      let n = order.filter((x) => x === t).length;
      while (n > 0) {
        batches.push({ topicId: t, count: Math.min(4, n) });
        n -= 4;
      }
    }

    const existing = db().prepare("SELECT prompt, fingerprint, topic_id FROM questions WHERE course_id = ?").all(config.courseId) as { prompt: string; fingerprint: string; topic_id: string | null }[];
    const ins = db().prepare(
      "INSERT INTO questions (id, quiz_id, course_id, topic_id, chunk_id, ord, type, difficulty, prompt, data, explanation, max_score, fingerprint) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    );
    let made = 0;
    const llm = getLLM();
    const difficulties = ["easy", "medium", "hard"];

    for (let b = 0; b < batches.length && made < config.count; b++) {
      const { topicId, count } = batches[b];
      const topic = getTopic(topicId);
      if (!topic) continue;
      const focusHere = focus?.filter((f) => f.topicId === topicId) ?? [];
      let chunks: RetrievedChunk[] = chunksByIds(focusHere.map((f) => f.chunkId).filter((c): c is string => Boolean(c)));
      if (chunks.length < 3) {
        // Vary the query per batch so different parts of the material get used.
        const angle = [topic.title, ...topic.keywords, ...topic.objectives][b % Math.max(1, 1 + topic.keywords.length + topic.objectives.length)];
        const r = await retrieve({ courseId: config.courseId, query: `${topic.title} ${angle}`, preferSectionIds: topicSectionIds(topicId), limit: 4 });
        const have = new Set(chunks.map((c) => c.chunkId));
        chunks = [...chunks, ...r.chunks.filter((c) => !have.has(c.chunkId))].slice(0, 4);
      }
      if (!chunks.length) continue;
      const { block } = formatSources(chunks);
      const avoid = existing.filter((e) => e.topic_id === topicId).slice(-12).map((e) => e.prompt.slice(0, 140));
      const difficulty = config.difficulty === "mixed" ? difficulties[b % 3] : config.difficulty;
      const types = seededShuffle(config.types, `${quizId}-${b}`).slice(0, Math.min(config.types.length, count + 1));
      const prompt = quizPrompt({ sources: block, topicTitle: topic.title, types, count, difficulty, avoid, focus: focusHere.map((f) => f.prompt) });

      setQuizStatus(quizId, "generating", `Writing questions on “${topic.title}” (${made}/${config.count})…`, made / config.count);
      const started = Date.now();
      let res;
      try {
        res = await generateJson(questionSchema, { messages: [{ role: "system", content: TUTOR_SYSTEM }, { role: "user", content: prompt }], temperature: 0.6 });
      } catch (e) {
        console.warn("question batch failed", e);
        continue;
      }
      logGeneration({ task: "quiz", model: llm.model, prompt, output: JSON.stringify(res), durationMs: Date.now() - started, refId: quizId });

      for (const q of res.questions) {
        if (made >= config.count) break;
        const fp = fingerprint(q.prompt);
        if (existing.some((e) => similarity(e.fingerprint, fp) >= 0.8)) continue; // avoid repeats
        const norm = normaliseQuestion(q, config.types, `${quizId}-${made}`);
        if (!norm) continue;
        const srcN = Number(/S?(\d+)/.exec(q.sourceId ?? "")?.[1] ?? 1);
        const chunk = chunks[srcN - 1] ?? chunks[0];
        ins.run(newId(), quizId, config.courseId, topicId, chunk.chunkId, made, norm.type, q.difficulty || difficulty, q.prompt.trim(), JSON.stringify(norm.data), q.explanation, maxScoreFor(norm.type), fp);
        existing.push({ prompt: q.prompt, fingerprint: fp, topic_id: topicId });
        made++;
      }
    }

    if (made === 0) throw new Error("The model couldn't produce usable questions from this material. Try different topics or question types.");
    setQuizStatus(quizId, "ready", made < config.count ? `Created ${made} of ${config.count} questions (some drafts were rejected for quality).` : null, 1);
  } catch (e) {
    setQuizStatus(quizId, "failed", (e as Error).message.slice(0, 500), 1);
  }
}

export function listQuizzes(courseId?: string) {
  return db()
    .prepare(
      `SELECT q.*, c.title course_title, c.color course_color, (SELECT COUNT(*) FROM questions x WHERE x.quiz_id = q.id) question_count,
        (SELECT json_object('id', a.id, 'score', a.score, 'max', a.max_score, 'status', a.status, 'at', COALESCE(a.submitted_at, a.started_at)) FROM attempts a WHERE a.quiz_id = q.id ORDER BY a.started_at DESC LIMIT 1) last_attempt
       FROM quizzes q JOIN courses c ON c.id = q.course_id ${courseId ? "WHERE q.course_id = ?" : ""} ORDER BY q.created_at DESC LIMIT 100`,
    )
    .all(...(courseId ? [courseId] : []))
    .map((r) => {
      const row = r as Record<string, unknown>;
      return { ...row, config: parseJson(row.config, {}), last_attempt: parseJson(row.last_attempt, null) };
    });
}

interface QuestionRow {
  id: string;
  quiz_id: string;
  topic_id: string | null;
  chunk_id: string | null;
  ord: number;
  type: QuestionType;
  difficulty: string;
  prompt: string;
  data: string;
  explanation: string | null;
  max_score: number;
}

/** Questions as the student sees them — answers stripped unless revealed. */
function publicQuestion(q: QuestionRow, reveal: boolean) {
  const data = parseJson<QuestionData>(q.data, {});
  const base = { id: q.id, ord: q.ord, type: q.type, difficulty: q.difficulty, prompt: q.prompt, maxScore: q.max_score, topicId: q.topic_id };
  const shown: Record<string, unknown> = {};
  if (q.type === "mcq") shown.options = data.options;
  if (q.type === "matching") {
    shown.lefts = data.pairs?.map((p) => p.left);
    shown.rights = data.shuffledRights;
  }
  if (isWritten(q.type)) shown.rubricCount = data.rubric?.length ?? 0;
  if (!reveal) return { ...base, ...shown };
  const src = q.chunk_id ? chunksByIds([q.chunk_id])[0] : undefined;
  return {
    ...base,
    ...shown,
    answer: { correctIndex: data.correctIndex, correctBoolean: data.correctBoolean, pairs: data.pairs, modelAnswer: data.modelAnswer, rubric: data.rubric },
    explanation: q.explanation,
    source: src ? { documentId: src.documentId, documentName: src.documentName, sectionIdx: src.sectionIdx, sectionLabel: src.sectionLabel, excerpt: src.text.slice(0, 300) } : null,
  };
}

export function getQuiz(quizId: string) {
  const quiz = db().prepare("SELECT q.*, c.title course_title FROM quizzes q JOIN courses c ON c.id = q.course_id WHERE q.id = ?").get(quizId) as Record<string, unknown> | undefined;
  if (!quiz) return null;
  return { ...quiz, config: parseJson<QuizConfig>(quiz.config, {} as QuizConfig) } as Record<string, unknown> & { id: string; course_id: string; status: string; config: QuizConfig };
}

export function startAttempt(quizId: string) {
  const open = db().prepare("SELECT id FROM attempts WHERE quiz_id = ? AND status = 'in_progress' ORDER BY started_at DESC LIMIT 1").get(quizId) as { id: string } | undefined;
  if (open) return open.id;
  const id = newId();
  db().prepare("INSERT INTO attempts (id, quiz_id, status, started_at) VALUES (?,?, 'in_progress', ?)").run(id, quizId, nowIso());
  return id;
}

export function getAttempt(attemptId: string) {
  const a = db().prepare("SELECT * FROM attempts WHERE id = ?").get(attemptId) as
    | { id: string; quiz_id: string; status: string; started_at: string; submitted_at: string | null; score: number | null; max_score: number | null }
    | undefined;
  if (!a) return null;
  const quiz = getQuiz(a.quiz_id)!;
  const questions = db().prepare("SELECT * FROM questions WHERE quiz_id = ? ORDER BY ord").all(a.quiz_id) as QuestionRow[];
  const responses = db().prepare("SELECT * FROM responses WHERE attempt_id = ?").all(attemptId) as {
    question_id: string;
    answer: string | null;
    score: number | null;
    status: string;
    feedback: string | null;
    graded_by: string | null;
  }[];
  const byQ = new Map(responses.map((r) => [r.question_id, r]));
  const finished = a.status !== "in_progress";
  const topicTitles = new Map(
    (db().prepare("SELECT id, title FROM topics WHERE course_id = ?").all(quiz.course_id) as { id: string; title: string }[]).map((t) => [t.id, t.title]),
  );
  return {
    attempt: a,
    quiz,
    questions: questions.map((q) => {
      const r = byQ.get(q.id);
      const revealed = finished || (quiz.config.immediateFeedback && quiz.config.mode === "practice" && r?.status !== undefined && r.status !== "pending");
      return {
        ...publicQuestion(q, Boolean(revealed)),
        topicTitle: q.topic_id ? topicTitles.get(q.topic_id) ?? null : null,
        response: r ? { answer: parseJson(r.answer, null), score: r.score, status: r.status, feedback: parseJson(r.feedback, null), gradedBy: r.graded_by } : null,
      };
    }),
  };
}

export function saveAnswer(attemptId: string, questionId: string, answer: unknown) {
  db()
    .prepare(
      `INSERT INTO responses (id, attempt_id, question_id, answer, status) VALUES (?,?,?,?, 'pending')
       ON CONFLICT(attempt_id, question_id) DO UPDATE SET answer = excluded.answer, status = 'pending', score = NULL, feedback = NULL`,
    )
    .run(newId(), attemptId, questionId, JSON.stringify(answer ?? null));
}

const gradeSchema = z.object({
  points: z.array(z.object({ met: z.enum(["yes", "partial", "no"]), comment: z.string().default("") })),
  missing: z.array(z.string()).default([]),
  feedback: z.string().default(""),
});

/** Grade one response. Objective → instant. Written → local AI with a rubric, or self-marking if AI is off. */
export async function gradeResponse(attemptId: string, questionId: string) {
  const q = db().prepare("SELECT * FROM questions WHERE id = ?").get(questionId) as QuestionRow;
  const r = db().prepare("SELECT * FROM responses WHERE attempt_id = ? AND question_id = ?").get(attemptId, questionId) as { answer: string | null } | undefined;
  const answer = parseJson<unknown>(r?.answer ?? null, null);
  const data = parseJson<QuestionData>(q.data, {});
  const upd = db().prepare("UPDATE responses SET score = ?, status = ?, feedback = ?, graded_by = ? WHERE attempt_id = ? AND question_id = ?");
  const ensure = () => {
    if (!r) saveAnswer(attemptId, questionId, null);
  };
  ensure();

  if (!isWritten(q.type)) {
    const res = gradeObjective(q.type, data, answer, q.max_score);
    upd.run(res.score, "graded", JSON.stringify({ correct: res.correct, detail: res.detail ?? null }), "auto", attemptId, questionId);
    return;
  }
  const text = typeof answer === "string" ? answer.trim() : "";
  if (!text) {
    upd.run(0, "graded", JSON.stringify({ points: (data.rubric ?? []).map(() => ({ met: "no", comment: "No answer given." })), missing: data.rubric?.map((p) => p.point) ?? [], feedback: "No answer was given." }), "auto", attemptId, questionId);
    return;
  }
  if (!isPro()) {
    // Free plan: the student marks their own written answers against the rubric.
    upd.run(null, "needs_self_grade", null, null, attemptId, questionId);
    return;
  }
  try {
    await requireChatModel();
    const src = q.chunk_id ? chunksByIds([q.chunk_id]) : [];
    const { block } = formatSources(src);
    const prompt = gradePrompt({ prompt: q.prompt, modelAnswer: data.modelAnswer ?? "", rubric: data.rubric ?? [] }, text.slice(0, 6000), block);
    const started = Date.now();
    const res = await generateJson(gradeSchema, { messages: [{ role: "user", content: prompt }], temperature: 0.1 });
    logGeneration({ task: "grade", model: getLLM().model, prompt, output: JSON.stringify(res), durationMs: Date.now() - started, refId: questionId });
    const rubric = data.rubric ?? [];
    const verdicts = rubric.map((_, i) => (res.points[i]?.met ?? "no") as RubricVerdict);
    const score = scoreRubric(rubric, verdicts, q.max_score);
    upd.run(score, "graded", JSON.stringify({ points: rubric.map((p, i) => ({ point: p.point, met: verdicts[i], comment: res.points[i]?.comment ?? "" })), missing: res.missing, feedback: res.feedback }), "ai", attemptId, questionId);
  } catch {
    // AI unavailable: let the student mark themselves against the rubric (honest fallback).
    upd.run(null, "needs_self_grade", null, null, attemptId, questionId);
  }
}

export function selfGrade(attemptId: string, questionId: string, verdicts: RubricVerdict[]) {
  const q = db().prepare("SELECT * FROM questions WHERE id = ?").get(questionId) as QuestionRow;
  const rubric = parseJson<QuestionData>(q.data, {}).rubric ?? [];
  const score = scoreRubric(rubric, verdicts, q.max_score);
  db()
    .prepare("UPDATE responses SET score = ?, status = 'graded', feedback = ?, graded_by = 'self' WHERE attempt_id = ? AND question_id = ?")
    .run(score, JSON.stringify({ points: rubric.map((p, i) => ({ point: p.point, met: verdicts[i] ?? "no", comment: "" })), missing: [], feedback: "Self-marked against the rubric." }), attemptId, questionId);
  finaliseIfComplete(attemptId);
}

export async function checkOne(attemptId: string, questionId: string, answer: unknown) {
  saveAnswer(attemptId, questionId, answer);
  await gradeResponse(attemptId, questionId);
}

export function submitAttempt(attemptId: string) {
  const a = db().prepare("SELECT * FROM attempts WHERE id = ?").get(attemptId) as { quiz_id: string; status: string } | undefined;
  if (!a || a.status !== "in_progress") return;
  db().prepare("UPDATE attempts SET status = 'grading', submitted_at = ? WHERE id = ?").run(nowIso(), attemptId);
  runInBackground("grade", async () => {
    const qs = db().prepare("SELECT id FROM questions WHERE quiz_id = ? ORDER BY ord").all(a.quiz_id) as { id: string }[];
    const done = new Set(
      (db().prepare("SELECT question_id FROM responses WHERE attempt_id = ? AND status = 'graded'").all(attemptId) as { question_id: string }[]).map((r) => r.question_id),
    );
    for (const q of qs) if (!done.has(q.id)) await gradeResponse(attemptId, q.id);
    finaliseIfComplete(attemptId, true);
  });
}

function finaliseIfComplete(attemptId: string, fromSubmit = false) {
  const a = db().prepare("SELECT * FROM attempts WHERE id = ?").get(attemptId) as { quiz_id: string; status: string };
  if (a.status === "in_progress" && !fromSubmit) return;
  const pending = (db().prepare("SELECT COUNT(*) n FROM responses WHERE attempt_id = ? AND status != 'graded'").get(attemptId) as { n: number }).n;
  const totals = db()
    .prepare("SELECT SUM(q.max_score) max, SUM(COALESCE(r.score, 0)) score FROM questions q LEFT JOIN responses r ON r.question_id = q.id AND r.attempt_id = ? WHERE q.quiz_id = ?")
    .get(attemptId, a.quiz_id) as { max: number; score: number };
  if (pending > 0) {
    db().prepare("UPDATE attempts SET status = 'grading', score = ?, max_score = ? WHERE id = ?").run(totals.score, totals.max, attemptId);
    return;
  }
  db().prepare("UPDATE attempts SET status = 'graded', score = ?, max_score = ? WHERE id = ?").run(totals.score, totals.max, attemptId);
  // Record evidence for mastery (once).
  const already = db().prepare("SELECT 1 FROM learning_events WHERE ref_id LIKE ? LIMIT 1").get(`${attemptId}:%`);
  if (already) return;
  const quiz = getQuiz(a.quiz_id)!;
  const rows = db()
    .prepare("SELECT q.id, q.topic_id, q.max_score, r.score FROM questions q JOIN responses r ON r.question_id = q.id AND r.attempt_id = ? WHERE q.quiz_id = ?")
    .all(attemptId, a.quiz_id) as { id: string; topic_id: string | null; max_score: number; score: number | null }[];
  for (const r of rows) recordEvent({ courseId: quiz.course_id, topicId: r.topic_id, kind: "quiz", score: (r.score ?? 0) / (r.max_score || 1), refId: `${attemptId}:${r.id}` });
}

/** "Retake my mistakes": fresh questions targeting what the student got wrong. */
export function retakeMistakes(attemptId: string) {
  const a = db().prepare("SELECT quiz_id FROM attempts WHERE id = ?").get(attemptId) as { quiz_id: string } | undefined;
  if (!a) return null;
  const quiz = getQuiz(a.quiz_id)!;
  const wrong = db()
    .prepare("SELECT q.topic_id, q.prompt, q.chunk_id, q.type FROM questions q JOIN responses r ON r.question_id = q.id AND r.attempt_id = ? WHERE COALESCE(r.score,0) < q.max_score * 0.6")
    .all(attemptId) as { topic_id: string | null; prompt: string; chunk_id: string | null; type: QuestionType }[];
  const missed = db()
    .prepare("SELECT q.topic_id, q.prompt, q.chunk_id, q.type FROM questions q WHERE q.quiz_id = ? AND q.id NOT IN (SELECT question_id FROM responses WHERE attempt_id = ?)")
    .all(a.quiz_id, attemptId) as typeof wrong;
  const all = [...wrong, ...missed];
  if (!all.length) return null;
  const types = [...new Set(all.map((w) => w.type))];
  const config: QuizConfig = { ...quiz.config, count: Math.min(20, Math.max(3, all.length)), types, mode: "practice", immediateFeedback: true, timeLimitMinutes: null, title: undefined };
  return createQuiz(config, attemptId, all.map((w) => ({ topicId: w.topic_id, prompt: w.prompt.slice(0, 200), chunkId: w.chunk_id })));
}

export function deleteQuiz(id: string) {
  db().prepare("DELETE FROM quizzes WHERE id = ?").run(id);
}
