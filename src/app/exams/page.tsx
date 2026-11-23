"use client";

import Link from "next/link";
import { ClipboardCheck, Loader2, Plus, Trash2 } from "lucide-react";
import { Badge, ButtonLink, Card, EmptyState, PageHeader, Skeleton } from "@/components/ui";
import { CourseDot } from "@/components/learning";
import { useToast } from "@/components/overlay";
import { api, timeAgo, useApi } from "@/lib/client";

interface QuizRow {
  id: string;
  title: string;
  status: string;
  status_detail: string | null;
  progress: number;
  course_title: string;
  course_color: string;
  question_count: number;
  created_at: string;
  config: { mode: string; difficulty: string; timeLimitMinutes: number | null };
  last_attempt: { id: string; score: number | null; max: number | null; status: string; at: string } | null;
}

export default function ExamsPage() {
  const toast = useToast();
  const { data, loading, reload } = useApi<QuizRow[]>("/api/quizzes", { poll: (d) => (d?.some((q) => q.status === "generating") ? 2000 : false) });
  return (
    <div className="animate-rise">
      <PageHeader
        title="Practice Exams"
        subtitle="Quizzes and mock exams written from your own course material, marked with clear feedback."
        actions={
          <ButtonLink href="/exams/new" icon={<Plus className="size-4" />}>
            New exam
          </ButtonLink>
        }
      />
      {loading && !data ? (
        <Skeleton className="h-60" />
      ) : !data?.length ? (
        <Card>
          <EmptyState icon={<ClipboardCheck className="size-5" />} title="No practice exams yet" body="Choose topics, question types and difficulty — LectureLab writes a fresh exam from your slides and marks it for you." action={<ButtonLink href="/exams/new">Create your first exam</ButtonLink>} />
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {data.map((q) => {
              const pct = q.last_attempt?.status === "graded" && q.last_attempt.max ? Math.round(((q.last_attempt.score ?? 0) / q.last_attempt.max) * 100) : null;
              return (
                <li key={q.id} className="flex items-center gap-4 px-5 py-4">
                  <Link href={q.last_attempt ? `/exams/attempts/${q.last_attempt.id}` : `/exams/${q.id}`} className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold hover:text-primary-text">{q.title}</span>
                      {q.config.mode === "exam" && <Badge tone="primary">Exam simulation</Badge>}
                      {q.status === "generating" && (
                        <Badge tone="warning">
                          <Loader2 className="size-3 animate-spin" /> Writing questions {Math.round(q.progress * 100)}%
                        </Badge>
                      )}
                      {q.status === "failed" && <Badge tone="danger">Failed</Badge>}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                      <CourseDot color={q.course_color} className="size-2" /> {q.course_title} · {q.question_count} questions · {q.config.difficulty} · {timeAgo(q.created_at)}
                    </div>
                  </Link>
                  {pct !== null && (
                    <div className="text-right">
                      <div className={`text-lg font-semibold tabular-nums ${pct >= 70 ? "text-success" : pct >= 50 ? "text-warning" : "text-danger"}`}>{pct}%</div>
                      <div className="text-[11px] text-muted">last score</div>
                    </div>
                  )}
                  {q.last_attempt?.status === "in_progress" && <Badge>In progress</Badge>}
                  <button
                    onClick={async () => {
                      if (!confirm("Delete this exam and its results?")) return;
                      await api(`/api/quizzes/${q.id}`, { method: "DELETE" });
                      toast("Exam deleted");
                      reload();
                    }}
                    className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-danger"
                    aria-label="Delete exam"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
