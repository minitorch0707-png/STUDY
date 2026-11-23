"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { Button, Field, Input, Textarea, cn } from "./ui";
import { COLOR_NAMES, courseColor } from "@/lib/colors";

export interface CourseFields {
  title: string;
  code?: string | null;
  semester?: string | null;
  professor?: string | null;
  description?: string | null;
  color?: string;
}

export function CourseForm({ initial, onSubmit, submitLabel }: { initial?: CourseFields; onSubmit: (v: CourseFields) => Promise<void>; submitLabel: string }) {
  const [v, setV] = useState<CourseFields>(initial ?? { title: "", color: undefined });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof CourseFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await onSubmit(v);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="Course name" htmlFor="c-title">
        <Input id="c-title" required value={v.title} onChange={set("title")} placeholder="e.g. Criminal Law" maxLength={120} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Course code" htmlFor="c-code">
          <Input id="c-code" value={v.code ?? ""} onChange={set("code")} placeholder="LAW 101" maxLength={30} />
        </Field>
        <Field label="Semester" htmlFor="c-sem">
          <Input id="c-sem" value={v.semester ?? ""} onChange={set("semester")} placeholder="Fall 2026" maxLength={40} />
        </Field>
      </div>
      <Field label="Professor" htmlFor="c-prof">
        <Input id="c-prof" value={v.professor ?? ""} onChange={set("professor")} placeholder="Optional" maxLength={80} />
      </Field>
      <Field label="Description" htmlFor="c-desc">
        <Textarea id="c-desc" rows={2} value={v.description ?? ""} onChange={set("description")} placeholder="Optional" maxLength={1000} />
      </Field>
      <Field label="Colour">
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Course colour">
          {COLOR_NAMES.map((c) => (
            <button
              type="button"
              key={c}
              role="radio"
              aria-checked={v.color === c}
              aria-label={c}
              onClick={() => setV({ ...v, color: c })}
              className={cn("grid size-8 place-items-center rounded-full bg-gradient-to-br text-white transition-transform hover:scale-110", courseColor(c).gradient, v.color === c && "ring-2 ring-offset-2 ring-offset-surface " + courseColor(c).ring)}
            >
              {v.color === c && <Check className="size-4" />}
            </button>
          ))}
        </div>
      </Field>
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex justify-end pt-1">
        <Button type="submit" loading={busy}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
