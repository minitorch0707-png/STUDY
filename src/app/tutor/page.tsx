"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, BookOpen, Sparkles } from "lucide-react";
import { Badge, ButtonLink, Card, EmptyState, PageHeader, Skeleton, cn } from "@/components/ui";
import { CourseDot, MasteryBadge, MasteryBar, type Mastery } from "@/components/learning";
import { useApi } from "@/lib/client";

interface Course {
  id: string;
  title: string;
  color: string;
  topic_count: number;
}
interface Topic {
  id: string;
  title: string;
  summary: string | null;
  importance: number;
  document_name: string | null;
  week: number | null;
  mastery: Mastery;
}

export default function TutorHome() {
  const { data: courses } = useApi<Course[]>("/api/courses");
  const [courseId, setCourseId] = useState<string | null>(null);
  useEffect(() => {
    if (!courseId && courses?.length) {
      let saved: string | null = null;
      try {
        saved = localStorage.getItem("ll-tutor-course");
      } catch {}
      setCourseId(courses.find((c) => c.id === saved)?.id ?? courses.find((c) => c.topic_count > 0)?.id ?? courses[0].id);
    }
  }, [courses, courseId]);
  const { data } = useApi<{ topics: Topic[] }>(courseId ? `/api/courses/${courseId}` : null);

  const pick = (id: string) => {
    setCourseId(id);
    try {
      localStorage.setItem("ll-tutor-course", id);
    } catch {}
  };

  // Suggest: weakest studied topic, else first core topic not started.
  const suggestion = data?.topics
    ? [...data.topics].filter((t) => t.mastery.status === "weak" || t.mastery.status === "developing").sort((a, b) => a.mastery.mastery - b.mastery.mastery)[0] ??
      data.topics.find((t) => t.mastery.status === "not_started" && t.importance === 3) ??
      data.topics.find((t) => t.mastery.status === "not_started")
    : undefined;

  return (
    <div className="animate-rise">
      <PageHeader title="AI Tutor" subtitle="Pick a topic and your tutor will teach it from your own course materials, with links back to the exact slides." />
      {courses && !courses.length ? (
        <Card>
          <EmptyState icon={<BookOpen className="size-5" />} title="Add a course first" body="Your tutor teaches from the files you upload." action={<ButtonLink href="/courses?new=1">Create a course</ButtonLink>} />
        </Card>
      ) : (
        <>
          <div className="mb-5 flex flex-wrap gap-2">
            {courses?.map((c) => (
              <button
                key={c.id}
                onClick={() => pick(c.id)}
                className={cn("flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-medium transition-colors", courseId === c.id ? "border-primary bg-primary-soft text-primary-text" : "border-border bg-surface hover:bg-surface-2")}
              >
                <CourseDot color={c.color} /> {c.title}
              </button>
            ))}
          </div>
          {suggestion && (
            <Link href={`/tutor/${suggestion.id}`} className="group mb-5 block">
              <Card className="flex items-center gap-4 bg-gradient-to-r from-primary-soft to-surface p-5 transition-shadow group-hover:shadow-pop">
                <div className="grid size-11 place-items-center rounded-2xl bg-primary text-white">
                  <Sparkles className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-primary-text">Suggested next</div>
                  <div className="truncate text-[15px] font-semibold">{suggestion.title}</div>
                  <div className="text-[13px] text-muted">{suggestion.mastery.status === "not_started" ? "You haven't studied this yet." : "This is one of your weaker topics."}</div>
                </div>
                <ArrowRight className="size-5 text-primary-text transition-transform group-hover:translate-x-0.5" />
              </Card>
            </Link>
          )}
          {!data ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-28" />
              ))}
            </div>
          ) : !data.topics.length ? (
            <Card>
              <EmptyState icon={<BookOpen className="size-5" />} title="No topics in this course yet" body="Upload lecture files and LectureLab will organise them into topics." action={<ButtonLink href={`/courses/${courseId}`}>Upload materials</ButtonLink>} />
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {data.topics.map((t) => (
                <Link key={t.id} href={`/tutor/${t.id}`} className="group">
                  <Card className="h-full p-4 transition-all group-hover:-translate-y-0.5 group-hover:shadow-pop">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-semibold leading-snug group-hover:text-primary-text">{t.title}</h3>
                      {t.importance === 3 && <Badge tone="primary">Core</Badge>}
                    </div>
                    <p className="mt-1 line-clamp-2 text-[13px] text-muted">{t.summary || t.document_name}</p>
                    <div className="mt-3 flex items-center gap-3">
                      <MasteryBar m={t.mastery} />
                      <MasteryBadge m={t.mastery} />
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
