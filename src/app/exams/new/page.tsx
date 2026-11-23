"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { ClipboardCheck, GraduationCap, PlugZap, Timer } from "lucide-react";
import { Button, Card, ErrorNote, Field, InfoNote, Input, PageHeader, Select, cn } from "@/components/ui";
import { MasteryBadge, type Mastery } from "@/components/learning";
import { api, useApi } from "@/lib/client";

const TYPES = [
  { id: "mcq", label: "Multiple choice" },
  { id: "true_false", label: "True / false" },
  { id: "short_answer", label: "Short answer" },
  { id: "essay", label: "Essay" },
  { id: "definition", label: "Definitions" },
  { id: "scenario", label: "Scenario / application" },
  { id: "matching", label: "Matching" },
];

function NewExamInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { data: courses } = useApi<{ id: string; title: string; topic_count: number }[]>("/api/courses");
  const { data: status } = useApi<{ reachable: boolean; chatModel: { installed: boolean; name: string }; error?: string }>("/api/status");
  const [courseId, setCourseId] = useState(params.get("course") ?? "");
  const { data: course } = useApi<{ topics: { id: string; title: string; importance: number; mastery: Mastery }[]; syllabusFormats: string[] }>(courseId ? `/api/courses/${courseId}` : null);

  const [topicIds, setTopicIds] = useState<string[]>(params.get("topic") ? [params.get("topic")!] : []);
  const [types, setTypes] = useState<string[]>(["mcq", "true_false", "short_answer"]);
  const [count, setCount] = useState(10);
  const [difficulty, setDifficulty] = useState("medium");
  const [mode, setMode] = useState<"practice" | "exam">(params.get("mode") === "exam" ? "exam" : "practice");
  const [timed, setTimed] = useState(params.get("mode") === "exam");
  const [minutes, setMinutes] = useState(30);
  const [feedback, setFeedback] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!courseId && courses?.length) setCourseId(courses.find((c) => c.topic_count > 0)?.id ?? courses[0].id);
  }, [courses, courseId]);
  useEffect(() => {
    if (params.get("syllabus") && course?.syllabusFormats.length) setTypes(course.syllabusFormats);
  }, [course, params]);
  useEffect(() => {
    if (mode === "exam") setFeedback(false);
  }, [mode]);

  const estimate = useMemo(() => Math.ceil(count * 0.35 + types.filter((t) => ["essay", "short_answer", "scenario"].includes(t)).length * 0.5), [count, types]);
  const aiReady = status?.reachable && status.chatModel.installed;
  const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const { id } = await api<{ id: string }>("/api/quizzes", {
        method: "POST",
        json: { courseId, topicIds, types, count, difficulty, mode, timeLimitMinutes: timed ? minutes : null, immediateFeedback: mode === "practice" && feedback },
      });
      router.push(`/exams/${id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="animate-rise">
      <PageHeader title="New practice exam" subtitle="Questions are written fresh from your materials each time, so you won't see the same exam twice." />
      {status && !aiReady && (
        <InfoNote tone="warning" icon={<PlugZap className="size-4" />} className="mb-5">
          Writing questions needs the local AI model. {status.error ?? `Install "${status.chatModel.name}" in Settings → AI Models.`}
        </InfoNote>
      )}
      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          <Card className="space-y-5 p-5">
            <Field label="Course" htmlFor="ex-course">
              <Select id="ex-course" value={courseId} onChange={(e) => { setCourseId(e.target.value); setTopicIds([]); }}>
                {courses?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </Select>
            </Field>
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[13px] font-medium text-text-2">Topics</span>
                <button className="text-xs text-primary-text hover:underline" onClick={() => setTopicIds(topicIds.length ? [] : course?.topics.map((t) => t.id) ?? [])}>
                  {topicIds.length ? "Clear" : "Select all"}
                </button>
              </div>
              <p className="mb-2 text-xs text-muted">{topicIds.length ? `${topicIds.length} selected` : "None selected = whole course (weighted toward your weak topics)"}</p>
              <div className="max-h-72 space-y-1 overflow-y-auto rounded-xl border border-border p-1.5">
                {course?.topics.map((t) => (
                  <label key={t.id} className={cn("flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-sm hover:bg-surface-2", topicIds.includes(t.id) && "bg-primary-soft")}>
                    <input type="checkbox" checked={topicIds.includes(t.id)} onChange={() => toggle(topicIds, setTopicIds, t.id)} className="size-4 accent-[var(--primary)]" />
                    <span className="min-w-0 flex-1 truncate">{t.title}</span>
                    <MasteryBadge m={t.mastery} />
                  </label>
                ))}
                {course && !course.topics.length && <p className="p-3 text-sm text-muted">No topics yet — upload lecture material to this course first.</p>}
              </div>
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[13px] font-medium text-text-2">Question types</span>
                {course?.syllabusFormats.length ? (
                  <button className="text-xs text-primary-text hover:underline" onClick={() => setTypes(course.syllabusFormats)}>
                    Match my syllabus format
                  </button>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                {TYPES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => toggle(types, setTypes, t.id)}
                    aria-pressed={types.includes(t.id)}
                    className={cn("rounded-xl border px-3 py-1.5 text-[13px] font-medium transition-colors", types.includes(t.id) ? "border-primary bg-primary-soft text-primary-text" : "border-border hover:bg-surface-2")}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={`Number of questions: ${count}`} htmlFor="ex-count">
                <input id="ex-count" type="range" min={3} max={30} value={count} onChange={(e) => setCount(Number(e.target.value))} className="w-full accent-[var(--primary)]" />
              </Field>
              <Field label="Difficulty" htmlFor="ex-diff">
                <Select id="ex-diff" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
                  <option value="easy">Easy — recall</option>
                  <option value="medium">Medium — understanding</option>
                  <option value="hard">Hard — application</option>
                  <option value="mixed">Mixed</option>
                </Select>
              </Field>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="space-y-3 p-5">
            <div className="text-[13px] font-medium text-text-2">Mode</div>
            {[
              { id: "practice" as const, icon: ClipboardCheck, title: "Practice", body: "Learn as you go. Check answers one at a time." },
              { id: "exam" as const, icon: GraduationCap, title: "Exam simulation", body: "Real conditions. Results only at the end." },
            ].map((m) => (
              <button key={m.id} onClick={() => setMode(m.id)} className={cn("flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors", mode === m.id ? "border-primary bg-primary-soft" : "border-border hover:bg-surface-2")} aria-pressed={mode === m.id}>
                <m.icon className={cn("mt-0.5 size-4", mode === m.id ? "text-primary-text" : "text-muted")} />
                <div>
                  <div className="text-sm font-medium">{m.title}</div>
                  <div className="text-xs text-muted">{m.body}</div>
                </div>
              </button>
            ))}
            {mode === "practice" && (
              <label className="flex items-center gap-2.5 pt-1 text-sm">
                <input type="checkbox" checked={feedback} onChange={(e) => setFeedback(e.target.checked)} className="size-4 accent-[var(--primary)]" /> Immediate feedback
              </label>
            )}
            <label className="flex items-center gap-2.5 text-sm">
              <input type="checkbox" checked={timed} onChange={(e) => setTimed(e.target.checked)} className="size-4 accent-[var(--primary)]" />
              <Timer className="size-4 text-muted" /> Timed
            </label>
            {timed && (
              <div className="flex items-center gap-2">
                <Input type="number" min={1} max={300} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="h-9 w-24" aria-label="Minutes" />
                <span className="text-sm text-muted">minutes</span>
              </div>
            )}
          </Card>
          {error && <ErrorNote>{error}</ErrorNote>}
          <Button size="lg" className="w-full" onClick={create} loading={busy} disabled={!aiReady || !courseId || !types.length || !course?.topics.length}>
            Create exam
          </Button>
          <p className="text-center text-xs text-muted">Writing {count} questions locally takes roughly {estimate}–{estimate * 2} min on a laptop. You can leave this page.</p>
        </div>
      </div>
    </div>
  );
}

export default function NewExamPage() {
  return (
    <Suspense>
      <NewExamInner />
    </Suspense>
  );
}
