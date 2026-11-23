"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AlertTriangle, CalendarDays, CheckCircle2, Circle, Flame, Plus, Trash2, Zap } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorNote, Field, InfoNote, Input, PageHeader, ProgressBar, Select, Skeleton, cn } from "@/components/ui";
import { CourseDot } from "@/components/learning";
import { ProBadge, useLicense } from "@/components/pro";
import { Modal, useToast } from "@/components/overlay";
import { EventEditor } from "@/components/event-editor";
import { api, formatDate, localToday, relativeDays, useApi } from "@/lib/client";

interface CalEvent {
  id: string;
  course_id: string;
  title: string;
  kind: string;
  date: string;
  weight: number | null;
  confirmed: number;
  source_text: string | null;
  source_document: string | null;
  course_title: string;
  course_color: string;
}
interface Plan {
  id: string;
  course_id: string;
  exam_date: string;
  daily_minutes: number;
  cram: number;
  course_title: string;
  course_color: string;
  exam_title: string | null;
  notes: { notes: string[]; skipped: string[] };
  items: { id: string; date: string; kind: string; topic_id: string | null; title: string; minutes: number; done: number }[];
}

const KIND_STYLE: Record<string, string> = { learn: "bg-primary", review: "bg-warning", flashcards: "bg-teal-500", quiz: "bg-violet-500", mock_exam: "bg-danger" };

function itemHref(p: Plan, i: Plan["items"][number]) {
  if (i.kind === "flashcards") return `/flashcards/review?course=${p.course_id}`;
  if (i.kind === "mock_exam") return `/exams/new?course=${p.course_id}&mode=exam`;
  if (i.kind === "review" && i.topic_id) return `/exams/new?course=${p.course_id}&topic=${i.topic_id}`;
  return i.topic_id ? `/tutor/${i.topic_id}` : `/courses/${p.course_id}`;
}

function PlanForm({ events, initialExam, onDone }: { events: CalEvent[]; initialExam?: string | null; onDone: () => void }) {
  const { data: courses } = useApi<{ id: string; title: string }[]>("/api/courses");
  const exams = events.filter((e) => e.kind === "exam" && e.confirmed && e.date > localToday());
  const pre = exams.find((e) => e.id === initialExam);
  const [examId, setExamId] = useState(pre?.id ?? exams[0]?.id ?? "");
  const [courseId, setCourseId] = useState(pre?.course_id ?? exams[0]?.course_id ?? "");
  const [date, setDate] = useState(pre?.date ?? exams[0]?.date ?? "");
  const [minutes, setMinutes] = useState(60);
  const [cram, setCram] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!courseId && courses?.length) setCourseId(courses[0].id);
  }, [courses, courseId]);
  const days = date ? Math.round((new Date(date + "T00:00:00").getTime() - new Date(localToday() + "T00:00:00").getTime()) / 86_400_000) : 0;

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        try {
          await api("/api/plans", { method: "POST", json: { courseId, examDate: date, dailyMinutes: minutes, examEventId: examId || null, cram } });
          onDone();
        } catch (e) {
          setErr((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {exams.length > 0 && (
        <Field label="Exam" htmlFor="p-exam">
          <Select
            id="p-exam"
            value={examId}
            onChange={(e) => {
              const ex = exams.find((x) => x.id === e.target.value);
              setExamId(e.target.value);
              if (ex) {
                setCourseId(ex.course_id);
                setDate(ex.date);
              }
            }}
          >
            {exams.map((e) => (
              <option key={e.id} value={e.id}>
                {e.course_title} — {e.title} ({formatDate(e.date)})
              </option>
            ))}
            <option value="">Another date…</option>
          </Select>
        </Field>
      )}
      {!examId && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Course" htmlFor="p-course">
            <Select id="p-course" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
              {courses?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Exam date" htmlFor="p-date">
            <Input id="p-date" type="date" required min={localToday()} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
      )}
      <Field label={`Time available per day: ${minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60 ? `${minutes % 60} min` : ""}` : `${minutes} min`}`} htmlFor="p-min">
        <input id="p-min" type="range" min={15} max={300} step={15} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="w-full accent-[var(--primary)]" />
      </Field>
      <label className="flex items-start gap-2.5 rounded-xl border border-border p-3 text-sm">
        <input type="checkbox" checked={cram} onChange={(e) => setCram(e.target.checked)} className="mt-0.5 size-4 accent-[var(--primary)]" />
        <span>
          <b className="flex items-center gap-1">
            <Zap className="size-3.5 text-warning" /> Exam Cram mode
          </b>
          <span className="text-muted">Short on time? Focus only on the most important and weakest topics. (Turned on automatically if time is too short.)</span>
        </span>
      </label>
      {date && days > 0 && <p className="text-xs text-muted">{days} day{days > 1 ? "s" : ""} until the exam · about {Math.round((days * minutes) / 60)} hours of study available.</p>}
      {err && <ErrorNote>{err}</ErrorNote>}
      <div className="flex justify-end">
        <Button type="submit" loading={busy} disabled={!courseId || !date}>
          Build my plan
        </Button>
      </div>
    </form>
  );
}

function PlannerInner() {
  const params = useSearchParams();
  const toast = useToast();
  const { data: events, reload: reloadEvents } = useApi<CalEvent[]>("/api/calendar?all=1");
  const { data: plans, reload } = useApi<Plan[]>("/api/plans");
  const [planOpen, setPlanOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const { data: courses } = useApi<{ id: string; title: string }[]>("/api/courses");
  const { data: lic } = useLicense();
  const [addCourse, setAddCourse] = useState("");

  useEffect(() => {
    if (params.get("exam") && events) setPlanOpen(true);
  }, [params, events]);
  useEffect(() => {
    if (!addCourse && courses?.length) setAddCourse(courses[0].id);
  }, [courses, addCourse]);

  const pending = events?.filter((e) => !e.confirmed) ?? [];
  const upcoming = events?.filter((e) => e.confirmed && e.date >= localToday()) ?? [];
  const today = localToday();

  const toggle = async (id: string, done: boolean) => {
    await api(`/api/plan-items/${id}`, { method: "PATCH", json: { done } });
    reload();
  };

  return (
    <div className="animate-rise">
      <PageHeader
        title="Study Planner"
        subtitle="Your exams and deadlines, and a realistic day-by-day plan that focuses on your weakest topics."
        actions={
          <>
            <Button variant="secondary" onClick={() => setAddOpen(true)} icon={<Plus className="size-4" />} disabled={!courses?.length}>
              Add date
            </Button>
            <Button onClick={() => setPlanOpen(true)} icon={<CalendarDays className="size-4" />} disabled={!courses?.length}>
              New study plan <ProBadge show={Boolean(lic?.enabled && !lic.pro)} />
            </Button>
          </>
        }
      />

      {pending.length > 0 && (
        <InfoNote tone="warning" icon={<AlertTriangle className="size-4" />} className="mb-5">
          <b>{pending.length} date{pending.length > 1 ? "s" : ""} found in your syllabi need checking.</b>{" "}
          {[...new Set(pending.map((p) => p.course_id))].map((cid) => (
            <Link key={cid} href={`/courses/${cid}`} className="mr-2 underline">
              Review in {pending.find((p) => p.course_id === cid)!.course_title}
            </Link>
          ))}
        </InfoNote>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
        <div className="space-y-5">
          {!plans ? (
            <Skeleton className="h-72" />
          ) : !plans.length ? (
            <Card>
              <EmptyState icon={<CalendarDays className="size-5" />} title="No study plan yet" body="Pick an exam and how much time you have each day. LectureLab spreads your topics out, schedules reviews, and ends with a mock exam." action={<Button onClick={() => setPlanOpen(true)} disabled={!courses?.length}>Create a study plan</Button>} />
            </Card>
          ) : (
            plans.map((p) => {
              const byDay = new Map<string, Plan["items"]>();
              for (const i of p.items) byDay.set(i.date, [...(byDay.get(i.date) ?? []), i]);
              const done = p.items.filter((i) => i.done).length;
              const days = [...byDay.entries()].filter(([d]) => d >= today);
              return (
                <Card key={p.id}>
                  <CardHeader
                    title={
                      <span className="flex items-center gap-2">
                        <CourseDot color={p.course_color} /> {p.exam_title ?? "Exam"} · {p.course_title}
                        {p.cram ? (
                          <Badge tone="warning">
                            <Flame className="size-3" /> Cram
                          </Badge>
                        ) : null}
                      </span>
                    }
                    subtitle={`${formatDate(p.exam_date, { weekday: "short", month: "long", day: "numeric" })} · ${relativeDays(p.exam_date)} · ${p.daily_minutes} min/day`}
                    action={
                      <button
                        onClick={async () => {
                          if (!confirm("Delete this study plan?")) return;
                          await api(`/api/plans/${p.id}`, { method: "DELETE" });
                          toast("Plan deleted");
                          reload();
                        }}
                        className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-danger"
                        aria-label="Delete plan"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    }
                  />
                  <div className="px-5 pt-3">
                    <ProgressBar value={p.items.length ? done / p.items.length : 0} tone="success" label="Plan progress" />
                    <p className="mt-1 text-xs text-muted">
                      {done} of {p.items.length} sessions done
                    </p>
                    {p.notes.notes.map((n, i) => (
                      <p key={i} className="mt-2 text-xs text-text-2">
                        {n}
                      </p>
                    ))}
                    {p.notes.skipped.length > 0 && <p className="mt-1 text-xs text-warning">Not covered (lower priority): {p.notes.skipped.join(", ")}</p>}
                  </div>
                  <div className="space-y-4 p-5">
                    {days.slice(0, 21).map(([d, items]) => (
                      <div key={d}>
                        <div className={cn("mb-1.5 text-xs font-semibold", d === today ? "text-primary-text" : "text-muted")}>
                          {d === today ? "Today" : formatDate(d, { weekday: "long", month: "short", day: "numeric" })}
                        </div>
                        <ul className="space-y-1">
                          {items.map((i) => (
                            <li key={i.id} className="flex items-center gap-3 rounded-xl border border-border px-3 py-2">
                              <button onClick={() => toggle(i.id, !i.done)} aria-label={i.done ? "Mark not done" : "Mark done"}>
                                {i.done ? <CheckCircle2 className="size-[18px] text-success" /> : <Circle className="size-[18px] text-muted hover:text-primary" />}
                              </button>
                              <span className={cn("size-2 shrink-0 rounded-full", KIND_STYLE[i.kind])} />
                              <Link href={itemHref(p, i)} className={cn("min-w-0 flex-1 truncate text-sm hover:text-primary-text", i.done && "text-muted line-through")}>
                                {i.title}
                              </Link>
                              <span className="text-xs tabular-nums text-muted">{i.minutes} min</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </Card>
              );
            })
          )}
        </div>

        <aside className="space-y-4">
          <Card>
            <CardHeader title="Upcoming" icon={<CalendarDays className="size-4" />} />
            <div className="p-4 pt-3">
              {upcoming.length ? (
                <ul className="space-y-2">
                  {upcoming.map((e) => (
                    <li key={e.id} className="flex gap-3 rounded-xl p-2 hover:bg-surface-2">
                      <div className="w-11 shrink-0 text-center">
                        <div className="text-[10px] uppercase text-muted">{formatDate(e.date, { month: "short" })}</div>
                        <div className="text-base font-semibold leading-tight">{formatDate(e.date, { day: "numeric" })}</div>
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{e.title}</div>
                        <div className="flex items-center gap-1.5 truncate text-xs text-muted">
                          <CourseDot color={e.course_color} className="size-2" /> {e.course_title}
                          {e.weight != null && ` · ${e.weight}%`}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">No upcoming dates. Upload a syllabus or add dates yourself.</p>
              )}
            </div>
          </Card>
          <InfoNote className="text-xs">Plans are a guide built from your quiz and flashcard results so far. They can&apos;t guarantee a grade — rebuild your plan as your results change.</InfoNote>
        </aside>
      </div>

      <Modal open={planOpen} onClose={() => setPlanOpen(false)} title="New study plan">
        {events && (
          <PlanForm
            events={events}
            initialExam={params.get("exam")}
            onDone={() => {
              setPlanOpen(false);
              toast("Study plan created");
              reload();
            }}
          />
        )}
      </Modal>
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add an exam or deadline">
        <div className="mb-4">
          <Field label="Course" htmlFor="a-course">
            <Select id="a-course" value={addCourse} onChange={(e) => setAddCourse(e.target.value)}>
              {courses?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <EventEditor
          key={addCourse}
          courseId={addCourse}
          onDone={() => {
            setAddOpen(false);
            reloadEvents();
          }}
        />
      </Modal>
    </div>
  );
}

export default function PlannerPage() {
  return (
    <Suspense>
      <PlannerInner />
    </Suspense>
  );
}
