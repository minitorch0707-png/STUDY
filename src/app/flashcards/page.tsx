"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Layers, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { Badge, Button, ButtonLink, Card, EmptyState, ErrorNote, Field, Input, PageHeader, ProgressBar, Select, Skeleton } from "@/components/ui";
import { CourseDot } from "@/components/learning";
import { Modal, useToast } from "@/components/overlay";
import { api, useApi } from "@/lib/client";

interface Deck {
  id: string;
  course_id: string;
  topic_id: string | null;
  title: string;
  status: string;
  status_detail: string | null;
  course_title: string;
  course_color: string;
  card_count: number;
  due_count: number;
  new_count: number;
  mastered_count: number;
}

function GenerateForm({ initialTopic, onDone }: { initialTopic?: string | null; onDone: () => void }) {
  const toast = useToast();
  const { data: courses } = useApi<{ id: string; title: string; topic_count: number }[]>("/api/courses");
  const [courseId, setCourseId] = useState("");
  const [topicId, setTopicId] = useState(initialTopic ?? "");
  const [count, setCount] = useState(12);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { data: topicInfo } = useApi<{ topic: { course_id: string } }>(initialTopic ? `/api/topics/${initialTopic}` : null);
  useEffect(() => {
    if (topicInfo) setCourseId(topicInfo.topic.course_id);
    else if (!courseId && courses?.length && !initialTopic) setCourseId(courses.find((c) => c.topic_count)?.id ?? courses[0].id);
  }, [courses, topicInfo, courseId, initialTopic]);
  const { data: course } = useApi<{ topics: { id: string; title: string }[] }>(courseId ? `/api/courses/${courseId}` : null);

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        try {
          await api(`/api/topics/${topicId}/flashcards`, { method: "POST", json: { count } });
          toast("Generating flashcards — they'll appear in a moment");
          onDone();
        } catch (e) {
          setErr((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="Course" htmlFor="g-course">
        <Select id="g-course" value={courseId} onChange={(e) => { setCourseId(e.target.value); setTopicId(""); }}>
          {courses?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Topic" htmlFor="g-topic">
        <Select id="g-topic" required value={topicId} onChange={(e) => setTopicId(e.target.value)}>
          <option value="">Choose a topic…</option>
          {course?.topics.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={`Number of cards: ${count}`} htmlFor="g-count">
        <input id="g-count" type="range" min={4} max={25} value={count} onChange={(e) => setCount(Number(e.target.value))} className="w-full accent-[var(--primary)]" />
      </Field>
      {err && <ErrorNote>{err}</ErrorNote>}
      <div className="flex justify-end">
        <Button type="submit" loading={busy} disabled={!topicId} icon={<Sparkles className="size-4" />}>
          Generate cards
        </Button>
      </div>
    </form>
  );
}

function ManualDeckForm({ onDone }: { onDone: (id: string) => void }) {
  const { data: courses } = useApi<{ id: string; title: string }[]>("/api/courses");
  const [courseId, setCourseId] = useState("");
  const [title, setTitle] = useState("");
  useEffect(() => {
    if (!courseId && courses?.length) setCourseId(courses[0].id);
  }, [courses, courseId]);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const { id } = await api<{ id: string }>("/api/decks", { method: "POST", json: { courseId, title } });
        onDone(id);
      }}
    >
      <Field label="Course" htmlFor="m-course">
        <Select id="m-course" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
          {courses?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Deck name" htmlFor="m-title">
        <Input id="m-title" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Key cases" />
      </Field>
      <div className="flex justify-end">
        <Button type="submit" disabled={!courseId}>
          Create deck
        </Button>
      </div>
    </form>
  );
}

function FlashcardsInner() {
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const [gen, setGen] = useState(false);
  const [manual, setManual] = useState(false);
  const { data, loading, reload } = useApi<Deck[]>("/api/decks", { poll: (d) => (d?.some((x) => x.status === "generating") ? 2000 : false) });
  useEffect(() => {
    if (params.get("topic")) setGen(true);
  }, [params]);

  const totalDue = data?.reduce((s, d) => s + d.due_count, 0) ?? 0;
  const byCourse = new Map<string, Deck[]>();
  for (const d of data ?? []) byCourse.set(d.course_title, [...(byCourse.get(d.course_title) ?? []), d]);

  return (
    <div className="animate-rise">
      <PageHeader
        title="Flashcards"
        subtitle="Spaced repetition: each card comes back right before you'd forget it."
        actions={
          <>
            <Button variant="secondary" onClick={() => setManual(true)} icon={<Plus className="size-4" />}>
              New deck
            </Button>
            <Button onClick={() => setGen(true)} icon={<Sparkles className="size-4" />}>
              Generate from a topic
            </Button>
          </>
        }
      />
      {data && data.length > 0 && (
        <Card className="mb-5 flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          <div className="grid size-12 place-items-center rounded-2xl bg-primary-soft text-primary-text">
            <Layers className="size-5" />
          </div>
          <div className="flex-1">
            <div className="text-[15px] font-semibold">{totalDue ? `${totalDue} card${totalDue > 1 ? "s" : ""} due for review` : "You're all caught up"}</div>
            <div className="text-sm text-muted">{totalDue ? "A few minutes now saves hours before the exam." : "New cards are introduced 20 at a time. Study new cards or cram a whole deck anytime."}</div>
          </div>
          <ButtonLink href="/flashcards/review" icon={<Layers className="size-4" />}>
            {totalDue ? "Review now" : "Study new cards"}
          </ButtonLink>
        </Card>
      )}
      {loading && !data ? (
        <Skeleton className="h-56" />
      ) : !data?.length ? (
        <Card>
          <EmptyState icon={<Layers className="size-5" />} title="No flashcards yet" body="Generate a deck from any topic in your courses, or make your own cards." action={<Button onClick={() => setGen(true)} icon={<Sparkles className="size-4" />}>Generate from a topic</Button>} />
        </Card>
      ) : (
        <div className="space-y-6">
          {[...byCourse.entries()].map(([course, decks]) => (
            <section key={course}>
              <h2 className="mb-2.5 flex items-center gap-2 text-sm font-semibold text-text-2">
                <CourseDot color={decks[0].course_color} /> {course}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {decks.map((d) => (
                  <Card key={d.id} className="group flex flex-col p-4">
                    <div className="flex items-start justify-between gap-2">
                      <Link href={`/flashcards/${d.id}`} className="text-sm font-semibold leading-snug hover:text-primary-text">
                        {d.title}
                      </Link>
                      <button
                        onClick={async () => {
                          if (!confirm(`Delete deck "${d.title}" and its ${d.card_count} cards?`)) return;
                          await api(`/api/decks/${d.id}`, { method: "DELETE" });
                          toast("Deck deleted");
                          reload();
                        }}
                        className="rounded-md p-1 text-muted opacity-0 hover:text-danger group-hover:opacity-100 focus:opacity-100"
                        aria-label="Delete deck"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                    {d.status === "generating" ? (
                      <div className="mt-2 flex items-center gap-2 text-xs text-primary-text">
                        <Loader2 className="size-3.5 animate-spin" /> Writing cards…
                      </div>
                    ) : d.status === "failed" ? (
                      <p className="mt-2 text-xs text-danger">{d.status_detail}</p>
                    ) : (
                      <>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <Badge>{d.card_count} cards</Badge>
                          {d.due_count > 0 && <Badge tone="primary">{d.due_count} due</Badge>}
                          {d.new_count > 0 && <Badge>{d.new_count} new</Badge>}
                        </div>
                        <div className="mt-3">
                          <div className="mb-1 flex justify-between text-[11px] text-muted">
                            <span>Mastered</span>
                            <span>
                              {d.mastered_count}/{d.card_count}
                            </span>
                          </div>
                          <ProgressBar value={d.card_count ? d.mastered_count / d.card_count : 0} tone="success" label="Mastered cards" />
                        </div>
                        {d.status_detail && <p className="mt-2 text-xs text-muted">{d.status_detail}</p>}
                      </>
                    )}
                    <div className="mt-4 flex gap-2">
                      <ButtonLink href={`/flashcards/review?deck=${d.id}`} size="sm" className="flex-1">
                        Study
                      </ButtonLink>
                      <ButtonLink href={`/flashcards/${d.id}`} size="sm" variant="secondary">
                        Edit
                      </ButtonLink>
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      <Modal open={gen} onClose={() => setGen(false)} title="Generate flashcards">
        <GenerateForm
          initialTopic={params.get("topic")}
          onDone={() => {
            setGen(false);
            reload();
          }}
        />
      </Modal>
      <Modal open={manual} onClose={() => setManual(false)} title="New deck">
        <ManualDeckForm onDone={(id) => router.push(`/flashcards/${id}`)} />
      </Modal>
    </div>
  );
}

export default function FlashcardsPage() {
  return (
    <Suspense>
      <FlashcardsInner />
    </Suspense>
  );
}
