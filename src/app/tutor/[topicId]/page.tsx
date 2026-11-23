"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUp,
  BookOpenCheck,
  CheckCircle2,
  ClipboardCheck,
  ExternalLink,
  FileText,
  GitCompare,
  HelpCircle,
  Layers,
  Lightbulb,
  ListOrdered,
  Loader2,
  MessageCircleQuestion,
  Play,
  PlugZap,
  RefreshCw,
  Search,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  TrendingUp,
  Wand2,
  XCircle,
  MonitorPlay as Youtube,
} from "lucide-react";
import { Badge, Button, ButtonLink, Card, CardHeader, ErrorNote, InfoNote, Skeleton, Textarea, cn } from "@/components/ui";
import { Markdown, MasteryBadge, SourceList, sourceHref, type Mastery, type SourceRef } from "@/components/learning";
import { Modal, useToast } from "@/components/overlay";
import { ApiError, api, readStream, useApi } from "@/lib/client";

interface TopicData {
  topic: { id: string; course_id: string; title: string; summary: string | null; objectives: string[]; importance: number };
  course: { id: string; title: string; color: string };
  sections: { id: string; idx: number; label: string; title: string | null; document_id: string; display_name: string; ext: string }[];
  lesson: { content: string; sources: SourceRef[]; checks: Check[] } | null;
  chat: { id: string; role: string; content: string; action: string | null; sources: SourceRef[]; generation_id: string | null }[];
  mastery: Mastery;
}
interface Check {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}
type StreamEv = { type: "sources"; sources: SourceRef[]; mode: string } | { type: "text"; text: string } | { type: "meta"; adaptive?: boolean; strategy?: string } | { type: "done"; id?: string } | { type: "error"; message: string };

const ACTIONS = [
  { id: "simpler", label: "Explain simpler", icon: Wand2 },
  { id: "example", label: "Give me an example", icon: Lightbulb },
  { id: "deeper", label: "Go more in-depth", icon: TrendingUp },
  { id: "quiz", label: "Quiz me", icon: HelpCircle },
  { id: "why", label: "Why is this important?", icon: MessageCircleQuestion },
  { id: "difference", label: "Explain the difference", icon: GitCompare },
  { id: "steps", label: "Teach me step by step", icon: ListOrdered },
];

function SourcePreview({ source, onClose }: { source: SourceRef | null; onClose: () => void }) {
  const { data } = useApi<{ sections: { idx: number; label: string; title: string | null; content: string; notes: string | null }[]; document: { ext: string } }>(source ? `/api/documents/${source.documentId}` : null);
  const sec = data?.sections.find((s) => s.idx === source?.sectionIdx);
  return (
    <Modal open={Boolean(source)} onClose={onClose} title={source ? `${source.documentName} · ${source.sectionLabel}` : ""} wide>
      {!sec ? (
        <Skeleton className="h-40" />
      ) : (
        <div>
          <Badge tone="primary">From your course material</Badge>
          {sec.title && <h3 className="mt-3 text-base font-semibold">{sec.title}</h3>}
          <div className="mt-2">
            <Markdown text={sec.content || "_(no text on this slide)_"} />
          </div>
          {sec.notes && <p className="mt-4 rounded-xl bg-surface-2 px-4 py-3 text-sm text-text-2"><b>Lecturer&apos;s notes:</b> {sec.notes}</p>}
          <div className="mt-5 flex justify-end">
            <ButtonLink href={sourceHref(source!)} variant="secondary" size="sm" icon={<FileText className="size-3.5" />}>
              Open full document
            </ButtonLink>
          </div>
        </div>
      )}
    </Modal>
  );
}

function KnowledgeChecks({ topicId, initial, aiReady }: { topicId: string; initial: Check[]; aiReady: boolean }) {
  const [checks, setChecks] = useState<Check[]>(initial);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setChecks((await api<{ checks: Check[] }>(`/api/topics/${topicId}/checks`, { method: "POST" })).checks);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  const answer = async (i: number, opt: number) => {
    if (answers[i] !== undefined) return;
    setAnswers({ ...answers, [i]: opt });
    await api(`/api/topics/${topicId}/checks`, { method: "PUT", json: { correct: opt === checks[i].correctIndex } }).catch(() => {});
  };
  const score = Object.entries(answers).filter(([i, a]) => checks[Number(i)]?.correctIndex === a).length;

  return (
    <Card>
      <CardHeader
        title="Check your understanding"
        subtitle={checks.length ? `${Object.keys(answers).length}/${checks.length} answered${Object.keys(answers).length ? ` · ${score} correct` : ""}` : "Three quick questions to lock it in"}
        icon={<BookOpenCheck className="size-4" />}
      />
      <div className="p-5 pt-4">
        {!checks.length ? (
          <>
            <Button variant="soft" onClick={load} loading={loading} disabled={!aiReady} icon={<Play className="size-3.5" />}>
              Start knowledge check
            </Button>
            {error && <p className="mt-2 text-sm text-danger">{error}</p>}
          </>
        ) : (
          <ol className="space-y-6">
            {checks.map((c, i) => {
              const picked = answers[i];
              return (
                <li key={i}>
                  <p className="text-sm font-medium">
                    {i + 1}. {c.question}
                  </p>
                  <div className="mt-2.5 grid gap-2">
                    {c.options.map((o, j) => {
                      const state = picked === undefined ? "idle" : j === c.correctIndex ? "right" : j === picked ? "wrong" : "dim";
                      return (
                        <button
                          key={j}
                          onClick={() => answer(i, j)}
                          disabled={picked !== undefined}
                          className={cn(
                            "flex items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left text-sm transition-colors",
                            state === "idle" && "border-border hover:border-primary/50 hover:bg-surface-2",
                            state === "right" && "border-success/40 bg-success-soft",
                            state === "wrong" && "border-danger/40 bg-danger-soft",
                            state === "dim" && "border-border opacity-60",
                          )}
                        >
                          <span className="grid size-6 shrink-0 place-items-center rounded-lg bg-surface-2 text-xs font-semibold">{String.fromCharCode(65 + j)}</span>
                          <span className="flex-1">{o}</span>
                          {state === "right" && <CheckCircle2 className="size-4 text-success" />}
                          {state === "wrong" && <XCircle className="size-4 text-danger" />}
                        </button>
                      );
                    })}
                  </div>
                  {picked !== undefined && c.explanation && (
                    <div className="mt-2.5 rounded-xl bg-surface-2 px-3.5 py-2.5 text-[13px] text-text-2 animate-rise">
                      <Markdown text={c.explanation} />
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </Card>
  );
}

function Resources({ topicId }: { topicId: string }) {
  const [refresh, setRefresh] = useState(0);
  const [started, setStarted] = useState(false);
  const { data, loading, error } = useApi<{ resources: { id: string; provider: string; title: string; url: string; thumbnail: string | null; channel: string | null; duration: string | null; reason: string | null; description: string | null }[]; youtubeEnabled: boolean; errors: string[] }>(
    started ? `/api/topics/${topicId}/resources${refresh ? `?refresh=1&n=${refresh}` : ""}` : null,
  );
  return (
    <Card>
      <CardHeader
        title="Learn more elsewhere"
        subtitle="Real external resources — not from your course"
        icon={<ExternalLink className="size-4" />}
        action={
          started && (
            <button onClick={() => setRefresh(refresh + 1)} className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-text" aria-label="Search again">
              <RefreshCw className="size-3.5" />
            </button>
          )
        }
      />
      <div className="p-4 pt-3">
        {!started ? (
          <Button variant="secondary" size="sm" onClick={() => setStarted(true)} icon={<Search className="size-3.5" />} className="w-full">
            Find videos & explainers
          </Button>
        ) : loading && !data ? (
          <div className="space-y-2">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : error ? (
          <p className="text-sm text-danger">{error}</p>
        ) : (
          <div className="space-y-2">
            {data && !data.youtubeEnabled && (
              <InfoNote className="text-xs" icon={<Youtube className="size-3.5" />}>
                Add a free YouTube API key in <Link href="/settings#integrations" className="underline">Settings</Link> to see videos.
              </InfoNote>
            )}
            {data?.errors.map((e, i) => (
              <p key={i} className="text-xs text-danger">
                {e}
              </p>
            ))}
            {data?.resources.length === 0 && <p className="text-sm text-muted">Nothing found.</p>}
            {data?.resources.map((r) => (
              <a key={r.id} href={r.url} target="_blank" rel="noopener noreferrer" className="flex gap-3 rounded-xl p-2 hover:bg-surface-2">
                {r.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.thumbnail} alt="" className={cn("shrink-0 rounded-lg object-cover", r.provider === "youtube" ? "h-14 w-24" : "size-14")} loading="lazy" />
                ) : (
                  <div className="grid size-14 shrink-0 place-items-center rounded-lg bg-surface-2 text-xs font-bold text-muted">W</div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-2 text-[13px] font-medium leading-snug">{r.title}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
                    {r.provider === "youtube" ? <Youtube className="size-3 text-red-500" /> : <FileText className="size-3" />}
                    {r.channel}
                    {r.duration && ` · ${r.duration}`}
                  </div>
                  {r.reason && <div className="mt-1 line-clamp-2 text-[11.5px] text-text-2">{r.reason}</div>}
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

function TutorInner() {
  const { topicId } = useParams<{ topicId: string }>();
  const params = useSearchParams();
  const toast = useToast();
  const { data, error, reload } = useApi<TopicData>(`/api/topics/${topicId}`);
  const { data: status } = useApi<{ reachable: boolean; chatModel: { name: string; installed: boolean }; error?: string }>("/api/status");
  const aiReady = Boolean(status?.reachable && status.chatModel.installed);

  const [lessonText, setLessonText] = useState<string | null>(null);
  const [lessonSources, setLessonSources] = useState<SourceRef[]>([]);
  const [lessonBusy, setLessonBusy] = useState(false);
  const [chat, setChat] = useState<TopicData["chat"]>([]);
  const [streaming, setStreaming] = useState<{ text: string; sources: SourceRef[]; adaptive?: string } | null>(null);
  const [input, setInput] = useState("");
  const [socratic, setSocratic] = useState(false);
  const [preview, setPreview] = useState<SourceRef | null>(null);
  const [slidesOpen, setSlidesOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!data) return;
    setLessonText(data.lesson?.content ?? null);
    setLessonSources(data.lesson?.sources ?? []);
    setChat(data.chat);
  }, [data]);
  useEffect(() => {
    try {
      setSocratic(localStorage.getItem("ll-socratic") === "1");
    } catch {}
  }, []);
  useEffect(() => () => abortRef.current?.abort(), []);

  const scroll = () => setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 30);

  const generateLesson = useCallback(async () => {
    setLessonBusy(true);
    setErr(null);
    setLessonText("");
    abortRef.current = new AbortController();
    try {
      const res = await fetch(`/api/topics/${topicId}/lesson`, { method: "POST", signal: abortRef.current.signal });
      await readStream<StreamEv>(res, (ev) => {
        if (ev.type === "sources") setLessonSources(ev.sources);
        if (ev.type === "text") setLessonText((t) => (t ?? "") + ev.text);
        if (ev.type === "error") setErr(ev.message);
      });
      reload();
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setErr((e as Error).message);
        setLessonText(data?.lesson?.content ?? null);
      }
    } finally {
      setLessonBusy(false);
    }
  }, [topicId, reload, data?.lesson?.content]);

  const send = async (opts: { message?: string; action?: string }) => {
    if (streaming) return;
    setErr(null);
    const label = opts.action ? ACTIONS.find((a) => a.id === opts.action)?.label ?? opts.action : opts.message!;
    setChat((c) => [...c, { id: `local-${Date.now()}`, role: "user", content: label, action: opts.action ?? null, sources: [], generation_id: null }]);
    setInput("");
    setStreaming({ text: "", sources: [] });
    scroll();
    abortRef.current = new AbortController();
    try {
      const res = await fetch(`/api/topics/${topicId}/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...opts, socratic }), signal: abortRef.current.signal });
      await readStream<StreamEv>(res, (ev) => {
        if (ev.type === "sources") setStreaming((s) => s && { ...s, sources: ev.sources });
        if (ev.type === "meta" && ev.adaptive) setStreaming((s) => s && { ...s, adaptive: ev.strategy });
        if (ev.type === "text") {
          setStreaming((s) => s && { ...s, text: s.text + ev.text });
          scroll();
        }
        if (ev.type === "error") setErr(ev.message);
      });
      const fresh = await api<TopicData>(`/api/topics/${topicId}`);
      setChat(fresh.chat);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setErr(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setStreaming(null);
    }
  };

  const rate = async (genId: string, rating: 1 | -1) => {
    await api(`/api/generations/${genId}`, { method: "PATCH", json: { rating } });
    toast(rating === 1 ? "Thanks — marked as helpful" : "Thanks — we'll use this to improve");
  };

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data)
    return (
      <div className="space-y-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-96" />
      </div>
    );
  const { topic, course, sections, mastery } = data;
  const adaptive = params.get("adaptive") === "1";
  const lastAnswer = [...chat].reverse().find((m) => m.role === "assistant" && m.sources.length);
  const latest = streaming?.sources.length ? { sources: streaming.sources, text: streaming.text } : lastAnswer ? { sources: lastAnswer.sources, text: lastAnswer.content } : { sources: lessonSources, text: lessonText ?? "" };
  // Show the sources the answer actually cites (all retrieved ones until it cites any).
  const cited = new Set([...latest.text.matchAll(/S(\d+)/g)].map((m) => Number(m[1])));
  const latestSources = cited.size ? latest.sources.filter((s) => cited.has(s.n)) : latest.sources;

  return (
    <div className="animate-rise">
      <div className="mb-6">
        <Link href="/tutor" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-text">
          <ArrowLeft className="size-3.5" /> {course.title}
        </Link>
        <div className="mt-1.5 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">{topic.title}</h1>
          <MasteryBadge m={mastery} />
        </div>
        {topic.objectives.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {topic.objectives.map((o, i) => (
              <li key={i} className="rounded-lg bg-surface-2 px-2.5 py-1 text-xs text-text-2">
                {o}
              </li>
            ))}
          </ul>
        )}
      </div>

      {status && !aiReady && (
        <InfoNote tone="warning" icon={<PlugZap className="size-4" />} className="mb-5">
          <b>The local AI tutor isn&apos;t available.</b> {status.error ?? `The model "${status.chatModel.name}" isn't installed.`}{" "}
          <Link href="/settings#models" className="underline">
            Set up AI models
          </Link>
          . You can still read the original slides below.
        </InfoNote>
      )}
      {adaptive && mastery.status === "weak" && (
        <InfoNote tone="primary" icon={<Sparkles className="size-4" />} className="mb-5">
          You&apos;ve found this topic tricky, so your tutor will explain it a <b>different way</b> this time. Try <b>Explain simpler</b> or <b>Teach me step by step</b>.
        </InfoNote>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0 space-y-5">
          {/* Lesson */}
          <Card>
            <CardHeader
              title="Lesson"
              subtitle={lessonText ? "Generated from your course files · tap the slide chips to see the source" : "A structured lesson built from your slides"}
              icon={<Sparkles className="size-4" />}
              action={
                lessonText && !lessonBusy ? (
                  <Button variant="ghost" size="sm" onClick={generateLesson} disabled={!aiReady} icon={<RefreshCw className="size-3.5" />}>
                    Regenerate
                  </Button>
                ) : null
              }
            />
            <div className="p-5 pt-4">
              {lessonText ? (
                <>
                  <Markdown text={lessonText} sources={lessonSources} onCite={setPreview} />
                  {lessonBusy && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-primary align-middle" />}
                </>
              ) : (
                <div className="flex flex-col items-start gap-3 rounded-xl bg-surface-2 p-5">
                  <p className="text-sm text-text-2">Your tutor will write an introduction, explain the key concepts and definitions, give examples, highlight what your lecturer emphasised, and finish with a recap.</p>
                  <Button onClick={generateLesson} loading={lessonBusy} disabled={!aiReady} icon={<Play className="size-4" />}>
                    Teach me this topic
                  </Button>
                  {lessonBusy && <p className="text-xs text-muted">Reading your slides… the first reply can take a little while on a laptop.</p>}
                </div>
              )}
            </div>
          </Card>

          {lessonText && !lessonBusy && <KnowledgeChecks topicId={topicId} initial={data.lesson?.checks ?? []} aiReady={aiReady} />}

          {/* Conversation */}
          <Card>
            <CardHeader
              title="Ask your tutor"
              subtitle="Follow-up questions, examples, or a different explanation"
              icon={<MessageCircleQuestion className="size-4" />}
              action={
                chat.length > 0 && (
                  <button
                    onClick={async () => {
                      if (!confirm("Clear this conversation?")) return;
                      await api(`/api/topics/${topicId}/chat`, { method: "DELETE" });
                      setChat([]);
                    }}
                    className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-text"
                    aria-label="Clear conversation"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )
              }
            />
            <div className="space-y-4 p-5 pt-4" aria-live="polite">
              {chat.map((m) =>
                m.role === "user" ? (
                  <div key={m.id} className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-white">{m.content}</div>
                  </div>
                ) : (
                  <div key={m.id} className="group">
                    <Markdown text={m.content} sources={m.sources} onCite={setPreview} />
                    {m.generation_id && (
                      <div className="mt-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        <button onClick={() => rate(m.generation_id!, 1)} className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-success" aria-label="Helpful">
                          <ThumbsUp className="size-3.5" />
                        </button>
                        <button onClick={() => rate(m.generation_id!, -1)} className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-danger" aria-label="Not helpful">
                          <ThumbsDown className="size-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                ),
              )}
              {streaming && (
                <div>
                  {streaming.adaptive && (
                    <Badge tone="primary" className="mb-2">
                      <Sparkles className="size-3" /> Trying a different approach: {streaming.adaptive.replace("-", " ")}
                    </Badge>
                  )}
                  {streaming.text ? (
                    <Markdown text={streaming.text} sources={streaming.sources} onCite={setPreview} />
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-muted">
                      <Loader2 className="size-4 animate-spin" /> Thinking…
                    </div>
                  )}
                </div>
              )}
              {err && <ErrorNote>{err}</ErrorNote>}
              <div ref={endRef} />

              <div className="flex flex-wrap gap-1.5 pt-1">
                {ACTIONS.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => send({ action: a.id })}
                    disabled={!aiReady || Boolean(streaming)}
                    className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text-2 transition-colors hover:border-primary/40 hover:bg-primary-soft hover:text-primary-text disabled:opacity-50"
                  >
                    <a.icon className="size-3.5" /> {a.label}
                  </button>
                ))}
                <button onClick={() => setSlidesOpen(true)} className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text-2 hover:bg-surface-2">
                  <FileText className="size-3.5" /> Show original slide
                </button>
              </div>

              <form
                className="relative"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (input.trim()) send({ message: input.trim() });
                }}
              >
                <Textarea
                  rows={2}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (input.trim()) send({ message: input.trim() });
                    }
                  }}
                  placeholder={socratic ? "Share your thinking — your tutor will guide you…" : "Ask anything about this topic…"}
                  disabled={!aiReady}
                  className="resize-none pr-14"
                  aria-label="Message your tutor"
                />
                <Button type="submit" size="sm" className="absolute bottom-2.5 right-2.5 size-9 rounded-xl p-0" disabled={!input.trim() || Boolean(streaming) || !aiReady} aria-label="Send">
                  <ArrowUp className="size-4" />
                </Button>
              </form>
              <label className="flex cursor-pointer items-center gap-2.5 text-[13px] text-text-2">
                <input
                  type="checkbox"
                  checked={socratic}
                  onChange={(e) => {
                    setSocratic(e.target.checked);
                    try {
                      localStorage.setItem("ll-socratic", e.target.checked ? "1" : "0");
                    } catch {}
                  }}
                  className="size-4 accent-[var(--primary)]"
                />
                <span>
                  <b>Socratic mode</b> — guide me to the answer with questions instead of telling me
                </span>
              </label>
            </div>
          </Card>
        </div>

        <aside className="space-y-4">
          <Card>
            <CardHeader title="Sources used" subtitle="From your course files" icon={<FileText className="size-4" />} />
            <div className="p-4 pt-3">{latestSources.length ? <SourceList sources={latestSources} onOpen={setPreview} /> : <p className="text-sm text-muted">Sources appear here once your tutor answers.</p>}</div>
          </Card>
          <Card>
            <CardHeader title="Practise this topic" icon={<ClipboardCheck className="size-4" />} />
            <div className="grid gap-2 p-4 pt-3">
              <ButtonLink href={`/exams/new?course=${course.id}&topic=${topic.id}`} variant="secondary" size="sm" icon={<ClipboardCheck className="size-3.5" />}>
                Practice quiz
              </ButtonLink>
              <ButtonLink href={`/flashcards?topic=${topic.id}`} variant="secondary" size="sm" icon={<Layers className="size-3.5" />}>
                Flashcards
              </ButtonLink>
            </div>
          </Card>
          <Resources topicId={topicId} />
        </aside>
      </div>

      <SourcePreview source={preview} onClose={() => setPreview(null)} />
      <Modal open={slidesOpen} onClose={() => setSlidesOpen(false)} title="Original slides for this topic">
        {sections.length ? (
          <ul className="space-y-1.5">
            {sections.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => {
                    setSlidesOpen(false);
                    setPreview({ n: 0, chunkId: "", documentId: s.document_id, documentName: s.display_name, sectionIdx: s.idx, sectionLabel: s.label, sectionTitle: s.title, excerpt: "" });
                  }}
                  className="flex w-full items-center gap-3 rounded-xl border border-border px-3 py-2.5 text-left hover:bg-surface-2"
                >
                  <Badge>{s.label}</Badge>
                  <span className="min-w-0 flex-1 truncate text-sm">{s.title ?? s.display_name}</span>
                  <span className="hidden truncate text-xs text-muted sm:block">{s.display_name}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">This topic isn&apos;t linked to specific slides. Use the source chips in the lesson instead.</p>
        )}
      </Modal>
    </div>
  );
}

export default function TutorTopicPage() {
  return (
    <Suspense>
      <TutorInner />
    </Suspense>
  );
}
