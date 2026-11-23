"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, ChevronLeft, CircleDashed, FileText, Loader2, RotateCcw, Send, Timer, XCircle } from "lucide-react";
import { Badge, Button, Card, ErrorNote, InfoNote, ProgressBar, Select, Skeleton, Textarea, cn } from "@/components/ui";
import { Markdown } from "@/components/learning";
import { useToast } from "@/components/overlay";
import { api, useApi } from "@/lib/client";

type Verdict = "yes" | "partial" | "no";
interface Q {
  id: string;
  ord: number;
  type: string;
  difficulty: string;
  prompt: string;
  maxScore: number;
  topicId: string | null;
  topicTitle: string | null;
  options?: string[];
  lefts?: string[];
  rights?: string[];
  rubricCount?: number;
  answer?: { correctIndex?: number; correctBoolean?: boolean; pairs?: { left: string; right: string }[]; modelAnswer?: string; rubric?: { point: string }[] };
  explanation?: string | null;
  source?: { documentId: string; documentName: string; sectionIdx: number; sectionLabel: string; excerpt: string } | null;
  response: {
    answer: unknown;
    score: number | null;
    status: string;
    gradedBy: string | null;
    feedback: { correct?: boolean; detail?: { left: string; chosen: string | null; correct: string; ok: boolean }[]; points?: { point: string; met: Verdict; comment: string }[]; missing?: string[]; feedback?: string } | null;
  } | null;
}
interface AttemptData {
  attempt: { id: string; quiz_id: string; status: string; started_at: string; score: number | null; max_score: number | null };
  quiz: { id: string; title: string; course_id: string; config: { mode: string; timeLimitMinutes: number | null; immediateFeedback: boolean } };
  questions: Q[];
}

const TYPE_LABEL: Record<string, string> = { mcq: "Multiple choice", true_false: "True or false", short_answer: "Short answer", essay: "Essay", definition: "Definition", scenario: "Scenario", matching: "Matching" };

function QuestionInput({ q, value, onChange, locked }: { q: Q; value: unknown; onChange: (v: unknown) => void; locked: boolean }) {
  const revealed = Boolean(q.answer);
  if (q.type === "mcq")
    return (
      <div className="grid gap-2" role="radiogroup">
        {q.options!.map((o, i) => {
          const chosen = value === i;
          const right = revealed && i === q.answer!.correctIndex;
          const wrong = revealed && chosen && !right;
          return (
            <button
              key={i}
              role="radio"
              aria-checked={chosen}
              disabled={locked}
              onClick={() => onChange(i)}
              className={cn(
                "flex items-center gap-3 rounded-xl border px-4 py-3 text-left text-[15px] transition-colors",
                !revealed && chosen && "border-primary bg-primary-soft",
                !revealed && !chosen && "border-border hover:border-primary/40 hover:bg-surface-2",
                right && "border-success/50 bg-success-soft",
                wrong && "border-danger/50 bg-danger-soft",
                revealed && !right && !wrong && "border-border opacity-70",
              )}
            >
              <span className={cn("grid size-7 shrink-0 place-items-center rounded-lg text-xs font-semibold", chosen ? "bg-primary text-white" : "bg-surface-2")}>{String.fromCharCode(65 + i)}</span>
              <span className="flex-1">{o}</span>
              {right && <CheckCircle2 className="size-5 text-success" />}
              {wrong && <XCircle className="size-5 text-danger" />}
            </button>
          );
        })}
      </div>
    );
  if (q.type === "true_false")
    return (
      <div className="grid grid-cols-2 gap-3">
        {[true, false].map((b) => {
          const chosen = value === b;
          const right = revealed && b === q.answer!.correctBoolean;
          return (
            <button
              key={String(b)}
              disabled={locked}
              onClick={() => onChange(b)}
              aria-pressed={chosen}
              className={cn(
                "rounded-xl border py-4 text-[15px] font-medium transition-colors",
                !revealed && chosen && "border-primary bg-primary-soft text-primary-text",
                !revealed && !chosen && "border-border hover:bg-surface-2",
                right && "border-success/50 bg-success-soft",
                revealed && chosen && !right && "border-danger/50 bg-danger-soft",
              )}
            >
              {b ? "True" : "False"}
            </button>
          );
        })}
      </div>
    );
  if (q.type === "matching") {
    const v = (value as Record<string, string>) ?? {};
    const detail = q.response?.feedback?.detail;
    return (
      <div className="space-y-2.5">
        {q.lefts!.map((l) => {
          const d = detail?.find((x) => x.left === l);
          return (
            <div key={l} className={cn("grid items-center gap-2 rounded-xl border p-3 sm:grid-cols-2", d ? (d.ok ? "border-success/40 bg-success-soft" : "border-danger/40 bg-danger-soft") : "border-border")}>
              <div className="text-sm font-medium">{l}</div>
              <div>
                <Select disabled={locked} value={v[l] ?? ""} onChange={(e) => onChange({ ...v, [l]: e.target.value })} aria-label={`Match for ${l}`}>
                  <option value="">Choose…</option>
                  {q.rights!.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </Select>
                {d && !d.ok && <p className="mt-1 text-xs text-success">Correct: {d.correct}</p>}
              </div>
            </div>
          );
        })}
      </div>
    );
  }
  return (
    <div>
      <Textarea
        rows={q.type === "essay" ? 12 : 5}
        disabled={locked}
        value={(value as string) ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={q.type === "essay" ? "Plan your argument, then write your answer…" : "Write your answer…"}
        aria-label="Your answer"
      />
      <p className="mt-1.5 text-xs text-muted">
        Marked against {q.rubricCount} rubric point{q.rubricCount === 1 ? "" : "s"} · {q.maxScore} marks
      </p>
    </div>
  );
}

function Feedback({ q, attemptId, onGraded }: { q: Q; attemptId: string; onGraded: (d: AttemptData) => void }) {
  const r = q.response;
  const [self, setSelf] = useState<Verdict[]>(() => (q.answer?.rubric ?? []).map(() => "no"));
  if (!q.answer) return null;
  const written = ["short_answer", "essay", "definition", "scenario"].includes(q.type);
  const full = r?.score != null && r.score >= q.maxScore;
  return (
    <div className="mt-5 space-y-3 animate-rise">
      {r?.status === "graded" && (
        <div className={cn("flex items-center gap-2 text-sm font-semibold", full ? "text-success" : (r.score ?? 0) > 0 ? "text-warning" : "text-danger")}>
          {full ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
          {full ? "Correct" : (r.score ?? 0) > 0 ? "Partly correct" : "Not quite"} · {r.score}/{q.maxScore}
          {r.gradedBy === "ai" && <Badge>marked by local AI</Badge>}
          {r.gradedBy === "self" && <Badge>self-marked</Badge>}
        </div>
      )}
      {written && r?.feedback?.points && (
        <div className="rounded-xl border border-border">
          <div className="border-b border-border px-4 py-2 text-xs font-semibold text-muted">Rubric</div>
          <ul className="divide-y divide-border">
            {r.feedback.points.map((p, i) => (
              <li key={i} className="flex gap-3 px-4 py-2.5 text-sm">
                {p.met === "yes" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : p.met === "partial" ? <CircleDashed className="mt-0.5 size-4 shrink-0 text-warning" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-danger" />}
                <div>
                  <div>{p.point}</div>
                  {p.comment && <div className="text-xs text-muted">{p.comment}</div>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {written && r?.feedback?.missing && r.feedback.missing.length > 0 && (
        <div className="rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning">
          <b>What was missing:</b> {r.feedback.missing.join("; ")}
        </div>
      )}
      {r?.feedback?.feedback && <p className="text-sm text-text-2">{r.feedback.feedback}</p>}
      {r?.status === "needs_self_grade" && (
        <div className="rounded-xl border border-warning/30 bg-warning-soft p-4">
          <p className="text-sm font-medium text-warning">The AI marker isn&apos;t available, so mark yourself against the rubric:</p>
          <ul className="mt-3 space-y-2">
            {q.answer.rubric?.map((p, i) => (
              <li key={i} className="flex flex-col gap-1.5 text-sm sm:flex-row sm:items-center sm:justify-between">
                <span>{p.point}</span>
                <div className="flex gap-1">
                  {(["yes", "partial", "no"] as Verdict[]).map((v) => (
                    <button key={v} onClick={() => setSelf(self.map((x, j) => (j === i ? v : x)))} className={cn("rounded-lg border px-2.5 py-1 text-xs capitalize", self[i] === v ? "border-primary bg-primary-soft text-primary-text" : "border-border bg-surface")}>
                      {v}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          <Button size="sm" className="mt-3" onClick={async () => onGraded(await api<AttemptData>(`/api/attempts/${attemptId}/self-grade`, { method: "POST", json: { questionId: q.id, verdicts: self } }))}>
            Save my marks
          </Button>
        </div>
      )}
      {written && q.answer.modelAnswer && (
        <details className="rounded-xl bg-surface-2 px-4 py-3 text-sm" open={!full}>
          <summary className="cursor-pointer font-medium">Model answer</summary>
          <div className="mt-2 text-text-2">
            <Markdown text={q.answer.modelAnswer} />
          </div>
        </details>
      )}
      {q.explanation && (
        <div className="rounded-xl bg-surface-2 px-4 py-3 text-sm text-text-2">
          <div className="mb-1 text-xs font-semibold text-muted">Why</div>
          <Markdown text={q.explanation.replace(/\s*\[S\d+\]/g, "")} />
        </div>
      )}
      {q.source && (
        <Link href={`/documents/${q.source.documentId}?s=${q.source.sectionIdx}`} className="flex items-center gap-2 text-xs text-primary-text hover:underline">
          <FileText className="size-3.5" /> Source: {q.source.documentName} · {q.source.sectionLabel}
        </Link>
      )}
    </div>
  );
}

function Timer_({ startedAt, minutes, onExpire }: { startedAt: string; minutes: number; onExpire: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const fired = useRef(false);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, new Date(startedAt).getTime() + minutes * 60_000 - now);
  useEffect(() => {
    if (left === 0 && !fired.current) {
      fired.current = true;
      onExpire();
    }
  }, [left, onExpire]);
  const m = Math.floor(left / 60000);
  const s = Math.floor((left % 60000) / 1000);
  return (
    <div className={cn("flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-mono text-sm tabular-nums", left < 60_000 ? "bg-danger-soft text-danger" : left < 5 * 60_000 ? "bg-warning-soft text-warning" : "bg-surface-2")}>
      <Timer className="size-3.5" /> {m}:{String(s).padStart(2, "0")}
    </div>
  );
}

function Results({ data, onRetake, retaking }: { data: AttemptData; onRetake: () => void; retaking: boolean }) {
  const { attempt, questions } = data;
  const pct = attempt.max_score ? Math.round(((attempt.score ?? 0) / attempt.max_score) * 100) : 0;
  const byTopic = useMemo(() => {
    const m = new Map<string, { title: string; score: number; max: number; id: string | null }>();
    for (const q of questions) {
      const k = q.topicId ?? "other";
      const e = m.get(k) ?? { title: q.topicTitle ?? "Other", score: 0, max: 0, id: q.topicId };
      e.score += q.response?.score ?? 0;
      e.max += q.maxScore;
      m.set(k, e);
    }
    return [...m.values()].sort((a, b) => a.score / a.max - b.score / b.max);
  }, [questions]);
  const wrong = questions.filter((q) => (q.response?.score ?? 0) < q.maxScore * 0.6).length;
  const circumference = 2 * Math.PI * 52;

  return (
    <div className="space-y-5">
      <Card className="grid gap-6 p-6 sm:grid-cols-[auto_1fr] sm:items-center">
        <div className="relative mx-auto size-36">
          <svg viewBox="0 0 120 120" className="size-full -rotate-90">
            <circle cx="60" cy="60" r="52" fill="none" stroke="var(--surface-3)" strokeWidth="10" />
            <circle cx="60" cy="60" r="52" fill="none" stroke={pct >= 70 ? "var(--success)" : pct >= 50 ? "var(--warning)" : "var(--danger)"} strokeWidth="10" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - pct / 100)} className="transition-[stroke-dashoffset] duration-1000" />
          </svg>
          <div className="absolute inset-0 grid place-items-center text-center">
            <div>
              <div className="text-3xl font-semibold tabular-nums">{pct}%</div>
              <div className="text-xs text-muted">
                {attempt.score}/{attempt.max_score} marks
              </div>
            </div>
          </div>
        </div>
        <div>
          <h2 className="text-lg font-semibold">{pct >= 85 ? "Excellent work!" : pct >= 70 ? "Good result" : pct >= 50 ? "Getting there" : "Let's work on this"}</h2>
          <p className="mt-1 text-sm text-muted">
            {wrong ? `${wrong} question${wrong > 1 ? "s" : ""} to review. Retake them with fresh questions on the same ideas.` : "You got everything right — try a harder exam next."}
          </p>
          <div className="mt-4 space-y-2.5">
            {byTopic.map((t) => (
              <div key={t.title}>
                <div className="flex justify-between text-[13px]">
                  {t.id ? (
                    <Link href={`/tutor/${t.id}${t.score / t.max < 0.6 ? "?adaptive=1" : ""}`} className="truncate hover:text-primary-text">
                      {t.title}
                    </Link>
                  ) : (
                    <span>{t.title}</span>
                  )}
                  <span className="tabular-nums text-muted">{Math.round((t.score / t.max) * 100)}%</span>
                </div>
                <ProgressBar value={t.score / t.max} tone={t.score / t.max >= 0.7 ? "success" : t.score / t.max >= 0.5 ? "warning" : "danger"} className="mt-1" />
              </div>
            ))}
          </div>
          {wrong > 0 && (
            <Button className="mt-5" onClick={onRetake} loading={retaking} icon={<RotateCcw className="size-4" />}>
              Retake my mistakes
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}

export default function AttemptPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { data, error, setData, reload } = useApi<AttemptData>(`/api/attempts/${id}`, { poll: (d) => (d?.attempt.status === "grading" ? 1500 : false) });
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [idx, setIdx] = useState(0);
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [retaking, setRetaking] = useState(false);
  const saveTimer = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const initialised = useRef(false);

  useEffect(() => {
    if (!data || initialised.current) return;
    initialised.current = true;
    const a: Record<string, unknown> = {};
    for (const q of data.questions) if (q.response?.answer != null) a[q.id] = q.response.answer;
    setAnswers(a);
    const firstOpen = data.questions.findIndex((q) => !q.response || q.response.status === "pending");
    setIdx(Math.max(0, firstOpen));
  }, [data]);

  const finished = data ? data.attempt.status !== "in_progress" : false;
  const q = data?.questions[idx];

  const setAnswer = (qid: string, v: unknown) => {
    setAnswers((a) => ({ ...a, [qid]: v }));
    clearTimeout(saveTimer.current[qid]);
    saveTimer.current[qid] = setTimeout(() => api(`/api/attempts/${id}`, { method: "PATCH", json: { questionId: qid, answer: v } }).catch(() => {}), 400);
  };

  const submit = async () => {
    if (!data) return;
    setSubmitting(true);
    // Flush pending saves first.
    await Promise.all(Object.entries(answers).map(([questionId, answer]) => api(`/api/attempts/${id}`, { method: "PATCH", json: { questionId, answer } }).catch(() => {})));
    await api(`/api/attempts/${id}/submit`, { method: "POST" });
    await reload(); // re-arms polling while written answers are being marked
    setIdx(0);
    setSubmitting(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Keyboard: ←/→ to move, 1-5 to pick an option.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!data || (e.target as HTMLElement).closest("textarea, input, select")) return;
      if (e.key === "ArrowRight") setIdx((i) => Math.min(data.questions.length - 1, i + 1));
      if (e.key === "ArrowLeft") setIdx((i) => Math.max(0, i - 1));
      const cur = data.questions[idx];
      if (!finished && cur?.type === "mcq" && !cur.answer && /^[1-5]$/.test(e.key) && Number(e.key) <= (cur.options?.length ?? 0)) setAnswer(cur.id, Number(e.key) - 1);
      if (!finished && cur?.type === "true_false" && !cur.answer && (e.key === "t" || e.key === "f")) setAnswer(cur.id, e.key === "t");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data || !q) return <Skeleton className="h-96" />;
  const cfg = data.quiz.config;
  const answeredCount = data.questions.filter((x) => answers[x.id] !== undefined && answers[x.id] !== "").length;
  const canCheck = !finished && cfg.mode === "practice" && cfg.immediateFeedback && !q.answer;

  return (
    <div className="mx-auto max-w-3xl animate-rise">
      <div className="mb-5 flex items-center justify-between gap-3">
        <Link href="/exams" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-text">
          <ArrowLeft className="size-3.5" /> {data.quiz.title}
        </Link>
        {!finished && cfg.timeLimitMinutes && <Timer_ startedAt={data.attempt.started_at} minutes={cfg.timeLimitMinutes} onExpire={() => { toast("Time's up — submitting your exam", "error"); submit(); }} />}
      </div>

      {data.attempt.status === "grading" && (
        <InfoNote tone="primary" icon={<Loader2 className="size-4 animate-spin" />} className="mb-5">
          Marking your written answers with the local AI… this page updates automatically.
        </InfoNote>
      )}
      {data.attempt.status === "graded" && (
        <div className="mb-5">
          <Results
            data={data}
            retaking={retaking}
            onRetake={async () => {
              setRetaking(true);
              try {
                const r = await api<{ id: string }>(`/api/attempts/${id}/retake`, { method: "POST" });
                router.push(`/exams/${r.id}`);
              } catch (e) {
                toast((e as Error).message, "error");
                setRetaking(false);
              }
            }}
          />
        </div>
      )}

      {/* Question navigator */}
      <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Questions">
        {data.questions.map((x, i) => {
          const r = x.response;
          const graded = r?.status === "graded" && x.answer;
          const ok = graded && (r!.score ?? 0) >= x.maxScore * 0.99;
          const partial = graded && !ok && (r!.score ?? 0) > 0;
          return (
            <button
              key={x.id}
              role="tab"
              aria-selected={i === idx}
              aria-label={`Question ${i + 1}`}
              onClick={() => setIdx(i)}
              className={cn(
                "grid size-9 place-items-center rounded-lg border text-[13px] font-medium tabular-nums transition-colors",
                i === idx && "ring-2 ring-primary ring-offset-1 ring-offset-bg",
                graded ? (ok ? "border-success/40 bg-success-soft text-success" : partial ? "border-warning/40 bg-warning-soft text-warning" : "border-danger/40 bg-danger-soft text-danger") : answers[x.id] !== undefined && answers[x.id] !== "" ? "border-primary/40 bg-primary-soft text-primary-text" : "border-border bg-surface",
              )}
            >
              {i + 1}
            </button>
          );
        })}
      </div>

      <Card className="p-6 sm:p-7">
        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
          <span className="font-medium text-muted">
            Question {idx + 1} of {data.questions.length}
          </span>
          <Badge>{TYPE_LABEL[q.type] ?? q.type}</Badge>
          <Badge>{q.difficulty}</Badge>
          {q.topicTitle && <Badge tone="primary">{q.topicTitle}</Badge>}
          <span className="ml-auto text-muted">
            {q.maxScore} mark{q.maxScore > 1 ? "s" : ""}
          </span>
        </div>
        <div className="mb-5 text-[17px] font-medium leading-relaxed">
          <Markdown text={q.prompt} />
        </div>
        <QuestionInput q={q} value={answers[q.id]} onChange={(v) => setAnswer(q.id, v)} locked={finished || Boolean(q.answer)} />
        <Feedback q={q} attemptId={id} onGraded={setData} />

        <div className="mt-6 flex items-center justify-between gap-2 border-t border-border pt-5">
          <Button variant="ghost" onClick={() => setIdx(idx - 1)} disabled={idx === 0} icon={<ChevronLeft className="size-4" />}>
            Back
          </Button>
          <div className="flex gap-2">
            {canCheck && (
              <Button
                variant="soft"
                loading={checking}
                disabled={answers[q.id] === undefined || answers[q.id] === ""}
                onClick={async () => {
                  setChecking(true);
                  try {
                    setData(await api<AttemptData>(`/api/attempts/${id}/check`, { method: "POST", json: { questionId: q.id, answer: answers[q.id] } }));
                  } catch (e) {
                    toast((e as Error).message, "error");
                  } finally {
                    setChecking(false);
                  }
                }}
              >
                Check answer
              </Button>
            )}
            {idx < data.questions.length - 1 ? (
              <Button variant={canCheck ? "secondary" : "primary"} onClick={() => setIdx(idx + 1)}>
                Next <ArrowRight className="size-4" />
              </Button>
            ) : (
              !finished && (
                <Button
                  onClick={() => {
                    const unanswered = data.questions.length - answeredCount;
                    if (unanswered && !confirm(`${unanswered} question${unanswered > 1 ? "s are" : " is"} unanswered. Submit anyway?`)) return;
                    submit();
                  }}
                  loading={submitting}
                  icon={<Send className="size-4" />}
                >
                  Submit
                </Button>
              )
            )}
          </div>
        </div>
      </Card>
      {!finished && (
        <p className="mt-3 text-center text-xs text-muted">
          {answeredCount}/{data.questions.length} answered · answers save automatically · use ← → to move{q.type === "mcq" ? ", 1–4 to choose" : ""}
        </p>
      )}
    </div>
  );
}
