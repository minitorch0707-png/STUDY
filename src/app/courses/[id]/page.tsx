"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  Check,
  ClipboardCheck,
  Eye,
  FileText,
  Layers,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Replace,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { Badge, Button, ButtonLink, Card, EmptyState, ErrorNote, InfoNote, Input, ProgressBar, Select, Skeleton, Tabs, cn } from "@/components/ui";
import { Modal, useToast } from "@/components/overlay";
import { Uploader } from "@/components/uploader";
import { EventEditor, type CalEvent as Event } from "@/components/event-editor";
import { CourseForm } from "@/components/course-form";
import { MasteryBadge, MasteryBar, type Mastery } from "@/components/learning";
import { api, formatBytes, formatDate, relativeDays, useApi } from "@/lib/client";
import { courseColor } from "@/lib/colors";
import { formatBadge, unitName } from "@/lib/formats";

interface Doc {
  id: string;
  display_name: string;
  original_name: string;
  ext: string;
  size: number;
  kind: string;
  week: number | null;
  lecture_label: string | null;
  status: string;
  status_detail: string | null;
  progress: number;
  section_count: number;
  warnings: string[];
  created_at: string;
}
interface Topic {
  id: string;
  title: string;
  summary: string | null;
  objectives: string[];
  importance: number;
  document_name: string | null;
  week: number | null;
  mastery: Mastery;
}
interface CourseData {
  course: { id: string; title: string; code: string | null; semester: string | null; professor: string | null; description: string | null; color: string };
  documents: Doc[];
  topics: Topic[];
  events: Event[];
  syllabusFormats: string[];
}

const MENU = [
  { id: "open", icon: Eye, label: "Open" },
  { id: "rename", icon: Pencil, label: "Rename" },
  { id: "replace", icon: Replace, label: "Replace file" },
  { id: "reanalyze", icon: RefreshCw, label: "Re-analyse" },
  { id: "delete", icon: Trash2, label: "Delete", danger: true },
] as const;

const KIND_LABEL: Record<string, string> = { lecture: "Lecture", syllabus: "Syllabus", reading: "Reading", notes: "Notes", other: "Other" };
const STATUS_LABEL: Record<string, string> = { queued: "Queued", parsing: "Reading", embedding: "Indexing", analyzing: "Finding topics", ready: "Ready", failed: "Failed" };

function DocRow({ d, onChange }: { d: Doc; onChange: () => void }) {
  const toast = useToast();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(d.display_name);
  const [menu, setMenu] = useState(false);
  const [showWarn, setShowWarn] = useState(false);
  const replaceInput = useRef<HTMLInputElement>(null);
  const busy = !["ready", "failed"].includes(d.status);

  const act = async (id: (typeof MENU)[number]["id"]) => {
    if (id === "open") router.push(`/documents/${d.id}`);
    if (id === "rename") setEditing(true);
    if (id === "replace") replaceInput.current?.click();
    if (id === "reanalyze") {
      await api(`/api/documents/${d.id}/reanalyze`, { method: "POST" });
      toast("Re-analysing with the current AI model…");
      onChange();
    }
    if (id === "delete") {
      if (!confirm(`Delete "${d.display_name}"? Its topics and links to generated material will be removed.`)) return;
      await api(`/api/documents/${d.id}`, { method: "DELETE" });
      toast("File deleted");
      onChange();
    }
  };

  const patch = async (body: Record<string, unknown>) => {
    try {
      await api(`/api/documents/${d.id}`, { method: "PATCH", json: body });
      onChange();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <li className="px-4 py-3.5 sm:px-5">
      <div className="flex items-center gap-3">
        <div className={cn("grid size-10 shrink-0 place-items-center rounded-xl text-[10px] font-bold uppercase", formatBadge(d.ext, d.original_name).className)}>
          {formatBadge(d.ext, d.original_name).label}
        </div>
        <div className="min-w-0 flex-1">
          {editing ? (
            <form
              className="flex gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                await patch({ display_name: name });
                setEditing(false);
              }}
            >
              <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8" autoFocus aria-label="File name" />
              <Button size="sm" type="submit" aria-label="Save name">
                <Check className="size-4" />
              </Button>
              <Button size="sm" variant="ghost" type="button" onClick={() => setEditing(false)} aria-label="Cancel">
                <X className="size-4" />
              </Button>
            </form>
          ) : (
            <Link href={`/documents/${d.id}`} className="block truncate text-sm font-medium hover:text-primary-text">
              {d.display_name}
            </Link>
          )}
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            <span>{formatBytes(d.size)}</span>
            {d.section_count > 0 && <span>· {d.section_count} {unitName(d.ext, d.section_count)}</span>}
            {d.status === "ready" && d.warnings.length > 0 && (
              <button onClick={() => setShowWarn(!showWarn)} className="flex items-center gap-1 text-warning hover:underline">
                <AlertTriangle className="size-3" /> {d.warnings.length} note{d.warnings.length > 1 ? "s" : ""}
              </button>
            )}
          </div>
        </div>

        <div className="hidden items-center gap-2 md:flex">
          <Select value={d.kind} onChange={(e) => patch({ kind: e.target.value })} className="h-8 w-[118px] text-xs" aria-label="Document type">
            {Object.entries(KIND_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          <Input
            type="number"
            min={0}
            max={60}
            defaultValue={d.week ?? ""}
            placeholder="Week"
            aria-label="Week number"
            className="h-8 w-[76px] text-xs"
            onBlur={(e) => {
              const w = e.target.value === "" ? null : Number(e.target.value);
              if (w !== d.week) patch({ week: w });
            }}
          />
        </div>

        <div className="w-auto text-right sm:w-28">
          {busy ? (
            <div className="space-y-1">
              <div className="flex items-center justify-end gap-1.5 text-xs text-primary-text">
                <Loader2 className="size-3 animate-spin" /> {STATUS_LABEL[d.status]}
              </div>
              <ProgressBar value={d.progress} label="Processing" />
            </div>
          ) : d.status === "failed" ? (
            <Badge tone="danger">Failed</Badge>
          ) : (
            <Badge tone="success">Ready</Badge>
          )}
        </div>

        <div className="relative">
          <Button variant="ghost" size="sm" onClick={() => setMenu(!menu)} aria-label="File actions" aria-expanded={menu}>
            <MoreHorizontal className="size-4" />
          </Button>
          {menu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
              <div className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-pop animate-rise" role="menu">
                {MENU.map((a) => (
                  <button
                    key={a.id}
                    role="menuitem"
                    onClick={() => {
                      setMenu(false);
                      act(a.id);
                    }}
                    className={cn("flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-surface-2", "danger" in a && "text-danger")}
                  >
                    <a.icon className="size-4" /> {a.label}
                  </button>
                ))}
              </div>
            </>
          )}
          <input
            ref={replaceInput}
            type="file"
            accept=".pdf,.pptx,.docx,.txt,.md"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const fd = new FormData();
              fd.append("file", f);
              const res = await fetch(`/api/documents/${d.id}`, { method: "PUT", body: fd });
              const data = await res.json();
              if (!data.ok) toast(data.error ?? "Replace failed", "error");
              else toast("File replaced — reprocessing");
              onChange();
            }}
          />
        </div>
      </div>
      {d.status === "failed" && d.status_detail && <p className="mt-2 text-xs text-danger">{d.status_detail}</p>}
      {busy && d.status_detail && <p className="mt-1.5 text-right text-xs text-muted">{d.status_detail}</p>}
      {(showWarn || d.status === "failed") && d.warnings.length > 0 && (
        <ul className="mt-2.5 space-y-1 rounded-xl bg-warning-soft px-3.5 py-2.5 text-xs text-warning">
          {d.warnings.map((w, i) => (
            <li key={i}>• {w}</li>
          ))}
        </ul>
      )}
    </li>
  );
}

function Materials({ data, reload }: { data: CourseData; reload: () => void }) {
  const toast = useToast();
  const grouped = new Map<string, Doc[]>();
  for (const d of data.documents) {
    const key = d.kind === "syllabus" ? "Syllabus & course info" : d.week != null ? `Week ${d.week}` : "Unsorted";
    grouped.set(key, [...(grouped.get(key) ?? []), d]);
  }
  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-5">
        <Uploader
          courseId={data.course.id}
          compact={data.documents.length > 0}
          onUploaded={(r) => {
            const dup = r.filter((x) => x.duplicate).length;
            const ok = r.filter((x) => x.ok && !x.duplicate).length;
            if (ok) toast(`${ok} file${ok > 1 ? "s" : ""} uploaded — processing now`);
            if (dup) toast(`${dup} file${dup > 1 ? "s were" : " was"} already in this course, so it wasn't processed again`);
            reload();
          }}
        />
      </Card>
      {[...grouped.entries()].map(([group, docs]) => (
        <Card key={group}>
          <div className="border-b border-border px-5 py-3 text-[13px] font-semibold text-text-2">{group}</div>
          <ul className="divide-y divide-border">
            {docs.map((d) => (
              <DocRow key={d.id} d={d} onChange={reload} />
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}

function Topics({ data }: { data: CourseData }) {
  if (!data.topics.length) {
    const processing = data.documents.some((d) => !["ready", "failed"].includes(d.status));
    return (
      <Card>
        <EmptyState
          icon={processing ? <Loader2 className="size-5 animate-spin" /> : <BookOpen className="size-5" />}
          title={processing ? "Finding topics…" : "No topics yet"}
          body={processing ? "LectureLab is reading your files. Topics appear here as each file finishes." : "Upload lecture slides or notes, and LectureLab will organise them into topics you can learn and practise."}
        />
      </Card>
    );
  }
  const groups = new Map<string, Topic[]>();
  for (const t of data.topics) {
    const k = t.document_name ? `${t.week != null ? `Week ${t.week} · ` : ""}${t.document_name}` : "Other";
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  return (
    <div className="space-y-4">
      {[...groups.entries()].map(([g, topics]) => (
        <Card key={g}>
          <div className="flex items-center gap-2 border-b border-border px-5 py-3 text-[13px] font-semibold text-text-2">
            <FileText className="size-3.5" /> {g}
          </div>
          <ul className="divide-y divide-border">
            {topics.map((t) => (
              <li key={t.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/tutor/${t.id}`} className="text-sm font-semibold hover:text-primary-text">
                      {t.title}
                    </Link>
                    {t.importance === 3 && <Badge tone="primary">Core</Badge>}
                    <MasteryBadge m={t.mastery} />
                  </div>
                  {t.summary && <p className="mt-1 line-clamp-2 text-[13px] text-muted">{t.summary}</p>}
                  <div className="mt-2 max-w-xs">
                    <MasteryBar m={t.mastery} />
                  </div>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <ButtonLink href={`/tutor/${t.id}`} size="sm" variant="soft" icon={<Sparkles className="size-3.5" />}>
                    Learn
                  </ButtonLink>
                  <ButtonLink href={`/exams/new?course=${data.course.id}&topic=${t.id}`} size="sm" variant="secondary" icon={<ClipboardCheck className="size-3.5" />}>
                    Quiz
                  </ButtonLink>
                  <ButtonLink href={`/flashcards?topic=${t.id}`} size="sm" variant="secondary" icon={<Layers className="size-3.5" />}>
                    Cards
                  </ButtonLink>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}

function Dates({ data, reload }: { data: CourseData; reload: () => void }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Event | null>(null);
  const pending = data.events.filter((e) => !e.confirmed);
  const confirmed = data.events.filter((e) => e.confirmed);
  const confirm = async (id: string) => {
    await api(`/api/calendar/${id}`, { method: "PATCH", json: { confirmed: true } });
    reload();
  };
  const remove = async (id: string) => {
    await api(`/api/calendar/${id}`, { method: "DELETE" });
    reload();
  };
  return (
    <div className="space-y-4">
      {pending.length > 0 && (
        <Card className="border-warning/30">
          <div className="border-b border-border px-5 py-3">
            <div className="text-sm font-semibold">Found in your syllabus — please check</div>
            <p className="text-xs text-muted">These were detected automatically. Confirm the ones that are right before they&apos;re used for planning.</p>
          </div>
          <ul className="divide-y divide-border">
            {pending.map((e) => (
              <li key={e.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {e.title} <Badge tone={e.kind === "exam" ? "danger" : "neutral"}>{e.kind}</Badge>
                    {e.weight != null && <Badge>{e.weight}%</Badge>}
                  </div>
                  <div className="text-xs text-muted">
                    {formatDate(e.date, { weekday: "short", year: "numeric", month: "short", day: "numeric" })}
                    {e.source_text && <span className="ml-1 italic">— “{e.source_text.slice(0, 90)}”</span>}
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <Button size="sm" onClick={() => confirm(e.id)} icon={<Check className="size-3.5" />}>
                    Confirm
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setEditing(e)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(e.id)} aria-label="Dismiss">
                    <X className="size-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card>
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="text-sm font-semibold">Exams & deadlines</div>
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)} icon={<Plus className="size-3.5" />}>
            Add date
          </Button>
        </div>
        {confirmed.length ? (
          <ul className="divide-y divide-border">
            {confirmed.map((e) => (
              <li key={e.id} className="flex items-center gap-3 px-5 py-3">
                <div className="w-14 text-center">
                  <div className="text-[11px] uppercase text-muted">{formatDate(e.date, { month: "short" })}</div>
                  <div className="text-lg font-semibold leading-none">{formatDate(e.date, { day: "numeric" })}</div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {e.title} <Badge tone={e.kind === "exam" ? "danger" : "neutral"}>{e.kind}</Badge>
                    {e.weight != null && <Badge>{e.weight}%</Badge>}
                  </div>
                  <div className="text-xs text-muted">{relativeDays(e.date)}</div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setEditing(e)} aria-label="Edit">
                  <Pencil className="size-3.5" />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => remove(e.id)} aria-label="Delete">
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-5 py-6 text-sm text-muted">No confirmed dates. Upload your syllabus, or add your exam dates yourself.</p>
        )}
      </Card>
      {data.syllabusFormats.length > 0 && (
        <InfoNote tone="primary" icon={<ClipboardCheck className="size-4" />}>
          Your syllabus mentions these exam formats: <b>{data.syllabusFormats.join(", ").replace(/_/g, " ")}</b>.{" "}
          <Link className="underline" href={`/exams/new?course=${data.course.id}&syllabus=1`}>
            Create a practice exam in that format
          </Link>
        </InfoNote>
      )}
      <Modal open={adding || Boolean(editing)} onClose={() => { setAdding(false); setEditing(null); }} title={editing ? "Edit date" : "Add a date"}>
        <EventEditor
          key={editing?.id ?? "new"}
          courseId={data.course.id}
          initial={editing ?? undefined}
          onDone={() => {
            setAdding(false);
            setEditing(null);
            reload();
          }}
        />
      </Modal>
    </div>
  );
}

export default function CoursePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState<"materials" | "topics" | "dates">("materials");
  const [editing, setEditing] = useState(false);
  const { data, error, reload } = useApi<CourseData>(`/api/courses/${id}`, {
    poll: (d) => (d?.documents.some((x) => !["ready", "failed"].includes(x.status)) ? 1500 : false),
  });

  // Show a "ready" banner when files finish processing while the student watches.
  const wasProcessing = useRef(false);
  const [justFinished, setJustFinished] = useState(false);
  const busyNow = Boolean(data?.documents.some((x) => !["ready", "failed"].includes(x.status)));
  useEffect(() => {
    if (wasProcessing.current && !busyNow) setJustFinished(true);
    wasProcessing.current = busyNow;
  }, [busyNow]);

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data)
    return (
      <div className="space-y-4">
        <Skeleton className="h-28" />
        <Skeleton className="h-64" />
      </div>
    );
  const col = courseColor(data.course.color);
  const pendingDates = data.events.filter((e) => !e.confirmed).length;

  return (
    <div className="animate-rise">
      <div className={`relative mb-6 overflow-hidden rounded-2xl bg-gradient-to-br ${col.gradient} p-6 text-white shadow-card sm:p-7`}>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_85%_15%,rgba(255,255,255,0.3),transparent_45%)]" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <Link href="/courses" className="text-[13px] text-white/80 hover:text-white">
              My Courses
            </Link>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{data.course.title}</h1>
            <p className="mt-1 text-sm text-white/85">{[data.course.code, data.course.professor, data.course.semester].filter(Boolean).join(" · ")}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)} className="border-white/30 bg-white/15 text-white hover:bg-white/25" icon={<Pencil className="size-3.5" />}>
              Edit
            </Button>
            {data.topics.length > 0 && (
              <ButtonLink href={`/exams/new?course=${id}`} size="sm" variant="secondary" className="border-transparent bg-white text-slate-900 hover:bg-white/90" icon={<ClipboardCheck className="size-3.5" />}>
                Practice exam
              </ButtonLink>
            )}
          </div>
        </div>
      </div>

      {justFinished && data.topics.length > 0 && tab === "materials" && (
        <Card className="mb-5 flex flex-col gap-3 border-success/30 bg-success-soft/50 p-4 animate-rise sm:flex-row sm:items-center">
          <Sparkles className="size-5 shrink-0 text-success" />
          <div className="flex-1 text-sm">
            <b>Your files are ready.</b> LectureLab found {data.topics.length} topic{data.topics.length === 1 ? "" : "s"} to learn.
          </div>
          <Button size="sm" onClick={() => setTab("topics")}>
            See topics
          </Button>
        </Card>
      )}

      <div className="mb-5">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "materials", label: "Materials", count: data.documents.length },
            { id: "topics", label: "Topics", count: data.topics.length },
            { id: "dates", label: pendingDates ? `Dates · ${pendingDates} to check` : "Dates", count: data.events.filter((e) => e.confirmed).length },
          ]}
        />
      </div>

      {tab === "materials" && <Materials data={data} reload={reload} />}
      {tab === "topics" && <Topics data={data} />}
      {tab === "dates" && <Dates data={data} reload={reload} />}

      <Modal open={editing} onClose={() => setEditing(false)} title="Edit course">
        <CourseForm
          initial={data.course}
          submitLabel="Save changes"
          onSubmit={async (v) => {
            await api(`/api/courses/${id}`, { method: "PATCH", json: v });
            setEditing(false);
            reload();
          }}
        />
        <div className="mt-6 border-t border-border pt-4">
          <Button
            variant="ghost"
            className="text-danger"
            icon={<Trash2 className="size-4" />}
            onClick={async () => {
              if (!confirm(`Delete "${data.course.title}" and all its files, quizzes, flashcards and progress? This can't be undone.`)) return;
              await api(`/api/courses/${id}`, { method: "DELETE" });
              toast("Course deleted");
              router.push("/courses");
            }}
          >
            Delete course
          </Button>
        </div>
      </Modal>
    </div>
  );
}
