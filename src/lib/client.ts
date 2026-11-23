"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Browser-side helpers: JSON fetch, polling hook, NDJSON stream reader. */

export class ApiError extends Error {
  constructor(message: string, public status: number, public aiUnavailable = false, public needsPro = false) {
    super(message);
  }
}

/** Ask the app to show the "Unlock Pro" dialog (listened to by <UpgradeDialog/>). */
export function openUpgrade(reason?: string) {
  window.dispatchEvent(new CustomEvent("ll-needs-pro", { detail: reason }));
}

export async function api<T = unknown>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(url, {
    ...rest,
    headers: json !== undefined ? { "Content-Type": "application/json", ...(rest.headers ?? {}) } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const d = data as { error?: string; aiUnavailable?: boolean; needsPro?: boolean };
    if (d.needsPro && typeof window !== "undefined") openUpgrade(d.error);
    throw new ApiError(d.error ?? `Request failed (${res.status})`, res.status, Boolean(d.aiUnavailable), Boolean(d.needsPro));
  }
  return data as T;
}

export function useApi<T>(url: string | null, opts: { poll?: number | ((data: T | undefined) => number | false) } = {}) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(url));
  const pollRef = useRef(opts.poll);
  useEffect(() => {
    pollRef.current = opts.poll;
  });
  const dataRef = useRef<T | undefined>(undefined);

  const load = useCallback(async () => {
    if (!url) return;
    try {
      const d = await api<T>(url);
      dataRef.current = d;
      setData(d);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [url]);

  // One polling loop per URL. Any refresh (including a manual reload after an
  // action such as an upload) re-arms polling if there is still work in progress.
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const alive = useRef(true);
  const selfRef = useRef<() => void>(() => {});
  const refresh = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = undefined;
    await load();
    if (!alive.current) return;
    const p = pollRef.current;
    const ms = typeof p === "function" ? p(dataRef.current) : p;
    if (ms) timer.current = setTimeout(() => selfRef.current(), ms);
  }, [load]);

  useEffect(() => {
    selfRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    alive.current = true;
    setLoading(Boolean(url));
    refresh();
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [refresh, url]);

  return { data, error, loading, reload: refresh, setData };
}

/** Read a streaming NDJSON response from our API (lessons, tutor chat, model downloads). */
export async function readStream<E>(res: Response, onEvent: (e: E) => void) {
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError((data as { error?: string }).error ?? `Request failed (${res.status})`, res.status, Boolean((data as { aiUnavailable?: boolean }).aiUnavailable));
  }
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) onEvent(JSON.parse(line) as E);
    }
  }
  if (buf.trim()) onEvent(JSON.parse(buf) as E);
}

export function formatDate(iso: string, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) {
  const d = iso.length === 10 ? new Date(iso + "T12:00:00") : new Date(iso);
  return d.toLocaleDateString(undefined, opts);
}

export function daysUntil(isoDate: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(isoDate + "T00:00:00").getTime() - today.getTime()) / 86_400_000);
}

export function relativeDays(isoDate: string) {
  const n = daysUntil(isoDate);
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  if (n === -1) return "Yesterday";
  return n > 0 ? `In ${n} days` : `${-n} days ago`;
}

export function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return formatDate(iso);
}

export const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}
