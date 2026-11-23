"use client";

import Link from "next/link";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, ArrowRight, BarChart3, Clock, Flame, Info, Layers, Lightbulb, Target } from "lucide-react";
import { Card, CardHeader, EmptyState, PageHeader, Select, Skeleton } from "@/components/ui";
import { MasteryBadge, MasteryBar, type Mastery } from "@/components/learning";
import { formatDate, useApi } from "@/lib/client";

interface Report {
  scores: { id: string; at: string; pct: number; title: string; course_title: string }[];
  topics: { id: string; title: string; course_id: string; importance: number; mastery: Mastery }[];
  activity: { day: string; minutes: number; reviews: number; accuracy: number | null }[];
  upcomingReviews: { day: string; n: number }[];
  flashcards: { total: number; mastered: number; unseen: number; accuracy30d: number | null; reviews30d: number };
  recommendations: { id: string; title: string; reason: string; href: string }[];
  streak: number;
}

function Stat({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint?: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-xs text-muted">
        {icon} {label}
      </div>
      <div className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      {hint && <div className="text-[11px] text-muted">{hint}</div>}
    </Card>
  );
}

const tooltipStyle = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12, color: "var(--text)" };

export default function ProgressPage() {
  const { data: courses } = useApi<{ id: string; title: string }[]>("/api/courses");
  const [course, setCourse] = useState("");
  const { data, loading } = useApi<Report>(`/api/progress${course ? `?course=${course}` : ""}`);

  const avg = data?.scores.length ? Math.round(data.scores.slice(-5).reduce((s, x) => s + x.pct, 0) / Math.min(5, data.scores.length)) : null;
  const minutes30 = data?.activity.reduce((s, a) => s + a.minutes, 0) ?? 0;
  const studied = data?.topics.filter((t) => t.mastery.attempts > 0) ?? [];
  const sortedTopics = [...(data?.topics ?? [])].sort((a, b) => (a.mastery.attempts === 0 ? 1 : 0) - (b.mastery.attempts === 0 ? 1 : 0) || a.mastery.mastery - b.mastery.mastery);
  const hasAny = data && (data.scores.length || data.flashcards.reviews30d || studied.length);

  return (
    <div className="animate-rise">
      <PageHeader
        title="Progress"
        subtitle="Everything here comes from your real answers — nothing is estimated by AI."
        actions={
          <Select value={course} onChange={(e) => setCourse(e.target.value)} className="w-56" aria-label="Filter by course">
            <option value="">All courses</option>
            {courses?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </Select>
        }
      />
      {loading && !data ? (
        <Skeleton className="h-96" />
      ) : !hasAny ? (
        <Card>
          <EmptyState icon={<BarChart3 className="size-5" />} title="No results yet" body="Take a practice quiz or review some flashcards. Your scores, strengths and weak spots will show up here." />
        </Card>
      ) : (
        data && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat icon={<Target className="size-3.5" />} label="Recent quiz average" value={avg != null ? `${avg}%` : "—"} hint={data.scores.length ? `last ${Math.min(5, data.scores.length)} quizzes` : "no quizzes yet"} />
              <Stat icon={<Layers className="size-3.5" />} label="Flashcard accuracy" value={data.flashcards.accuracy30d != null ? `${Math.round(data.flashcards.accuracy30d * 100)}%` : "—"} hint={`${data.flashcards.reviews30d} reviews · 30 days`} />
              <Stat icon={<Clock className="size-3.5" />} label="Measured study time" value={`${Math.floor(minutes30 / 60)}h ${minutes30 % 60}m`} hint="last 30 days" />
              <Stat icon={<Flame className="size-3.5" />} label="Study streak" value={`${data.streak} day${data.streak === 1 ? "" : "s"}`} />
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <Card>
                <CardHeader title="Quiz & exam scores" icon={<Activity className="size-4" />} />
                <div className="h-60 p-4">
                  {data.scores.length ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={data.scores.map((s) => ({ ...s, label: formatDate(s.at) }))} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                        <CartesianGrid stroke="var(--border)" vertical={false} />
                        <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} />
                        <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v}%`, "Score"]} labelFormatter={(_, p) => (p?.[0]?.payload as { title?: string })?.title ?? ""} />
                        <Line type="monotone" dataKey="pct" stroke="var(--primary)" strokeWidth={2.5} dot={{ r: 3.5, fill: "var(--primary)" }} activeDot={{ r: 5 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="grid h-full place-items-center text-sm text-muted">Take a quiz to see your scores over time.</p>
                  )}
                </div>
              </Card>
              <Card>
                <CardHeader title="Daily activity" subtitle="Flashcard reviews · last 30 days" icon={<BarChart3 className="size-4" />} />
                <div className="h-60 p-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.activity.map((a) => ({ ...a, label: formatDate(a.day) }))} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                      <CartesianGrid stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--muted)" }} axisLine={false} tickLine={false} interval={6} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--surface-2)" }} formatter={(v, n) => [v, n === "reviews" ? "Reviews" : "Minutes"]} />
                      <Bar dataKey="reviews" fill="var(--primary)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </div>

            <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
              <Card>
                <CardHeader title="Strengths & weaknesses by topic" subtitle="Weakest first. Recent answers count more than old ones." icon={<Target className="size-4" />} />
                <ul className="divide-y divide-border p-2">
                  {sortedTopics.slice(0, 25).map((t) => (
                    <li key={t.id} className="flex items-center gap-4 px-3 py-3">
                      <div className="min-w-0 flex-1">
                        <Link href={`/tutor/${t.id}`} className="block truncate text-sm font-medium hover:text-primary-text">
                          {t.title}
                        </Link>
                        <div className="mt-1.5 max-w-sm">
                          <MasteryBar m={t.mastery} />
                        </div>
                      </div>
                      <div className="text-right">
                        <MasteryBadge m={t.mastery} />
                        <div className="mt-0.5 text-[11px] text-muted">{t.mastery.attempts} answers</div>
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
              <div className="space-y-5">
                <Card>
                  <CardHeader title="Recommended next" icon={<Lightbulb className="size-4" />} />
                  <ul className="p-2">
                    {data.recommendations.map((r) => (
                      <li key={r.id}>
                        <Link href={r.href} className="group flex items-start gap-2 rounded-xl px-3 py-2.5 hover:bg-surface-2">
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium">{r.title}</div>
                            <div className="text-xs text-muted">{r.reason}</div>
                          </div>
                          <ArrowRight className="mt-1 size-3.5 text-muted" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Card>
                <Card>
                  <CardHeader title="Flashcards" icon={<Layers className="size-4" />} />
                  <div className="space-y-2 p-5 pt-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted">Mastered (21+ day interval)</span>
                      <b>
                        {data.flashcards.mastered}/{data.flashcards.total}
                      </b>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">Not yet studied</span>
                      <b>{data.flashcards.unseen}</b>
                    </div>
                    <div className="pt-2 text-xs font-medium text-muted">Reviews due this week</div>
                    {data.upcomingReviews.length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {data.upcomingReviews.map((u) => (
                          <span key={u.day} className="rounded-lg bg-surface-2 px-2 py-1 text-xs">
                            {formatDate(u.day, { weekday: "short" })}: <b>{u.n}</b>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted">None scheduled.</p>
                    )}
                  </div>
                </Card>
                <p className="flex gap-1.5 text-[11px] leading-relaxed text-muted">
                  <Info className="mt-0.5 size-3 shrink-0" /> Study time counts only what can be measured: timed quiz attempts and the time between flashcard reviews (gaps over 2 minutes are ignored).
                </p>
              </div>
            </div>
          </div>
        )
      )}
    </div>
  );
}
