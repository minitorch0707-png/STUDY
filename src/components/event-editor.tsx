"use client";

import { useState } from "react";
import { Button, Field, Input, Select } from "./ui";
import { api } from "@/lib/client";

export interface CalEvent {
  id: string;
  title: string;
  kind: string;
  date: string;
  weight: number | null;
  confirmed: number;
  source_text: string | null;
  source_document: string | null;
}

export function EventEditor({ courseId, onDone, initial }: { courseId: string; onDone: () => void; initial?: CalEvent }) {
  const [v, setV] = useState({ title: initial?.title ?? "", kind: initial?.kind ?? "exam", date: initial?.date ?? "", weight: initial?.weight?.toString() ?? "" });
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          const json = { title: v.title, kind: v.kind, date: v.date, weight: v.weight ? Number(v.weight) : null };
          if (initial) await api(`/api/calendar/${initial.id}`, { method: "PATCH", json: { ...json, confirmed: true } });
          else await api("/api/calendar", { method: "POST", json: { ...json, courseId } });
          onDone();
        } catch (e) {
          setErr((e as Error).message);
        }
      }}
    >
      <Field label="Title" htmlFor="ev-title">
        <Input id="ev-title" required value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} placeholder="Midterm exam" />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Type" htmlFor="ev-kind">
          <Select id="ev-kind" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}>
            <option value="exam">Exam</option>
            <option value="assignment">Assignment</option>
            <option value="reading">Reading</option>
            <option value="other">Other</option>
          </Select>
        </Field>
        <Field label="Date" htmlFor="ev-date">
          <Input id="ev-date" type="date" required value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} />
        </Field>
        <Field label="Weight %" htmlFor="ev-w">
          <Input id="ev-w" type="number" min={0} max={100} value={v.weight} onChange={(e) => setV({ ...v, weight: e.target.value })} placeholder="—" />
        </Field>
      </div>
      {err && <p className="text-sm text-danger">{err}</p>}
      <div className="flex justify-end">
        <Button type="submit">{initial ? "Save & confirm" : "Add to calendar"}</Button>
      </div>
    </form>
  );
}

