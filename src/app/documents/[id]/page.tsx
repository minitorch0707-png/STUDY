"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, Download, ExternalLink, ImageIcon, MessageSquareText, PanelRight } from "lucide-react";
import { Badge, Button, Card, ErrorNote, InfoNote, Skeleton, cn } from "@/components/ui";
import { Markdown } from "@/components/learning";
import { useApi } from "@/lib/client";
import { unitName } from "@/lib/formats";

interface Section {
  id: string;
  idx: number;
  label: string;
  title: string | null;
  content: string;
  notes: string | null;
  has_text: number;
  image_count: number;
  image_descriptions: string | null;
}
interface DocData {
  document: { id: string; course_id: string; display_name: string; ext: string; status: string; warnings: string[]; section_count: number };
  sections: Section[];
}

function Viewer() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const target = Number(params.get("s") ?? 0);
  const { data, error } = useApi<DocData>(`/api/documents/${id}`);
  const [active, setActive] = useState(target || 1);
  const [showPdf, setShowPdf] = useState(false);

  useEffect(() => {
    if (!data || !target) return;
    setActive(target);
    setTimeout(() => document.getElementById(`sec-${target}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  }, [data, target]);

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Skeleton className="h-96" />;
  const { document: doc, sections } = data;
  const isPdf = doc.ext === "pdf";
  const fileUrl = `/api/documents/${doc.id}/file`;

  return (
    <div className="animate-rise">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <Link href={`/courses/${doc.course_id}`} className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-text">
            <ArrowLeft className="size-3.5" /> Back to course
          </Link>
          <h1 className="mt-1 truncate text-2xl font-semibold tracking-tight">{doc.display_name}</h1>
          <p className="text-sm text-muted">
            {sections.length} {unitName(doc.ext, sections.length)} · extracted text
          </p>
        </div>
        <div className="flex gap-2">
          {isPdf && (
            <Button variant="secondary" size="sm" onClick={() => setShowPdf(!showPdf)} icon={<PanelRight className="size-3.5" />}>
              {showPdf ? "Hide original" : "Show original"}
            </Button>
          )}
          <a href={fileUrl} target="_blank" rel="noopener" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-[13px] font-medium shadow-card hover:bg-surface-2">
            {isPdf ? <ExternalLink className="size-3.5" /> : <Download className="size-3.5" />} {isPdf ? "Open file" : "Download original"}
          </a>
        </div>
      </div>

      {doc.ext === "image" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={fileUrl} alt={doc.display_name} className="mb-5 max-h-[60vh] w-auto rounded-2xl border border-border bg-white object-contain shadow-card" />
      )}
      {doc.warnings.length > 0 && (
        <InfoNote tone="warning" icon={<AlertTriangle className="size-4" />} className="mb-5">
          <ul className="space-y-0.5">
            {doc.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </InfoNote>
      )}

      <div className={cn("grid gap-5", showPdf ? "lg:grid-cols-2" : "lg:grid-cols-[200px_1fr]")}>
        {!showPdf && (
          <nav className="hidden lg:block" aria-label="Sections">
            <div className="sticky top-6 max-h-[calc(100vh-3rem)] space-y-0.5 overflow-y-auto pr-1">
              {sections.map((s) => (
                <a
                  key={s.id}
                  href={`#sec-${s.idx}`}
                  onClick={() => setActive(s.idx)}
                  className={cn("block truncate rounded-lg px-2.5 py-1.5 text-[13px]", active === s.idx ? "bg-primary-soft font-medium text-primary-text" : "text-muted hover:bg-surface-2 hover:text-text")}
                >
                  <span className="tabular-nums">{s.label.replace(/^(Slide|Page|Section|Part) /, "")}.</span> {s.title ?? (s.has_text ? s.content.slice(0, 40) : "(no text)")}
                </a>
              ))}
            </div>
          </nav>
        )}
        <div className="min-w-0 space-y-4">
          {sections.map((s) => (
            <Card key={s.id} id={`sec-${s.idx}`} className={cn("scroll-mt-6 p-5 transition-shadow", target === s.idx && "ring-2 ring-primary/50")}>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Badge tone={target === s.idx ? "primary" : "neutral"}>{s.label}</Badge>
                {s.title && <h2 className="text-[15px] font-semibold">{s.title}</h2>}
                {isPdf && (
                  <a className="ml-auto text-xs text-muted hover:text-primary-text" href={`${fileUrl}#page=${s.idx}`} target="_blank" rel="noopener">
                    View original page ↗
                  </a>
                )}
              </div>
              {s.has_text ? (
                s.content ? <Markdown text={s.content} /> : <p className="text-sm text-muted">Title only.</p>
              ) : (
                <p className="text-sm italic text-muted">No readable text on this {unitName(doc.ext, 1)} — it may be an image, diagram or scan.</p>
              )}
              {s.notes && (
                <div className="mt-4 rounded-xl bg-surface-2 px-4 py-3 text-sm">
                  <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted">
                    <MessageSquareText className="size-3.5" /> Lecturer&apos;s notes
                  </div>
                  <p className="whitespace-pre-line text-text-2">{s.notes}</p>
                </div>
              )}
              {s.image_count > 0 && (
                <div className="mt-3 flex items-start gap-1.5 text-xs text-muted">
                  <ImageIcon className="mt-0.5 size-3.5 shrink-0" />
                  {s.image_descriptions ? (
                    <span>
                      <b>Image (described by vision model):</b> {s.image_descriptions}
                    </span>
                  ) : (
                    <span>
                      {s.image_count} image{s.image_count > 1 ? "s" : ""} not analysed. Enable a vision model in Settings to describe diagrams.
                    </span>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
        {showPdf && (
          <div className="sticky top-6 hidden h-[calc(100vh-3rem)] overflow-hidden rounded-2xl border border-border lg:block">
            <iframe key={active} title="Original PDF" src={`${fileUrl}#page=${active}`} className="size-full bg-white" />
          </div>
        )}
      </div>
    </div>
  );
}

export default function DocumentPage() {
  return (
    <Suspense>
      <Viewer />
    </Suspense>
  );
}
