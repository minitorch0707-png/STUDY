"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Copy, Download, Loader2, NotebookPen, Pencil, Plus, Printer, RefreshCw, Search, Sparkles, Trash2 } from "lucide-react";
import { Badge, Button, ButtonLink, Card, EmptyState, Field, Input, PageHeader, Select, Skeleton, Textarea, cn } from "@/components/ui";
import { CourseDot, Markdown } from "@/components/learning";
import { Modal, useToast } from "@/components/overlay";
import { api, timeAgo, useApi } from "@/lib/client";

interface NoteRow {
  id: string;
  course_id: string;
  topic_id: string | null;
  title: string;
  content: string;
  kind: "auto" | "manual";
  preview: string;
  updated_at: string;
  course_title: string;
  course_color: string;
  topic_title: string | null;
  updating: boolean;
}

function NoteView({ id, onChanged, onDeleted }: { id: string; onChanged: () => void; onDeleted: () => void }) {
  const toast = useToast();
  const { data: note, setData } = useApi<NoteRow & { synced_until: string | null }>(`/api/notes/${id}`, { poll: (n) => (n?.updating ? 2000 : false) });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: "", content: "" });
  const [saved, setSaved] = useState<"idle" | "saving" | "saved">("idle");
  const [refreshing, setRefreshing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (note && !editing) setDraft({ title: note.title, content: note.content });
  }, [note, editing]);

  const save = (next: { title: string; content: string }) => {
    setDraft(next);
    setSaved("saving");
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const n = await api<NoteRow & { synced_until: string | null }>(`/api/notes/${id}`, { method: "PATCH", json: next });
      setData(n);
      setSaved("saved");
      onChanged();
    }, 700);
  };

  if (!note) return <Skeleton className="h-96" />;
  const download = () => {
    const blob = new Blob([`# ${draft.title}\n\n${draft.content}`], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${draft.title.replace(/[^\w\- ]+/g, "").trim() || "notes"}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Card className="flex min-h-[70vh] flex-col print:border-0 print:shadow-none">
      <div className="flex flex-wrap items-start gap-3 border-b border-border px-5 py-4 print:hidden">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <CourseDot color={note.course_color} className="size-2" /> {note.course_title}
            {note.topic_title && note.topic_id && (
              <Link href={`/tutor/${note.topic_id}`} className="hover:text-primary-text">
                · {note.topic_title}
              </Link>
            )}
            {note.kind === "auto" && (
              <Badge tone="primary">
                <Sparkles className="size-3" /> Updates from your tutor chats
              </Badge>
            )}
          </div>
          <div className="mt-1 text-xs text-muted">
            {note.updating ? (
              <span className="inline-flex items-center gap-1 text-primary-text">
                <Loader2 className="size-3 animate-spin" /> Updating from your conversation…
              </span>
            ) : saved === "saving" ? (
              "Saving…"
            ) : saved === "saved" ? (
              <span className="inline-flex items-center gap-1">
                <Check className="size-3" /> Saved
              </span>
            ) : (
              `Edited ${timeAgo(note.updated_at)}`
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          {note.kind === "auto" && (
            <Button
              variant="ghost"
              size="sm"
              loading={refreshing || note.updating}
              icon={<RefreshCw className="size-3.5" />}
              onClick={async () => {
                setRefreshing(true);
                try {
                  setData(await api(`/api/notes/${id}/refresh`, { method: "POST" }));
                  toast("Notes updated from your conversation");
                  onChanged();
                } catch (e) {
                  toast((e as Error).message, "error");
                } finally {
                  setRefreshing(false);
                }
              }}
            >
              Update
            </Button>
          )}
          <Button variant={editing ? "primary" : "secondary"} size="sm" icon={editing ? <Check className="size-3.5" /> : <Pencil className="size-3.5" />} onClick={() => setEditing(!editing)}>
            {editing ? "Done" : "Edit"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Copy"
            title="Copy"
            onClick={async () => {
              await navigator.clipboard.writeText(`# ${draft.title}\n\n${draft.content}`);
              toast("Notes copied");
            }}
          >
            <Copy className="size-3.5" />
          </Button>
          <Button variant="ghost" size="sm" aria-label="Download" title="Download as a file" onClick={download}>
            <Download className="size-3.5" />
          </Button>
          <Button variant="ghost" size="sm" aria-label="Print" title="Print or save as PDF" onClick={() => window.print()}>
            <Printer className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Delete"
            title="Delete"
            onClick={async () => {
              if (!confirm(`Delete "${note.title}"?`)) return;
              await api(`/api/notes/${id}`, { method: "DELETE" });
              toast("Note deleted");
              onDeleted();
            }}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>
      <div className="flex-1 p-5 sm:p-8">
        {editing ? (
          <div className="space-y-3">
            <Input value={draft.title} onChange={(e) => save({ ...draft, title: e.target.value })} className="h-11 text-lg font-semibold" aria-label="Title" />
            <Textarea
              value={draft.content}
              onChange={(e) => save({ ...draft, content: e.target.value })}
              rows={22}
              className="font-mono text-[13px]"
              placeholder={"Write your notes…\n\n## Headings start with ##\n- Bullet points start with a dash\n**Bold** with two stars"}
              aria-label="Note text"
            />
            <p className="text-xs text-muted">Formatting: <code>## Heading</code>, <code>- bullet</code>, <code>**bold**</code>. Saved automatically.</p>
          </div>
        ) : (
          <article>
            <h1 className="mb-5 text-2xl font-semibold tracking-tight">{draft.title}</h1>
            {draft.content.trim() ? (
              <Markdown text={draft.content} />
            ) : (
              <p className="text-sm text-muted">
                {note.kind === "auto" ? "These notes fill in automatically as you learn this topic with the AI tutor." : "Empty note. Click Edit to start writing."}
              </p>
            )}
          </article>
        )}
      </div>
    </Card>
  );
}

function NewNoteForm({ onDone }: { onDone: (id: string) => void }) {
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
        const n = await api<{ id: string }>("/api/notes", { method: "POST", json: { courseId, title: title || "Untitled note" } });
        onDone(n.id);
      }}
    >
      <Field label="Course" htmlFor="nn-course">
        <Select id="nn-course" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
          {courses?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Title" htmlFor="nn-title">
        <Input id="nn-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Midterm summary" />
      </Field>
      <div className="flex justify-end">
        <Button type="submit" disabled={!courseId}>
          Create note
        </Button>
      </div>
    </form>
  );
}

function NotesInner() {
  const params = useSearchParams();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [course, setCourse] = useState("");
  const [creating, setCreating] = useState(false);
  const selected = params.get("id");
  const qs = new URLSearchParams();
  if (q.trim()) qs.set("q", q.trim());
  if (course) qs.set("course", course);
  const { data: notes, loading, reload } = useApi<NoteRow[]>(`/api/notes?${qs}`, { poll: (d) => (d?.some((n) => n.updating) ? 3000 : false) });
  const { data: courses } = useApi<{ id: string; title: string }[]>("/api/courses");
  const select = (id: string | null) => router.replace(id ? `/notes?id=${id}` : "/notes", { scroll: false });

  useEffect(() => {
    if (!selected && notes?.length && window.matchMedia("(min-width: 1024px)").matches) select(notes[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, selected]);

  return (
    <div className="animate-rise">
      <div className="print:hidden">
        <PageHeader
          title="Notes"
          subtitle="Your study notes. Conversations with the AI tutor are turned into notes automatically."
          actions={
            <Button onClick={() => setCreating(true)} icon={<Plus className="size-4" />} disabled={!courses?.length}>
              New note
            </Button>
          }
        />
      </div>
      {loading && !notes ? (
        <Skeleton className="h-96" />
      ) : !notes?.length && !q && !course ? (
        <Card>
          <EmptyState
            icon={<NotebookPen className="size-5" />}
            title="No notes yet"
            body="Open any topic in the AI Tutor and start learning. LectureLab writes tidy notes from your conversation automatically: key ideas, definitions, examples, and the questions you asked."
            action={<ButtonLink href="/tutor">Go to the AI Tutor</ButtonLink>}
          />
        </Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
          <div className={cn("space-y-3 print:hidden", selected && "hidden lg:block")}>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search notes" className="pl-9" aria-label="Search notes" />
            </div>
            {courses && courses.length > 1 && (
              <Select value={course} onChange={(e) => setCourse(e.target.value)} aria-label="Filter by course">
                <option value="">All courses</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </Select>
            )}
            <ul className="space-y-1.5">
              {notes?.map((n) => (
                <li key={n.id}>
                  <button
                    onClick={() => select(n.id)}
                    className={cn("w-full rounded-xl border px-3.5 py-3 text-left transition-colors", selected === n.id ? "border-primary/40 bg-primary-soft" : "border-border bg-surface hover:bg-surface-2")}
                  >
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{n.title}</span>
                      {n.updating ? <Loader2 className="size-3.5 animate-spin text-primary" /> : n.kind === "auto" && <Sparkles className="size-3.5 text-primary-text" />}
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-xs text-muted">{n.preview || "Empty"}</div>
                    <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted">
                      <CourseDot color={n.course_color} className="size-1.5" /> {n.course_title} · {timeAgo(n.updated_at)}
                    </div>
                  </button>
                </li>
              ))}
              {notes?.length === 0 && <p className="px-1 text-sm text-muted">No notes match.</p>}
            </ul>
          </div>
          <div className={cn(!selected && "hidden lg:block")}>
            {selected ? (
              <>
                <button onClick={() => select(null)} className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted hover:text-text lg:hidden print:hidden">
                  <ArrowLeft className="size-3.5" /> All notes
                </button>
                <NoteView key={selected} id={selected} onChanged={reload} onDeleted={() => { select(null); reload(); }} />
              </>
            ) : (
              <Card className="grid min-h-[50vh] place-items-center text-sm text-muted">Pick a note</Card>
            )}
          </div>
        </div>
      )}
      <Modal open={creating} onClose={() => setCreating(false)} title="New note">
        <NewNoteForm
          onDone={(id) => {
            setCreating(false);
            reload();
            router.replace(`/notes?id=${id}`);
          }}
        />
      </Modal>
    </div>
  );
}

export default function NotesPage() {
  return (
    <Suspense>
      <NotesInner />
    </Suspense>
  );
}
