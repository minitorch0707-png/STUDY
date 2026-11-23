"use client";

import Link from "next/link";
import { ArrowRight, BookOpen, CalendarClock, CheckCircle2, Circle, Flame, Layers, Lightbulb, Sparkles, Target, TrendingDown, Upload } from "lucide-react";
import { Badge, ButtonLink, Card, CardHeader, EmptyState, Skeleton, cn } from "@/components/ui";
import { CourseDot, MasteryBar, type Mastery } from "@/components/learning";
import { api, daysUntil, formatDate, useApi } from "@/lib/client";

interface Dashboard {
  recommendations: { id: string; kind: string; title: string; reason: string; href: string }[];
  plan: { id: string; kind: string; title: string; minutes: number; done: number; topic_id: string | null; course_id: string; course_title: string; course_color: string }[];
  struggling: { id: string; title: string; course_title: string; course_color: string; mastery: Mastery }[];
  upcoming: { id: string; title: string; kind: string; date: string; course_title: string; course_color: string; weight: number | null }[];
  flashcards: { due: number; fresh: number };
  streak: number;
}

const REC_ICON: Record<string, typeof Sparkles> = { relearn: TrendingDown, flashcards: Layers, quiz: Target, start: Sparkles, plan: CalendarClock, upload: Upload, exam: CalendarClock };

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function planHref(i: Dashboard["plan"][number]) {
  if (i.kind === "flashcards") return `/flashcards/review?course=${i.course_id}`;
  if (i.kind === "mock_exam") return `/exams/new?course=${i.course_id}&mode=exam`;
  if (i.kind === "review" && i.topic_id) return `/exams/new?course=${i.course_id}&topic=${i.topic_id}`;
  return i.topic_id ? `/tutor/${i.topic_id}` : `/courses/${i.course_id}`;
}

export default function DashboardPage() {
  const { data, loading, reload } = useApi<Dashboard>("/api/dashboard");
  const nextExam = data?.upcoming.find((e) => e.kind === "exam");

  const toggle = async (id: string, done: boolean) => {
    await api(`/api/plan-items/${id}`, { method: "PATCH", json: { done } });
    reload();
  };

  return (
    <div className="animate-rise">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-muted">{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-[28px]">{greeting()} 👋</h1>
        </div>
        {data && data.streak > 0 && (
          <div className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3.5 py-2 text-sm shadow-card">
            <Flame className="size-4 text-orange-500" />
            <span className="font-semibold">{data.streak}-day</span>
            <span className="text-muted">study streak</span>
          </div>
        )}
      </div>

      {/* The three questions: what today, what am I struggling with, when is my exam */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-2 overflow-hidden">
          <CardHeader title="What to study today" subtitle={data?.plan.length ? "From your study plan" : "Suggested from your progress"} icon={<Sparkles className="size-4" />} />
          <div className="p-3 pt-3">
            {loading && !data ? (
              <div className="space-y-2 p-2">
                <Skeleton className="h-14" />
                <Skeleton className="h-14" />
                <Skeleton className="h-14" />
              </div>
            ) : data?.plan.length ? (
              <ul className="divide-y divide-border">
                {data.plan.map((i) => (
                  <li key={i.id} className="flex items-center gap-3 px-2 py-2.5">
                    <button onClick={() => toggle(i.id, !i.done)} aria-label={i.done ? "Mark not done" : "Mark done"} className="text-muted hover:text-primary">
                      {i.done ? <CheckCircle2 className="size-5 text-success" /> : <Circle className="size-5" />}
                    </button>
                    <Link href={planHref(i)} className={cn("min-w-0 flex-1 rounded-lg px-1 hover:text-primary-text", i.done && "text-muted line-through")}>
                      <div className="truncate text-sm font-medium">{i.title}</div>
                      <div className="flex items-center gap-1.5 text-xs text-muted">
                        <CourseDot color={i.course_color} className="size-2" /> {i.course_title} · {i.minutes} min
                      </div>
                    </Link>
                    <ArrowRight className="size-4 text-muted" />
                  </li>
                ))}
              </ul>
            ) : (
              <ul className="space-y-1.5">
                {data?.recommendations.map((r) => {
                  const Icon = REC_ICON[r.kind] ?? Lightbulb;
                  return (
                    <li key={r.id}>
                      <Link href={r.href} className="group flex items-start gap-3 rounded-xl px-3 py-3 hover:bg-surface-2 transition-colors">
                        <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary-text">
                          <Icon className="size-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium">{r.title}</div>
                          <div className="text-[13px] text-muted leading-snug">{r.reason}</div>
                        </div>
                        <ArrowRight className="mt-2 size-4 text-muted opacity-0 transition-opacity group-hover:opacity-100" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Card>

        <Card className="flex flex-col">
          <CardHeader title="Next exam" icon={<CalendarClock className="size-4" />} />
          {nextExam ? (
            <div className="flex flex-1 flex-col justify-between p-5 pt-4">
              <div>
                <div className="flex items-center gap-2 text-xs text-muted">
                  <CourseDot color={nextExam.course_color} /> {nextExam.course_title}
                </div>
                <div className="mt-1.5 text-lg font-semibold leading-snug">{nextExam.title}</div>
                <div className="text-sm text-muted">
                  {formatDate(nextExam.date, { weekday: "short", month: "long", day: "numeric" })}
                  {nextExam.weight ? ` · ${nextExam.weight}% of grade` : ""}
                </div>
              </div>
              <div className="mt-5 flex items-end justify-between">
                <div>
                  <div className="text-4xl font-semibold tracking-tight tabular-nums">{Math.max(0, daysUntil(nextExam.date))}</div>
                  <div className="text-xs text-muted">{daysUntil(nextExam.date) === 1 ? "day to go" : "days to go"}</div>
                </div>
                <ButtonLink href={`/planner?exam=${nextExam.id}`} variant="soft" size="sm">
                  Study plan
                </ButtonLink>
              </div>
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-start justify-center gap-3 p-5 text-sm text-muted">
              No upcoming exams yet. Upload a syllabus and LectureLab will find the dates, or add one yourself.
              <ButtonLink href="/planner" variant="secondary" size="sm">
                Add an exam date
              </ButtonLink>
            </div>
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader title="What you're struggling with" subtitle="Based on your actual quiz, check and flashcard answers" icon={<TrendingDown className="size-4" />} />
          <div className="p-5 pt-4">
            {data?.struggling.length ? (
              <ul className="space-y-3.5">
                {data.struggling.map((t) => (
                  <li key={t.id} className="flex items-center gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate text-sm font-medium">{t.title}</span>
                        <span className="text-xs tabular-nums text-muted">{Math.round(t.mastery.mastery * 100)}%</span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <CourseDot color={t.course_color} className="size-2" />
                        <MasteryBar m={t.mastery} />
                      </div>
                    </div>
                    <ButtonLink href={`/tutor/${t.id}?adaptive=1`} variant="secondary" size="sm">
                      Revisit
                    </ButtonLink>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Nothing flagged yet. As you answer quiz questions and flashcards, topics you find hard will show up here — with a plan to fix them.</p>
            )}
          </div>
        </Card>

        <Card className="relative overflow-hidden">
          <div className="absolute -right-8 -top-8 size-32 rounded-full bg-gradient-to-br from-indigo-500/20 to-violet-500/10 blur-2xl" />
          <CardHeader title="Quick review" icon={<Layers className="size-4" />} />
          <div className="relative p-5 pt-4">
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-semibold tabular-nums tracking-tight">{data?.flashcards.due ?? "–"}</span>
              <span className="text-sm text-muted">cards due</span>
            </div>
            {data && data.flashcards.fresh > 0 && <p className="mt-1 text-xs text-muted">+ {data.flashcards.fresh} new cards waiting</p>}
            <ButtonLink href="/flashcards/review" className="mt-5 w-full" icon={<Layers className="size-4" />}>
              {data?.flashcards.due ? "Start review" : "Study flashcards"}
            </ButtonLink>
          </div>
        </Card>
      </div>

      {data && data.upcoming.length > 1 && (
        <Card className="mt-4">
          <CardHeader title="Coming up" icon={<CalendarClock className="size-4" />} action={<Link href="/planner" className="text-[13px] text-primary-text hover:underline">Calendar</Link>} />
          <ul className="grid gap-2 p-5 pt-4 sm:grid-cols-2 lg:grid-cols-4">
            {data.upcoming.map((e) => (
              <li key={e.id} className="rounded-xl border border-border p-3">
                <div className="flex items-center gap-2 text-xs text-muted">
                  <CourseDot color={e.course_color} className="size-2" />
                  <span className="truncate">{e.course_title}</span>
                </div>
                <div className="mt-1 truncate text-sm font-medium">{e.title}</div>
                <div className="mt-1 flex items-center gap-2 text-xs text-muted">
                  {formatDate(e.date)} <Badge tone={e.kind === "exam" ? "danger" : "neutral"}>{e.kind}</Badge>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {data && data.recommendations.length === 1 && data.recommendations[0].kind === "upload" && (
        <Card className="mt-4">
          <EmptyState
            icon={<BookOpen className="size-5" />}
            title="Let's set up your first course"
            body="Create a course, drop in your slides, readings and syllabus, and LectureLab turns them into lessons, practice exams and flashcards."
            action={<ButtonLink href={data.recommendations[0].href}>Get started</ButtonLink>}
          />
        </Card>
      )}
    </div>
  );
}
