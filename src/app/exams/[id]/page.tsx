"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, ClipboardCheck, Loader2, Play, Timer } from "lucide-react";
import { Badge, Button, ButtonLink, Card, ErrorNote, InfoNote, ProgressBar, Skeleton } from "@/components/ui";
import { api, formatDate, useApi } from "@/lib/client";

interface QuizData {
  quiz: { id: string; title: string; status: string; status_detail: string | null; progress: number; course_title: string; course_id: string; config: { mode: string; difficulty: string; timeLimitMinutes: number | null; immediateFeedback: boolean; types: string[] } };
  questionCount: number;
  attempts: { id: string; status: string; score: number | null; max_score: number | null; started_at: string }[];
}

export default function QuizPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { data, error } = useApi<QuizData>(`/api/quizzes/${id}`, { poll: (d) => (d?.quiz.status === "generating" ? 1500 : false) });

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Skeleton className="h-72" />;
  const { quiz } = data;

  const start = async () => {
    setBusy(true);
    try {
      const { attemptId } = await api<{ attemptId: string }>(`/api/quizzes/${id}/attempts`, { method: "POST" });
      router.push(`/exams/attempts/${attemptId}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl animate-rise">
      <Link href="/exams" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-text">
        <ArrowLeft className="size-3.5" /> Practice exams
      </Link>
      <Card className="mt-3 overflow-hidden">
        <div className="bg-gradient-to-br from-primary-soft to-surface p-7 text-center">
          <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary text-white shadow-card">
            {quiz.status === "generating" ? <Loader2 className="size-6 animate-spin" /> : <ClipboardCheck className="size-6" />}
          </div>
          <h1 className="mt-4 text-xl font-semibold tracking-tight">{quiz.title}</h1>
          <p className="text-sm text-muted">{quiz.course_title}</p>
          <div className="mt-3 flex flex-wrap justify-center gap-1.5">
            <Badge tone="primary">{quiz.config.mode === "exam" ? "Exam simulation" : "Practice"}</Badge>
            <Badge>{quiz.config.difficulty}</Badge>
            {quiz.config.timeLimitMinutes && (
              <Badge>
                <Timer className="size-3" /> {quiz.config.timeLimitMinutes} min
              </Badge>
            )}
            {quiz.status === "ready" && <Badge>{data.questionCount} questions</Badge>}
          </div>
        </div>
        <div className="p-6">
          {quiz.status === "generating" ? (
            <div className="space-y-3 text-center">
              <ProgressBar value={Math.max(0.04, quiz.progress)} label="Generation progress" />
              <p className="text-sm text-text-2">{quiz.status_detail ?? "Preparing…"}</p>
              <p className="text-xs text-muted">Your local AI is writing and checking each question against your slides. You can leave this page — it keeps going.</p>
            </div>
          ) : quiz.status === "failed" ? (
            <div className="space-y-4">
              <ErrorNote>{quiz.status_detail ?? "Generation failed."}</ErrorNote>
              <ButtonLink href={`/exams/new?course=${quiz.course_id}`} variant="secondary">
                Try again
              </ButtonLink>
            </div>
          ) : (
            <div className="space-y-4">
              {quiz.status_detail && <InfoNote>{quiz.status_detail}</InfoNote>}
              <ul className="space-y-1.5 text-sm text-text-2">
                <li>• {quiz.config.mode === "exam" ? "Answers and marks are revealed after you submit." : quiz.config.immediateFeedback ? "Check each answer as you go." : "Results are shown when you submit."}</li>
                <li>• Written answers are marked against a transparent rubric.</li>
                <li>• Every question links back to the slide or page it came from.</li>
              </ul>
              {err && <ErrorNote>{err}</ErrorNote>}
              <Button size="lg" className="w-full" onClick={start} loading={busy} icon={<Play className="size-4" />}>
                {data.attempts.some((a) => a.status === "in_progress") ? "Continue" : data.attempts.length ? "Retake" : "Start"}
              </Button>
              {data.attempts.filter((a) => a.status === "graded").length > 0 && (
                <div className="border-t border-border pt-4">
                  <div className="mb-2 text-xs font-medium text-muted">Previous attempts</div>
                  {data.attempts
                    .filter((a) => a.status === "graded")
                    .map((a) => (
                      <Link key={a.id} href={`/exams/attempts/${a.id}`} className="flex justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2">
                        <span>{formatDate(a.started_at, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                        <span className="font-medium tabular-nums">{a.max_score ? Math.round(((a.score ?? 0) / a.max_score) * 100) : 0}%</span>
                      </Link>
                    ))}
                </div>
              )}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
