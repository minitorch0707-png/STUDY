"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, FileText, PartyPopper, RotateCcw, Shuffle } from "lucide-react";
import { Button, ButtonLink, Card, EmptyState, Kbd, ProgressBar, Skeleton, cn } from "@/components/ui";
import { CourseDot } from "@/components/learning";
import { api, useApi } from "@/lib/client";

interface QueueCard {
  id: string;
  front: string;
  back: string;
  state: string;
  deck_title: string;
  course_title: string;
  course_color: string;
  source_label: string | null;
  source_document: string | null;
  source_document_id: string | null;
  source_section_idx: number | null;
  preview: Record<1 | 2 | 3 | 4, string>;
}

const RATINGS = [
  { r: 1 as const, label: "Again", key: "1", cls: "border-danger/30 hover:bg-danger-soft text-danger" },
  { r: 2 as const, label: "Hard", key: "2", cls: "border-warning/30 hover:bg-warning-soft text-warning" },
  { r: 3 as const, label: "Good", key: "3", cls: "border-success/30 hover:bg-success-soft text-success" },
  { r: 4 as const, label: "Easy", key: "4", cls: "border-primary/30 hover:bg-primary-soft text-primary-text" },
];

function shuffle<T>(a: T[]) {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

function Review() {
  const params = useSearchParams();
  const [cram, setCram] = useState(params.get("all") === "1");
  const qs = new URLSearchParams();
  for (const k of ["deck", "course", "topic"]) if (params.get(k)) qs.set(k, params.get(k)!);
  if (cram) qs.set("all", "1");
  const { data, loading } = useApi<QueueCard[]>(`/api/review?${qs}`);

  const [queue, setQueue] = useState<QueueCard[]>([]);
  const [flipped, setFlipped] = useState(false);
  const [stats, setStats] = useState({ done: 0, again: 0, total: 0 });
  const shownAt = useRef(0);

  useEffect(() => {
    if (data) {
      setQueue(data);
      setStats({ done: 0, again: 0, total: data.length });
      setFlipped(false);
    }
  }, [data]);

  const card = queue[0];
  useEffect(() => {
    shownAt.current = Date.now();
  }, [card?.id]);

  const rate = useCallback(
    async (rating: 1 | 2 | 3 | 4) => {
      if (!card || !flipped) return;
      const durationMs = Date.now() - shownAt.current;
      setFlipped(false);
      // "Again" cards come back later in this same session (learning steps).
      setQueue((q) => {
        const rest = q.slice(1);
        if (rating === 1) return [...rest.slice(0, 3), card, ...rest.slice(3)];
        return rest;
      });
      setStats((s) => ({ ...s, done: rating === 1 ? s.done : s.done + 1, again: s.again + (rating === 1 ? 1 : 0) }));
      api(`/api/cards/${card.id}/review`, { method: "POST", json: { rating, durationMs } }).catch(() => {});
    },
    [card, flipped],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea")) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        setFlipped((f) => !f);
      }
      if (["1", "2", "3", "4"].includes(e.key)) rate(Number(e.key) as 1 | 2 | 3 | 4);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rate]);

  const progress = useMemo(() => (stats.total ? stats.done / stats.total : 0), [stats]);

  return (
    <div className="animate-rise">
      <div className="mb-6 flex items-center justify-between gap-3">
        <Link href="/flashcards" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-text">
          <ArrowLeft className="size-3.5" /> Flashcards
        </Link>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setQueue((q) => shuffle(q))} icon={<Shuffle className="size-3.5" />} disabled={queue.length < 2}>
            Shuffle
          </Button>
          <Button variant={cram ? "soft" : "ghost"} size="sm" onClick={() => setCram(!cram)} title="Study every card, not just the ones due">
            {cram ? "Cram: all cards" : "Due cards only"}
          </Button>
        </div>
      </div>

      <ProgressBar value={progress} label="Session progress" />
      <div className="mt-2 flex justify-between text-xs text-muted">
        <span>
          {stats.done} of {stats.total} done
        </span>
        <span>{queue.length} left</span>
      </div>

      {loading && !data ? (
        <Skeleton className="mt-8 h-80" />
      ) : !card ? (
        <Card className="mt-8">
          {stats.total ? (
            <EmptyState
              icon={<PartyPopper className="size-5" />}
              title="Session complete!"
              body={`You reviewed ${stats.total} card${stats.total > 1 ? "s" : ""}${stats.again ? ` and repeated ${stats.again} you found tricky` : ""}. They're scheduled to come back right before you'd forget them.`}
              action={
                <div className="flex gap-2">
                  <ButtonLink href="/flashcards" variant="secondary">
                    Back to decks
                  </ButtonLink>
                  <ButtonLink href="/" >Dashboard</ButtonLink>
                </div>
              }
            />
          ) : (
            <EmptyState
              icon={<RotateCcw className="size-5" />}
              title="Nothing due right now"
              body="You're all caught up. Turn on cram mode to study every card anyway."
              action={<Button onClick={() => setCram(true)}>Cram all cards</Button>}
            />
          )}
        </Card>
      ) : (
        <>
          <div className="flip-scene mt-8">
            <div
              className={cn("flip-card relative h-[22rem] cursor-pointer sm:h-[24rem]", flipped && "is-flipped")}
              onClick={() => setFlipped(!flipped)}
              role="button"
              tabIndex={0}
              aria-label={flipped ? "Card answer. Press space to flip back" : "Card question. Press space to reveal the answer"}
            >
              {[false, true].map((back) => (
                <div key={String(back)} className={cn("flip-face absolute inset-0 flex flex-col rounded-3xl border border-border bg-surface p-7 shadow-pop sm:p-10", back && "flip-back")}>
                  <div className="flex items-center justify-between text-xs text-muted">
                    <span className="flex items-center gap-1.5">
                      <CourseDot color={card.course_color} className="size-2" /> {card.deck_title}
                    </span>
                    <span className="font-medium uppercase tracking-wider">{back ? "Answer" : card.state === "new" ? "New card" : "Question"}</span>
                  </div>
                  <div className="flex flex-1 items-center justify-center overflow-y-auto py-4 text-center">
                    <p className={cn("leading-relaxed", back ? "text-lg sm:text-xl" : "text-xl font-medium sm:text-2xl")}>{back ? card.back : card.front}</p>
                  </div>
                  {back && card.source_document_id ? (
                    <Link
                      href={`/documents/${card.source_document_id}?s=${card.source_section_idx}`}
                      onClick={(e) => e.stopPropagation()}
                      className="mx-auto flex items-center gap-1.5 text-xs text-muted hover:text-primary-text"
                    >
                      <FileText className="size-3.5" /> {card.source_document} · {card.source_label}
                    </Link>
                  ) : (
                    !back && <p className="text-center text-xs text-muted">Click or press Space to reveal</p>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className={cn("mt-6 grid grid-cols-4 gap-2 transition-opacity", flipped ? "opacity-100" : "pointer-events-none opacity-0")} aria-hidden={!flipped}>
            {RATINGS.map((b) => (
              <button key={b.r} onClick={() => rate(b.r)} className={cn("flex flex-col items-center rounded-2xl border bg-surface py-3 font-medium transition-colors", b.cls)}>
                <span className="text-sm">{b.label}</span>
                <span className="mt-0.5 text-[11px] text-muted">{card.preview[b.r]}</span>
              </button>
            ))}
          </div>
          <p className="mt-5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-muted">
            <span>
              <Kbd>Space</Kbd> flip
            </span>
            <span>
              <Kbd>1</Kbd> again <Kbd>2</Kbd> hard <Kbd>3</Kbd> good <Kbd>4</Kbd> easy
            </span>
          </p>
        </>
      )}
    </div>
  );
}

export default function ReviewPage() {
  return (
    <Suspense>
      <Review />
    </Suspense>
  );
}
