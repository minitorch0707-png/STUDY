"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { BookOpen, CalendarClock, FileText, Layers, Loader2, Plus } from "lucide-react";
import { Button, Card, EmptyState, PageHeader, Skeleton } from "@/components/ui";
import { Modal } from "@/components/overlay";
import { CourseForm } from "@/components/course-form";
import { api, formatDate, useApi } from "@/lib/client";
import { courseColor } from "@/lib/colors";

interface CourseSummary {
  id: string;
  title: string;
  code: string | null;
  semester: string | null;
  professor: string | null;
  color: string;
  document_count: number;
  topic_count: number;
  card_count: number;
  due_cards: number;
  processing: number;
  next_exam: { title: string; date: string } | null;
}

function CoursesInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const { data, loading } = useApi<CourseSummary[]>("/api/courses");
  useEffect(() => {
    if (params.get("new")) setOpen(true);
  }, [params]);

  return (
    <div className="animate-rise">
      <PageHeader
        title="My Courses"
        subtitle="Each course holds your lecture slides, readings and syllabus."
        actions={
          <Button onClick={() => setOpen(true)} icon={<Plus className="size-4" />}>
            New course
          </Button>
        }
      />

      {loading && !data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-44" />
          ))}
        </div>
      ) : !data?.length ? (
        <Card>
          <EmptyState
            icon={<BookOpen className="size-5" />}
            title="No courses yet"
            body="Create your first course, then upload your lecture slides, notes and syllabus. LectureLab does the organising."
            action={
              <Button onClick={() => setOpen(true)} icon={<Plus className="size-4" />}>
                Create a course
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((c) => {
            const col = courseColor(c.color);
            return (
              <Link key={c.id} href={`/courses/${c.id}`} className="group">
                <Card className="h-full overflow-hidden transition-all duration-200 group-hover:-translate-y-0.5 group-hover:shadow-pop">
                  <div className={`h-20 bg-gradient-to-br ${col.gradient} relative`}>
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(255,255,255,0.35),transparent_50%)]" />
                    {c.code && <span className="absolute left-4 top-3 rounded-md bg-white/20 px-2 py-0.5 text-xs font-semibold text-white backdrop-blur">{c.code}</span>}
                    {c.processing > 0 && (
                      <span className="absolute right-3 top-3 flex items-center gap-1 rounded-md bg-black/25 px-2 py-0.5 text-[11px] text-white">
                        <Loader2 className="size-3 animate-spin" /> Processing
                      </span>
                    )}
                  </div>
                  <div className="p-4">
                    <h2 className="truncate text-[15px] font-semibold">{c.title}</h2>
                    <p className="truncate text-[13px] text-muted">{[c.professor, c.semester].filter(Boolean).join(" · ") || " "}</p>
                    <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                      <span className="flex items-center gap-1">
                        <FileText className="size-3.5" /> {c.document_count} files
                      </span>
                      <span className="flex items-center gap-1">
                        <BookOpen className="size-3.5" /> {c.topic_count} topics
                      </span>
                      <span className="flex items-center gap-1">
                        <Layers className="size-3.5" /> {c.due_cards > 0 ? <b className="text-text">{c.due_cards} due</b> : `${c.card_count} cards`}
                      </span>
                    </div>
                    {c.next_exam && (
                      <div className="mt-3 flex items-center gap-1.5 rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs">
                        <CalendarClock className="size-3.5 text-danger" />
                        <span className="truncate">
                          {c.next_exam.title} · {formatDate(c.next_exam.date)}
                        </span>
                      </div>
                    )}
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="New course">
        <CourseForm
          submitLabel="Create course"
          onSubmit={async (v) => {
            const c = await api<{ id: string }>("/api/courses", { method: "POST", json: v });
            router.push(`/courses/${c.id}`);
          }}
        />
      </Modal>
    </div>
  );
}

export default function CoursesPage() {
  return (
    <Suspense>
      <CoursesInner />
    </Suspense>
  );
}
