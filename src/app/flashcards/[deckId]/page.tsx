"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Check, Pencil, Plus, Sparkles, Trash2, X } from "lucide-react";
import { Badge, Button, ButtonLink, Card, EmptyState, ErrorNote, Field, Skeleton, Textarea } from "@/components/ui";
import { useToast } from "@/components/overlay";
import { api, formatDate, useApi } from "@/lib/client";

interface CardRow {
  id: string;
  front: string;
  back: string;
  state: string;
  interval_days: number;
  due_at: string;
  reps: number;
  lapses: number;
}
interface DeckData {
  deck: { id: string; title: string; topic_id: string | null; course_title: string; card_count: number; status: string } | undefined;
  cards: CardRow[];
}

function CardEditor({ initial, onSave, onCancel }: { initial?: { front: string; back: string }; onSave: (f: string, b: string) => Promise<void>; onCancel?: () => void }) {
  const [front, setFront] = useState(initial?.front ?? "");
  const [back, setBack] = useState(initial?.back ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        await onSave(front, back);
        setBusy(false);
        if (!initial) {
          setFront("");
          setBack("");
        }
      }}
    >
      <Field label="Front (question or term)">
        <Textarea rows={3} required value={front} onChange={(e) => setFront(e.target.value)} />
      </Field>
      <Field label="Back (answer)">
        <Textarea rows={3} required value={back} onChange={(e) => setBack(e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2 sm:col-span-2">
        {onCancel && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} icon={<X className="size-3.5" />}>
            Cancel
          </Button>
        )}
        <Button type="submit" size="sm" loading={busy} icon={initial ? <Check className="size-3.5" /> : <Plus className="size-3.5" />}>
          {initial ? "Save" : "Add card"}
        </Button>
      </div>
    </form>
  );
}

const stateLabel = (c: CardRow) => (c.state === "new" ? "New" : c.state === "review" && c.interval_days >= 21 ? "Mastered" : c.state === "review" ? "Reviewing" : "Learning");

export default function DeckPage() {
  const { deckId } = useParams<{ deckId: string }>();
  const toast = useToast();
  const [editing, setEditing] = useState<string | null>(null);
  const { data, error, reload } = useApi<DeckData>(`/api/decks/${deckId}`, { poll: (d) => (d?.deck?.status === "generating" ? 2000 : false) });
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data?.deck) return <Skeleton className="h-72" />;
  const { deck, cards } = data;

  return (
    <div className="animate-rise">
      <Link href="/flashcards" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-text">
        <ArrowLeft className="size-3.5" /> Flashcards
      </Link>
      <div className="mb-6 mt-1.5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{deck.title}</h1>
          <p className="text-sm text-muted">
            {deck.course_title} · {cards.length} cards
          </p>
        </div>
        <div className="flex gap-2">
          {deck.topic_id && (
            <Button
              variant="secondary"
              loading={deck.status === "generating"}
              onClick={async () => {
                try {
                  await api(`/api/topics/${deck.topic_id}/flashcards`, { method: "POST", json: { count: 8 } });
                  toast("Adding more cards…");
                  reload();
                } catch (e) {
                  toast((e as Error).message, "error");
                }
              }}
              icon={<Sparkles className="size-4" />}
            >
              Generate more
            </Button>
          )}
          {cards.length > 0 && <ButtonLink href={`/flashcards/review?deck=${deck.id}`}>Study deck</ButtonLink>}
        </div>
      </div>

      <Card className="mb-5 p-5">
        <CardEditor
          onSave={async (front, back) => {
            await api(`/api/decks/${deckId}/cards`, { method: "POST", json: { front, back } });
            reload();
          }}
        />
      </Card>

      {!cards.length ? (
        <Card>
          <EmptyState icon={<Plus className="size-5" />} title="This deck is empty" body="Add your first card above." />
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {cards.map((c) => (
              <li key={c.id} className="px-5 py-4">
                {editing === c.id ? (
                  <CardEditor
                    initial={c}
                    onCancel={() => setEditing(null)}
                    onSave={async (front, back) => {
                      await api(`/api/cards/${c.id}`, { method: "PATCH", json: { front, back } });
                      setEditing(null);
                      reload();
                    }}
                  />
                ) : (
                  <div className="group flex gap-4">
                    <div className="grid min-w-0 flex-1 gap-1 sm:grid-cols-2 sm:gap-6">
                      <div className="text-sm font-medium">{c.front}</div>
                      <div className="text-sm text-text-2">{c.back}</div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <Badge tone={stateLabel(c) === "Mastered" ? "success" : c.state === "new" ? "neutral" : "primary"}>{stateLabel(c)}</Badge>
                      {c.state !== "new" && <span className="text-[11px] text-muted">due {formatDate(c.due_at)}</span>}
                      <div className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        <button onClick={() => setEditing(c.id)} className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-text" aria-label="Edit card">
                          <Pencil className="size-3.5" />
                        </button>
                        <button
                          onClick={async () => {
                            await api(`/api/cards/${c.id}`, { method: "DELETE" });
                            reload();
                          }}
                          className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-danger"
                          aria-label="Delete card"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
