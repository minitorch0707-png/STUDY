"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  BookOpenCheck,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Circle,
  ExternalLink,
  FileText,
  GitCompare,
  HelpCircle,
  Layers,
  Lightbulb,
  ListOrdered,
  MessageCircleQuestion,
  NotebookPen,
  Play,
  PlugZap,
  RefreshCw,
  RotateCcw,
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
import { Badge, Button, ButtonLink, Card, CardHeader, ErrorNote, InfoNote, PageHeader, ProgressBar, Skeleton, Textarea, cn } from "@/components/ui";
import { Markdown, MasteryBadge, sourceHref, type Mastery, type SourceRef } from "@/components/learning";
import { Modal, useToast } from "@/components/overlay";
import { MarginStatus, useSavedFlash, type MarginState } from "@/components/margin";
import { FasterModelOffer, QuickRepliesToggle } from "@/components/speed";
import { ApiError, api, readStream, useApi } from "@/lib/client";

type Status = "streaming" | "complete" | "interrupted" | "failed";
interface Msg {
  id: string;
  seq: number;
  role: "user" | "assistant";
  content: string;
  action: string | null;
  status: Status;
  error: string | null;
  reply_to: string | null;
  client_id: string | null;
  generation_id: string | null;
  sources: SourceRef[];
}
interface Lesson {
  id: string;
  content: string;
  status: Status;
  error: string | null;
  sources: SourceRef[];
  checks: Check[];
}
interface TopicData {
  topic: { id: string; course_id: string; title: string; summary: string | null; objectives: string[]; importance: number };
  course: { id: string; title: string; code: string | null; color: string };
  sections: { id: string; idx: number; label: string; title: string | null; document_id: string; display_name: string; ext: string }[];
  lesson: Lesson | null;
  chat: Msg[];
  thread: { draft: string; resume_message_id: string | null } | null;
  savedMessageIds: string[];
  mastery: Mastery;
}
interface Check {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}
type LiveEv = { type: "text"; text: string; at: number } | { type: "meta"; sources?: SourceRef[]; adaptive?: boolean; strategy?: string } | { type: "done" } | { type: "error"; message: string };

const ACTIONS = [
  { id: "simpler", label: "Explain simpler", icon: Wand2 },
  { id: "example", label: "Give me an example", icon: Lightbulb },
  { id: "deeper", label: "Go more in-depth", icon: TrendingUp },
  { id: "quiz", label: "Quiz me", icon: HelpCircle },
  { id: "why", label: "Why is this important?", icon: MessageCircleQuestion },
  { id: "difference", label: "Explain the difference", icon: GitCompare },
  { id: "steps", label: "Teach me step by step", icon: ListOrdered },
];

const newClientId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `c-${Date.now()}-${Math.random().toString(36).slice(2)}`);
const shortLabel = (s: SourceRef) => s.sectionLabel.replace(/^Slide /, "slide ").replace(/^Page /, "page ");
/** Sources an answer actually cites (all of them until it cites any). */
function citedSources(text: string, sources: SourceRef[]) {
  const cited = new Set([...text.matchAll(/S(\d+)/g)].map((m) => Number(m[1])));
  return cited.size ? sources.filter((s) => cited.has(s.n)) : sources;
}

/** Page or slide preview: the real PDF page, the image, or a 16:9 slide card. */
function SourcePreview({ source, onClose }: { source: SourceRef | null; onClose: () => void }) {
  const { data } = useApi<{ sections: { idx: number; label: string; title: string | null; content: string; notes: string | null }[]; document: { ext: string } }>(source ? `/api/documents/${source.documentId}` : null);
  const sec = data?.sections.find((s) => s.idx === source?.sectionIdx);
  const ext = data?.document.ext ?? "";
  const page = sec ? Number(/^Page (\d+)/.exec(sec.label)?.[1] ?? 0) : 0;
  const isSlide = sec ? /^Slide /.test(sec.label) : false;
  return (
    <Modal open={Boolean(source)} onClose={onClose} title={source ? `${source.documentName} · ${source.sectionLabel}` : ""} wide>
      {!sec ? (
        <Skeleton className="h-40" />
      ) : (
        <div>
          <Badge tone="primary">From your course material</Badge>
          {ext === "pdf" && page > 0 ? (
            <iframe title={`${source!.documentName}, ${sec.label}`} src={`/api/documents/${source!.documentId}/file#page=${page}&view=FitH`} className="mt-3 h-[60vh] w-full rounded-xl border border-border bg-surface-2" />
          ) : ["png", "jpg", "jpeg", "webp"].includes(ext) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/documents/${source!.documentId}/file`} alt={sec.title ?? source!.documentName} className="mt-3 max-h-[60vh] w-full rounded-xl border border-border object-contain" />
          ) : isSlide ? (
            <div className="mt-3 aspect-video w-full overflow-hidden rounded-xl border border-border bg-surface-2 p-6 sm:p-8">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{sec.label}</div>
              {sec.title && <h3 className="font-display mt-2 text-2xl leading-tight">{sec.title}</h3>}
              <div className="mt-3 max-h-[70%] overflow-y-auto text-sm">
                <Markdown text={sec.content || "_(no text on this slide)_"} />
              </div>
            </div>
          ) : (
            <>
              {sec.title && <h3 className="mt-3 text-base font-semibold">{sec.title}</h3>}
              <div className="mt-2">
                <Markdown text={sec.content || "_(no text in this part)_"} />
              </div>
            </>
          )}
          {source!.excerpt && (
            <blockquote className="mt-4 border-l-2 border-primary pl-3 text-sm text-text-2">
              <span className="text-xs font-medium text-muted">The tutor used: </span>
              {source!.excerpt.slice(0, 400)}
            </blockquote>
          )}
          {sec.notes && (
            <p className="mt-4 rounded-xl bg-surface-2 px-4 py-3 text-sm text-text-2">
              <b>Lecturer&apos;s notes:</b> {sec.notes}
            </p>
          )}
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

function LessonProgress({ topicId, title, lesson, questions, checksDone, savedCount, mastery, tick }: { topicId: string; title: string; lesson: Lesson | null; questions: number; checksDone: boolean; savedCount: number; mastery: Mastery; tick: number }) {
  const toast = useToast();
  const { data, reload, setData } = useApi<{ note: { id: string; content: string } | null; updating: boolean; autoNotes: boolean }>(`/api/topics/${topicId}/notes`, {
    poll: (d) => (d?.updating ? 2500 : 30000),
  });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (tick) reload();
  }, [tick, reload]);
  const steps = [
    { label: "Read the lesson", done: lesson?.status === "complete" },
    { label: questions ? `Asked ${questions} follow-up${questions === 1 ? "" : "s"}` : "Ask a follow-up", done: questions > 0 },
    { label: "Check your understanding", done: checksDone },
    { label: savedCount ? `${savedCount} answer${savedCount === 1 ? "" : "s"} saved to notes` : "Save an answer to notes", done: savedCount > 0 },
  ];
  const done = steps.filter((s) => s.done).length;
  return (
    <Card>
      <div className="px-5 pt-5">
        <h2 className="text-[17px] font-semibold tracking-tight">Lesson progress</h2>
      </div>
      <div className="mx-5 mt-3 border-t border-border" />
      <div className="space-y-4 p-5 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate font-semibold">{title}</div>
            <div className="text-[13px] text-muted">{done === steps.length ? "Done" : done ? "In progress" : "Not started"}</div>
          </div>
          {lesson?.status === "complete" && <Badge tone="primary">Saved lesson</Badge>}
        </div>
        <ProgressBar value={done / steps.length} label="Lesson progress" />
        <ul className="space-y-2 text-[13px]">
          {steps.map((s) => (
            <li key={s.label} className={cn("flex items-center gap-2", s.done ? "text-text" : "text-muted")}>
              {s.done ? <CheckCircle2 className="size-4 text-success" aria-hidden /> : <Circle className="size-4" aria-hidden />}
              <span>
                {s.label}
                <span className="sr-only">{s.done ? " (done)" : " (to do)"}</span>
              </span>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between text-[13px]">
          <span className="text-muted">Mastery</span>
          <MasteryBadge m={mastery} />
        </div>
        <div className="flex flex-wrap gap-2">
          {data?.note ? (
            <ButtonLink href={`/notes?id=${data.note.id}`} variant="secondary" size="sm">
              Open topic notes
            </ButtonLink>
          ) : (
            <p className="text-xs text-muted">{data?.autoNotes === false ? "Automatic notes are off (Settings)." : "Your notes appear a minute after you pause chatting."}</p>
          )}
          <Button
            variant="ghost"
            size="sm"
            loading={busy || data?.updating}
            icon={<RefreshCw className="size-3.5" />}
            onClick={async () => {
              setBusy(true);
              try {
                setData(await api(`/api/topics/${topicId}/notes`, { method: "POST", json: { refresh: true } }));
                toast("Notes updated");
              } catch (e) {
                toast((e as Error).message, "error");
              } finally {
                setBusy(false);
              }
            }}
          >
            Update notes
          </Button>
        </div>
      </div>
    </Card>
  );
}

function KnowledgeChecks({ topicId, initial, aiReady, onComplete }: { topicId: string; initial: Check[]; aiReady: boolean; onComplete?: () => void }) {
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
    const next = { ...answers, [i]: opt };
    setAnswers(next);
    if (Object.keys(next).length === checks.length) onComplete?.();
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
  const { data, error } = useApi<TopicData>(`/api/topics/${topicId}`);
  const { data: status } = useApi<{ reachable: boolean; chatModel: { name: string; installed: boolean }; error?: string }>("/api/status");
  const aiReady = Boolean(status?.reachable && status.chatModel.installed);

  // Stored state (from the server) ...
  const [chat, setChat] = useState<Msg[]>([]);
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  // ... plus live text for generations still being written. Text is kept in a
  // ref and painted at most once per animation frame, so a fast stream never
  // blocks rendering.
  const live = useRef(new Map<string, { text: string; sources?: SourceRef[]; strategy?: string }>());
  type LiveView = Map<string, { text: string; sources?: SourceRef[]; strategy?: string }>;
  const [liveView, setLiveView] = useState<LiveView>(new Map());
  const frame = useRef(0);
  const paint = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      setLiveView(new Map([...live.current].map(([k, v]) => [k, { ...v }])));
    });
  }, []);

  const [pending, setPending] = useState<{ content: string } | null>(null);
  const [input, setInput] = useState("");
  const [socratic, setSocratic] = useState(false);
  const [preview, setPreview] = useState<SourceRef | null>(null);
  const [slidesOpen, setSlidesOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notesTick, setNotesTick] = useState(0);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [checksDone, setChecksDone] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [savedFlash, flashSaved] = useSavedFlash();
  const endRef = useRef<HTMLDivElement>(null);
  const loaded = useRef(false);

  const apply = useCallback((d: Pick<TopicData, "chat" | "lesson" | "savedMessageIds">) => {
    setChat(d.chat);
    setLesson(d.lesson);
    setSaved(new Set(d.savedMessageIds));
  }, []);
  const refresh = useCallback(async () => {
    const d = await api<TopicData>(`/api/topics/${topicId}`);
    apply(d);
    return d;
  }, [topicId, apply]);

  // First load: stored conversation, unsent draft, and where the student was.
  useEffect(() => {
    if (!data || loaded.current) return;
    loaded.current = true;
    apply(data);
    setInput(data.thread?.draft ?? "");
    const resume = data.thread?.resume_message_id;
    if (resume) setTimeout(() => document.getElementById(`msg-${resume}`)?.scrollIntoView({ block: "start" }), 60);
  }, [data, apply]);
  useEffect(() => {
    try {
      setSocratic(localStorage.getItem("ll-socratic") === "1");
    } catch {}
    // Load the AI model into memory now, so the first answer starts sooner.
    fetch("/api/ai/warm", { method: "POST" }).catch(() => {});
  }, []);

  // ---------------------------------------------------------------- following
  // Each generation that is still being written is followed from the last
  // character we have. Leaving the screen only closes the connection; the
  // generation itself keeps running in the app and is picked up on return.
  const followers = useRef(new Map<string, AbortController>());
  const streamingKeys = [
    ...(lesson?.status === "streaming" ? [`lesson:${lesson.id}`] : []),
    ...chat.filter((m) => m.role === "assistant" && m.status === "streaming").map((m) => `msg:${m.id}`),
  ];
  const keysSig = streamingKeys.join(",");
  const stateRef = useRef({ chat, lesson });
  useEffect(() => {
    stateRef.current = { chat, lesson };
  }, [chat, lesson]);
  const [reattach, setReattach] = useState(0);

  const follow = useCallback(
    (key: string) => {
      const [kind, id] = key.split(":");
      const url = kind === "lesson" ? `/api/lessons/${id}/stream` : `/api/tutor/messages/${id}/stream`;
      if (!live.current.has(key)) {
        const { chat: c, lesson: l } = stateRef.current;
        const stored = kind === "lesson" ? (l?.id === id ? l : null) : c.find((m) => m.id === id);
        live.current.set(key, { text: stored?.content ?? "", sources: stored?.sources });
      }
      const ctrl = new AbortController();
      followers.current.set(key, ctrl);
      const from = live.current.get(key)!.text.length;
      const finish = async (ok: boolean) => {
        followers.current.delete(key);
        try {
          const d = await refresh();
          const item = kind === "lesson" ? d.lesson : d.chat.find((m) => m.id === id);
          // "Saved" only once the stored record says complete.
          if (ok && item?.status === "complete") flashSaved();
        } catch {
          /* keep what we have */
        }
        live.current.delete(key);
        paint();
        setReattach((n) => n + 1); // still being written (connection dropped)? follow again
      };
      (async () => {
        try {
          const res = await fetch(`${url}?from=${from}`, { signal: ctrl.signal });
          let ended = false;
          await readStream<LiveEv>(res, (ev) => {
            const cur = live.current.get(key);
            if (!cur) return;
            if (ev.type === "text") {
              if (ev.at > cur.text.length) {
                // A gap (we missed a piece): reconnect from what we have.
                ctrl.abort();
                return;
              }
              if (ev.at + ev.text.length <= cur.text.length) return; // already have it
              cur.text = cur.text.slice(0, ev.at) + ev.text;
              paint();
            } else if (ev.type === "meta") {
              if (ev.sources) cur.sources = ev.sources;
              if (ev.adaptive && ev.strategy) cur.strategy = ev.strategy;
              paint();
            } else if (ev.type === "done") {
              ended = true;
              void finish(true);
            } else if (ev.type === "error") {
              ended = true;
              void finish(false);
            }
          });
          if (!ended) void finish(false);
        } catch (e) {
          if (ctrl.signal.aborted && followers.current.get(key) !== ctrl) return; // closed on purpose
          followers.current.delete(key);
          // Lost connection or a gap: re-attach shortly from the last character.
          setTimeout(() => setReattach((n) => n + 1), (e as Error).name === "AbortError" ? 0 : 1500);
        }
      })();
    },
    [refresh, paint, flashSaved],
  );

  useEffect(() => {
    const want = new Set(keysSig ? keysSig.split(",") : []);
    for (const k of want) if (!followers.current.has(k)) follow(k);
    for (const [k, c] of followers.current)
      if (!want.has(k)) {
        followers.current.delete(k);
        c.abort();
      }
  }, [keysSig, follow, reattach]);
  useEffect(() => {
    const f = followers.current;
    return () => {
      for (const c of f.values()) c.abort();
      f.clear();
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, []);

  // ---------------------------------------------------------------- draft
  const draftTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const draftPending = useRef<string | null>(null);
  const saveDraft = useCallback(
    (draft: string) => {
      draftPending.current = null;
      // keepalive: the save completes even if the window is closed or reloaded meanwhile.
      fetch(`/api/topics/${topicId}/thread`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draft }), keepalive: true }).catch(() => {});
    },
    [topicId],
  );
  const onDraft = (v: string) => {
    setInput(v);
    draftPending.current = v;
    clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => saveDraft(v), 600);
  };
  useEffect(() => {
    const flush = () => {
      clearTimeout(draftTimer.current);
      if (draftPending.current !== null) saveDraft(draftPending.current);
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [saveDraft]);

  // ---------------------------------------------------------------- resume position
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>("[data-resume]");
    if (!els.length || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(
      (entries) => {
        const seen = entries.filter((e) => e.isIntersecting).map((e) => (e.target as HTMLElement).dataset.resume!);
        if (!seen.length) return;
        clearTimeout(resumeTimer.current);
        resumeTimer.current = setTimeout(() => {
          fetch(`/api/topics/${topicId}/thread`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resumeMessageId: seen[seen.length - 1] }) }).catch(() => {});
        }, 1500);
      },
      { threshold: 0.4 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [chat.length, topicId]);

  // ---------------------------------------------------------------- actions
  const generating = streamingKeys.length > 0 || Boolean(pending) || retrying;
  const answerBusy = chat.some((m) => m.status === "streaming") || Boolean(pending);

  const startLesson = async (regenerate = false) => {
    setErr(null);
    try {
      const r = await api<{ lessonId: string; lesson: Lesson }>(`/api/topics/${topicId}/lesson`, { method: "POST", json: { regenerate } });
      setLesson(r.lesson);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const send = async (opts: { message?: string; action?: string }) => {
    if (answerBusy) return;
    setErr(null);
    const label = opts.action ? ACTIONS.find((a) => a.id === opts.action)?.label ?? opts.action : opts.message!;
    const clientId = newClientId();
    clearTimeout(draftTimer.current);
    draftPending.current = null;
    setInput("");
    setPending({ content: label });
    setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 30);
    try {
      // The same clientId is resent on a network hiccup; the app stores it once.
      let r: { user: Msg; assistant: Msg } | null = null;
      for (let attempt = 0; !r; attempt++) {
        try {
          r = await api<{ user: Msg; assistant: Msg }>(`/api/topics/${topicId}/chat`, { method: "POST", json: { ...opts, socratic, clientId } });
        } catch (e) {
          if (e instanceof ApiError || attempt >= 2) throw e;
          await new Promise((ok) => setTimeout(ok, 800));
        }
      }
      const { user, assistant } = r;
      setChat((c) => [...c.filter((m) => m.id !== user.id && m.id !== assistant.id), user, assistant]);
    } catch (e) {
      setErr((e as Error).message);
      if (opts.message) onDraft(opts.message); // give the text back
    } finally {
      setPending(null);
    }
  };

  const retry = async (kind: "msg" | "lesson", id: string) => {
    setErr(null);
    setRetrying(true); // show "writing" straight away
    try {
      await api(kind === "lesson" ? `/api/lessons/${id}/retry` : `/api/tutor/messages/${id}/retry`, { method: "POST" });
      live.current.delete(`${kind}:${id}`);
      paint();
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRetrying(false);
    }
  };

  const saveToNotes = async (messageId: string) => {
    setSavingId(messageId);
    try {
      const r = await api<{ savedMessageIds: string[]; alreadySaved: boolean }>(`/api/topics/${topicId}/notes`, { method: "POST", json: { messageId } });
      setSaved(new Set(r.savedMessageIds));
      if (r.savedMessageIds.includes(messageId)) {
        flashSaved();
        toast(r.alreadySaved ? "Already in your notes" : "Saved to your notes");
      }
      setNotesTick((t) => t + 1);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSavingId(null);
    }
  };

  const rate = async (genId: string, rating: 1 | -1) => {
    await api(`/api/generations/${genId}`, { method: "PATCH", json: { rating } });
    toast(rating === 1 ? "Thanks — marked as helpful" : "Thanks — we'll use this to improve");
  };

  // ---------------------------------------------------------------- Margin
  const stopped = useMemo(() => {
    const last = [...chat].reverse().find((m) => m.role === "assistant");
    if (last && (last.status === "interrupted" || last.status === "failed")) return { kind: "msg" as const, id: last.id, status: last.status };
    if (lesson && (lesson.status === "interrupted" || lesson.status === "failed")) return { kind: "lesson" as const, id: lesson.id, status: lesson.status };
    return null;
  }, [chat, lesson]);
  const marginState: MarginState = generating ? "studying" : savedFlash ? "saved" : stopped ? "interrupted" : "ready";
  const marginMessage =
    marginState === "studying"
      ? "Your tutor is writing. You can switch screens — it keeps going."
      : marginState === "saved"
        ? "Stored on this computer"
        : marginState === "interrupted"
          ? stopped!.status === "interrupted"
            ? `The ${stopped!.kind === "lesson" ? "lesson" : "answer"} stopped before it finished.`
            : `The ${stopped!.kind === "lesson" ? "lesson" : "answer"} couldn't finish.`
          : !status || aiReady
            ? "Ask a follow-up any time."
            : "The local AI isn't running yet.";

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
  const lessonLive = lesson ? liveView.get(`lesson:${lesson.id}`) : undefined;
  const lessonText = lessonLive?.text ?? lesson?.content ?? "";
  const lessonSources = lessonLive?.sources ?? lesson?.sources ?? [];
  const questions = chat.filter((m) => m.role === "user").length;

  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow={
          <Link href={`/courses/${course.id}`} className="hover:text-text">
            {course.title}
          </Link>
        }
        title={topic.title}
        subtitle={`${course.code ? `${course.code} · ` : ""}Tutor lesson`}
      />

      {status && !aiReady && (
        <InfoNote tone="warning" icon={<PlugZap className="size-4" />} className="mb-5">
          <b>The local AI tutor isn&apos;t available.</b> {status.error ?? `The model "${status.chatModel.name}" isn't installed.`}{" "}
          <Link href="/settings#models" className="underline">
            Set up AI models
          </Link>
          . You can still read your saved lesson and the original slides.
        </InfoNote>
      )}
      <FasterModelOffer />
      {adaptive && mastery.status === "weak" && (
        <InfoNote tone="primary" icon={<Sparkles className="size-4" />} className="mb-5">
          You&apos;ve found this topic tricky, so your tutor will explain it a <b>different way</b> this time. Try <b>Explain simpler</b> or <b>Teach me step by step</b>.
        </InfoNote>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-5">
          <Card className="px-5 py-3.5">
            <MarginStatus
              state={marginState}
              message={marginMessage}
              action={
                marginState === "interrupted" && stopped ? (
                  <Button size="sm" variant="secondary" disabled={!aiReady} onClick={() => retry(stopped.kind, stopped.id)} icon={<RotateCcw className="size-3.5" />}>
                    Retry
                  </Button>
                ) : null
              }
            />
          </Card>

          {/* Lesson */}
          <Card>
            <CardHeader
              title={topic.summary ? topic.title : "Lesson"}
              subtitle={lessonText ? "Built from your course files. Tap a slide chip to see where it came from." : "A structured lesson built from your slides"}
              action={
                lesson?.status === "complete" ? (
                  <Button variant="ghost" size="sm" onClick={() => startLesson(true)} disabled={!aiReady || generating} icon={<RefreshCw className="size-3.5" />}>
                    Regenerate
                  </Button>
                ) : null
              }
            />
            <div className="p-5 pt-4">
              {lessonText ? (
                <>
                  <Markdown text={lessonText} sources={lessonSources} onCite={setPreview} verify={lesson?.status === "complete"} />
                  {lesson?.status === "streaming" && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-primary align-middle" aria-hidden />}
                  {(lesson?.status === "interrupted" || lesson?.status === "failed") && (
                    <StoppedNote status={lesson.status} error={lesson.error} onRetry={() => retry("lesson", lesson.id)} disabled={!aiReady} />
                  )}
                  {lesson?.status === "complete" && <SourceRow text={lessonText} sources={lessonSources} onOpen={setPreview} />}
                </>
              ) : lesson?.status === "streaming" ? (
                <p className="text-sm text-muted">Reading your slides… the first words can take a little while on a laptop.</p>
              ) : (
                <div className="flex flex-col items-start gap-3 rounded-xl bg-surface-2 p-5">
                  <p className="text-sm text-text-2">Your tutor will write an introduction, explain the key concepts, give examples, highlight what your lecturer emphasised, and finish with a recap.</p>
                  <Button onClick={() => startLesson(false)} disabled={!aiReady} icon={<Play className="size-4" />}>
                    Teach me this topic
                  </Button>
                  {lesson && lesson.status !== "complete" && <StoppedNote status={lesson.status} error={lesson.error} onRetry={() => retry("lesson", lesson.id)} disabled={!aiReady} />}
                </div>
              )}
            </div>
          </Card>

          {lesson?.status === "complete" && <KnowledgeChecks key={lesson.id} topicId={topicId} initial={lesson.checks} aiReady={aiReady} onComplete={() => setChecksDone(true)} />}

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
                      if (!confirm("Clear this conversation? Notes you saved stay in your notes.")) return;
                      await api(`/api/topics/${topicId}/chat`, { method: "DELETE" });
                      setChat([]);
                    }}
                    disabled={answerBusy}
                    className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-text disabled:opacity-40"
                    aria-label="Clear conversation"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )
              }
            />
            <div className="space-y-5 p-5 pt-4">
              {chat.map((m) => {
                if (m.role === "user")
                  return (
                    <div key={m.id} id={`msg-${m.id}`} className="flex justify-end">
                      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-on-primary">{m.content}</div>
                    </div>
                  );
                const lv = liveView.get(`msg:${m.id}`);
                const text = lv?.text ?? m.content;
                const sources = lv?.sources ?? m.sources;
                return (
                  <div key={m.id} id={`msg-${m.id}`} data-resume={m.status === "complete" ? m.id : undefined} className="group">
                    {lv?.strategy && (
                      <Badge tone="primary" className="mb-2">
                        <Sparkles className="size-3" /> Trying a different approach: {lv.strategy.replace("-", " ")}
                      </Badge>
                    )}
                    {text ? (
                      <Markdown text={text} sources={sources} onCite={setPreview} verify={m.status === "complete"} />
                    ) : m.status === "streaming" ? (
                      <p className="text-sm text-muted">Thinking…</p>
                    ) : null}
                    {m.status === "streaming" && text && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-primary align-middle" aria-hidden />}
                    {(m.status === "interrupted" || m.status === "failed") && <StoppedNote status={m.status} error={m.error} onRetry={() => retry("msg", m.id)} disabled={!aiReady || answerBusy} />}
                    {m.status === "complete" && (
                      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                        <SourceRow text={text} sources={sources} onOpen={setPreview} inline />
                        {saved.has(m.id) ? (
                          <span className="inline-flex items-center gap-1.5 rounded-lg bg-success-soft px-2.5 py-1 text-xs font-medium text-success">
                            <Check className="size-3.5" aria-hidden /> Saved to notes
                          </span>
                        ) : (
                          <Button size="sm" variant="soft" loading={savingId === m.id} onClick={() => saveToNotes(m.id)} icon={<NotebookPen className="size-3.5" />}>
                            Save to notes
                          </Button>
                        )}
                        {m.generation_id && (
                          <span className="flex gap-0.5 opacity-60 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                            <button onClick={() => rate(m.generation_id!, 1)} className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-success" aria-label="Helpful">
                              <ThumbsUp className="size-3.5" />
                            </button>
                            <button onClick={() => rate(m.generation_id!, -1)} className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-danger" aria-label="Not helpful">
                              <ThumbsDown className="size-3.5" />
                            </button>
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {pending && (
                <div className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-on-primary opacity-70">{pending.content}</div>
                </div>
              )}
              {err && <ErrorNote>{err}</ErrorNote>}
              <div ref={endRef} />

              <div className="flex flex-wrap gap-1.5 pt-1">
                {ACTIONS.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => send({ action: a.id })}
                    disabled={!aiReady || answerBusy}
                    className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text-2 transition-colors hover:border-primary/40 hover:bg-primary-soft hover:text-primary-text disabled:opacity-50"
                  >
                    <a.icon className="size-3.5" aria-hidden /> {a.label}
                  </button>
                ))}
                <button onClick={() => setSlidesOpen(true)} className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text-2 hover:bg-surface-2">
                  <FileText className="size-3.5" aria-hidden /> Show original slides
                </button>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (input.trim()) send({ message: input.trim() });
                }}
              >
                <label htmlFor="ll-followup" className="mb-1.5 block text-[15px] text-text">
                  Your follow-up
                </label>
                <div className="relative">
                  <Textarea
                    id="ll-followup"
                    rows={3}
                    value={input}
                    onChange={(e) => onDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (input.trim()) send({ message: input.trim() });
                      }
                    }}
                    placeholder={socratic ? "Share your thinking — your tutor will guide you…" : "Ask anything about this topic…"}
                    className="resize-y pr-14"
                    aria-describedby="ll-draft-hint"
                  />
                  <Button type="submit" size="sm" className="absolute bottom-2.5 right-2.5 size-9 rounded-xl p-0" disabled={!input.trim() || answerBusy || !aiReady} aria-label="Send">
                    <ArrowUp className="size-4" />
                  </Button>
                </div>
                <p id="ll-draft-hint" className="mt-2 text-[13px] text-muted">
                  Your draft stays here as you move between screens.
                </p>
              </form>
              <QuickRepliesToggle />
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
          <LessonProgress topicId={topicId} title={topic.title} lesson={lesson} questions={questions} checksDone={checksDone} savedCount={saved.size} mastery={mastery} tick={notesTick} />
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
          <p className="text-sm text-muted">This topic isn&apos;t linked to specific slides. Use the source links in the lesson instead.</p>
        )}
      </Modal>
    </div>
  );
}

/** Links to the exact slides/pages an answer cites ("View lecture slide 12"). */
function SourceRow({ text, sources, onOpen, inline }: { text: string; sources: SourceRef[]; onOpen: (s: SourceRef) => void; inline?: boolean }) {
  const list = citedSources(text, sources).slice(0, 4);
  if (!list.length) return null;
  return (
    <div className={cn("flex flex-wrap gap-x-3 gap-y-1 text-[13px]", !inline && "mt-4 border-t border-border pt-3")}>
      {list.map((s) => (
        <a
          key={s.n}
          href={sourceHref(s)}
          onClick={(e) => {
            e.preventDefault();
            onOpen(s);
          }}
          className="text-primary-text underline underline-offset-2 hover:no-underline"
          title={`${s.documentName}${s.sectionTitle ? ` — ${s.sectionTitle}` : ""}`}
        >
          View lecture {shortLabel(s)}
        </a>
      ))}
    </div>
  );
}

function StoppedNote({ status, error, onRetry, disabled }: { status: Status; error: string | null; onRetry: () => void; disabled?: boolean }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-warning/25 bg-warning-soft px-3.5 py-2.5 text-[13px] text-warning" role="status">
      <span className="flex-1">
        {status === "interrupted" ? "LectureLab closed before this finished. What was written so far is saved." : `This couldn't finish${error ? `: ${error}` : "."}`}
      </span>
      <Button size="sm" variant="secondary" onClick={onRetry} disabled={disabled} icon={<RotateCcw className="size-3.5" />}>
        Retry
      </Button>
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
