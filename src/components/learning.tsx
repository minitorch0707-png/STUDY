"use client";

import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FileText, Lightbulb } from "lucide-react";
import { Badge, cn } from "./ui";
import { courseColor } from "@/lib/colors";
import { markUncertain } from "@/lib/learning/citations";

export interface SourceRef {
  n: number;
  chunkId: string;
  documentId: string;
  documentName: string;
  sectionIdx: number;
  sectionLabel: string;
  sectionTitle: string | null;
  excerpt: string;
}

export interface Mastery {
  mastery: number;
  evidence: number;
  attempts: number;
  status: "not_started" | "insufficient" | "weak" | "developing" | "strong";
}

export const sourceHref = (s: { documentId: string; sectionIdx: number }) => `/documents/${s.documentId}?s=${s.sectionIdx}`;

/**
 * Renders AI markdown. [S1]-style citations become chips that open the exact
 * slide/page; "Beyond your materials" paragraphs are visually separated so
 * students always know what came from their course.
 */
export function Markdown({ text, sources = [], onCite, verify }: { text: string; sources?: SourceRef[]; onCite?: (s: SourceRef) => void; verify?: boolean }) {
  const byN = new Map(sources.map((s) => [s.n, s]));
  // Turn [S1], [S1, S2] and [S1][S2] into links the renderer can style.
  // With `verify`, substantial claims that cite nothing get an "unverified" marker.
  const prepared = (verify ? markUncertain(text) : text).replace(/\[(S\d+(?:\s*,\s*S?\d+)*)\]/g, (_, inner: string) =>
    inner
      .split(/\s*,\s*/)
      .map((p) => `[${p.replace(/^S?/, "S")}](#cite-${p.replace(/^S?/, "")})`)
      .join(""),
  );
  return (
    <div className="prose-ll">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a({ href, children }) {
            if (href === "#uncertain")
              return (
                <span className="uncertain ml-1 inline-flex -translate-y-px items-center rounded-md border border-dashed border-warning/60 px-1.5 text-[11px] font-medium text-warning" title="No course source is cited for this — double-check it.">
                  <span aria-hidden>?</span>
                  <span className="sr-only">Unverified: no course source cited</span>
                </span>
              );
            const m = /^#cite-(\d+)$/.exec(href ?? "");
            if (m) {
              const s = byN.get(Number(m[1]));
              if (!s)
                return (
                  <span className="text-xs text-warning line-through decoration-dotted" title="This citation doesn't match any source the tutor was given.">
                    [{children}]<span className="sr-only"> (unverified citation)</span>
                  </span>
                );
              return (
                <button
                  type="button"
                  onClick={() => onCite?.(s)}
                  title={`${s.documentName} · ${s.sectionLabel}${s.sectionTitle ? ` — ${s.sectionTitle}` : ""}`}
                  className="mx-0.5 inline-flex -translate-y-px items-center rounded-md bg-primary-soft px-1.5 py-px align-baseline text-[11px] font-semibold text-primary-text no-underline hover:brightness-95"
                >
                  {s.sectionLabel.replace("Slide ", "Sl. ").replace("Page ", "p. ")}
                </button>
              );
            }
            return (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            );
          },
          p({ children }) {
            const first = Array.isArray(children) ? children[0] : children;
            const isBeyond =
              typeof first === "object" && first && "props" in first && typeof (first as { props: { children?: unknown } }).props.children === "string" && /^Beyond your materials/i.test((first as { props: { children: string } }).props.children);
            if (isBeyond)
              return (
                <p className="beyond">
                  <Lightbulb className="mr-1.5 inline size-4 -translate-y-px text-warning" aria-hidden />
                  {children}
                </p>
              );
            return <p>{children}</p>;
          },
        }}
      >
        {prepared}
      </ReactMarkdown>
    </div>
  );
}

export function SourceList({ sources, onOpen }: { sources: SourceRef[]; onOpen?: (s: SourceRef) => void }) {
  if (!sources.length) return null;
  return (
    <div className="space-y-1.5">
      {sources.map((s) => (
        <Link
          key={s.n}
          href={sourceHref(s)}
          onClick={(e) => {
            if (onOpen) {
              e.preventDefault();
              onOpen(s);
            }
          }}
          className="flex items-start gap-2.5 rounded-xl border border-border px-3 py-2 text-left hover:bg-surface-2 transition-colors"
        >
          <span className="mt-0.5 rounded-md bg-primary-soft px-1.5 text-[11px] font-semibold text-primary-text">S{s.n}</span>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium">
              {s.sectionLabel}
              {s.sectionTitle ? ` — ${s.sectionTitle}` : ""}
            </div>
            <div className="flex items-center gap-1 truncate text-xs text-muted">
              <FileText className="size-3 shrink-0" />
              {s.documentName}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

const STATUS: Record<Mastery["status"], { label: string; tone: "neutral" | "danger" | "warning" | "success" | "primary" }> = {
  not_started: { label: "Not started", tone: "neutral" },
  insufficient: { label: "Too early to tell", tone: "neutral" },
  weak: { label: "Needs work", tone: "danger" },
  developing: { label: "Getting there", tone: "warning" },
  strong: { label: "Strong", tone: "success" },
};

export function MasteryBadge({ m }: { m: Mastery }) {
  const s = STATUS[m.status];
  const showPct = m.status !== "not_started" && m.status !== "insufficient";
  return (
    <Badge tone={s.tone}>
      {s.label}
      {showPct && ` · ${Math.round(m.mastery * 100)}%`}
    </Badge>
  );
}

export function MasteryBar({ m }: { m: Mastery }) {
  const known = m.status !== "not_started" && m.status !== "insufficient";
  const color = m.status === "strong" ? "bg-success" : m.status === "developing" ? "bg-warning" : m.status === "weak" ? "bg-danger" : "bg-border-strong";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3" title={known ? `${Math.round(m.mastery * 100)}% from ${m.attempts} answers` : "Not enough answers yet"}>
      <div className={cn("h-full rounded-full", color)} style={{ width: known ? `${m.mastery * 100}%` : m.attempts ? "8%" : "0%" }} />
    </div>
  );
}

export function CourseDot({ color, className }: { color: string; className?: string }) {
  return <span className={cn("inline-block size-2.5 shrink-0 rounded-full", courseColor(color).dot, className)} aria-hidden />;
}
