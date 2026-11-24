"use client";

import { useEffect, useState } from "react";
import { cn } from "./ui";

/**
 * Margin: a folded graph-paper bookmark with dot eyes and a cobalt corner.
 * Its state always mirrors a real app event, and every state is also given as
 * text, so Margin is decoration on top of an accessible status line.
 *
 *  ready        still, with an occasional blink
 *  studying     leans forward while the tutor is writing
 *  saved        raises a small check, only after the app confirmed a save
 *  interrupted  still, next to a short status message and a retry button
 */
export type MarginState = "ready" | "studying" | "saved" | "interrupted";

const PREF = "ll-margin";
const EVENT = "ll-margin-pref";

/** Whether the student has hidden Margin (Settings or the hide button). */
export function useMarginVisible() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const read = () => {
      try {
        setVisible(localStorage.getItem(PREF) !== "off");
      } catch {}
    };
    read();
    window.addEventListener(EVENT, read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener(EVENT, read);
      window.removeEventListener("storage", read);
    };
  }, []);
  const set = (v: boolean) => {
    try {
      localStorage.setItem(PREF, v ? "on" : "off");
    } catch {}
    setVisible(v);
    window.dispatchEvent(new Event(EVENT));
  };
  return [visible, set] as const;
}

export function Margin({ state, size = 40, className }: { state: MarginState; size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 40 48"
      width={size}
      height={(size * 48) / 40}
      className={cn("margin shrink-0 overflow-visible", `margin--${state}`, className)}
      data-state={state}
      aria-hidden
    >
      <defs>
        <pattern id="margin-grid" width="5" height="5" patternUnits="userSpaceOnUse">
          <path d="M5 0H0V5" fill="none" stroke="var(--margin-grid)" strokeWidth="0.6" />
        </pattern>
      </defs>
      <g className="margin__body">
        {/* bookmark: paper with a notch at the bottom, top-right corner folded */}
        <path d="M6 4h20l8 8v32l-14-8-14 8z" fill="var(--margin-paper)" stroke="var(--margin-ink)" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M6 4h20l8 8v32l-14-8-14 8z" fill="url(#margin-grid)" />
        <path d="M26 4v8h8z" fill="var(--primary)" stroke="var(--margin-ink)" strokeWidth="1.6" strokeLinejoin="round" />
        <g className="margin__eyes">
          <circle cx="15" cy="21" r="1.9" fill="var(--margin-ink)" />
          <circle cx="24" cy="21" r="1.9" fill="var(--margin-ink)" />
        </g>
      </g>
      <g className="margin__check">
        <circle cx="34" cy="34" r="6" fill="var(--success)" />
        <path d="m31.2 34.1 2 2 3.8-4" fill="none" stroke="var(--surface)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

const TEXT: Record<MarginState, string> = {
  ready: "Ready",
  studying: "Writing…",
  saved: "Saved",
  interrupted: "Interrupted",
};

/**
 * Margin with its status line. The text is the real status (announced to
 * screen readers); Margin can be hidden without losing any information.
 */
export function MarginStatus({ state, message, action, className }: { state: MarginState; message?: string; action?: React.ReactNode; className?: string }) {
  const [visible, setVisible] = useMarginVisible();
  return (
    <div className={cn("group flex items-center gap-3", className)}>
      {visible && <Margin state={state} size={30} />}
      <div className="min-w-0 text-[13px]" role="status" aria-live="polite">
        <span className={cn("font-semibold", state === "interrupted" ? "text-warning" : state === "saved" ? "text-success" : "text-text")}>{TEXT[state]}</span>
        {message && <span className="text-muted"> · {message}</span>}
      </div>
      {action}
      {visible && (
        <button onClick={() => setVisible(false)} className="ml-auto rounded-md px-1.5 py-0.5 text-[11px] text-muted opacity-0 transition-opacity hover:text-text focus:opacity-100 group-hover:opacity-100">
          Hide Margin
        </button>
      )}
    </div>
  );
}

/** Hold "saved" for a moment after a confirmed save, then return to ready. */
export function useSavedFlash(ms = 2600) {
  const [at, setAt] = useState(0);
  useEffect(() => {
    if (!at) return;
    const t = setTimeout(() => setAt(0), ms);
    return () => clearTimeout(t);
  }, [at, ms]);
  return [Boolean(at), () => setAt(Date.now())] as const;
}
