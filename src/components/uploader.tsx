"use client";

import { useId, useState } from "react";
import { CloudUpload, FileWarning } from "lucide-react";
import { cn, ProgressBar } from "./ui";
import { formatBytes } from "@/lib/client";

const MAX = 250 * 1024 * 1024;

interface UploadResult {
  ok: boolean;
  error?: string;
  filename?: string;
  duplicate?: boolean;
  document?: { display_name: string };
}

/** Drag-and-drop uploader with real upload progress (via XMLHttpRequest). */
export function Uploader({ courseId, onUploaded, compact }: { courseId: string; onUploaded: (results: UploadResult[]) => void; compact?: boolean }) {
  const inputId = useId();
  const [drag, setDrag] = useState(false);
  const [progress, setProgress] = useState<{ pct: number; label: string } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const upload = (files: File[]) => {
    const errs: string[] = [];
    const ok = files.filter((f) => {
      const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
      if (!["pdf", "pptx", "docx", "txt", "md"].includes(ext)) {
        const hint: Record<string, string> = {
          ppt: "old PowerPoint format — open it in PowerPoint or Keynote and Save As .pptx",
          doc: "old Word format — open it and Save As .docx",
          key: "Keynote file — in Keynote use File → Export To → PowerPoint",
          pages: "Pages file — use File → Export To → Word or PDF",
          gslides: "this is only a Google Slides shortcut — in Google Slides use File → Download → Microsoft PowerPoint (.pptx)",
          gdoc: "this is only a Google Docs shortcut — in Google Docs use File → Download → Microsoft Word (.docx)",
          odp: "OpenDocument file — save it as .pptx or PDF",
          zip: "this is a zip file — unzip it first, then upload the files inside",
        };
        errs.push(`${f.name}: ${hint[ext] ?? "unsupported file type (use PDF, .pptx, .docx, .txt or .md)"}`);
        return false;
      }
      if (f.size > MAX) {
        errs.push(`${f.name}: larger than 250 MB — try exporting it as PDF`);
        return false;
      }
      return true;
    });
    setErrors(errs);
    if (!ok.length) return;
    const fd = new FormData();
    ok.forEach((f) => fd.append("files", f));
    const total = ok.reduce((s, f) => s + f.size, 0);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/courses/${courseId}/documents`);
    xhr.upload.onprogress = (e) => setProgress({ pct: e.loaded / (e.total || total), label: `Uploading ${ok.length} file${ok.length > 1 ? "s" : ""} · ${formatBytes(e.loaded)} of ${formatBytes(e.total || total)}` });
    xhr.onload = () => {
      setProgress(null);
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 400) {
          setErrors((e) => [...e, data.error ?? "Upload failed"]);
          return;
        }
        const results = data.results as UploadResult[];
        setErrors((e) => [...e, ...results.filter((r) => !r.ok).map((r) => r.error ?? "Upload failed")]);
        onUploaded(results);
      } catch {
        setErrors((e) => [...e, "Upload failed"]);
      }
    };
    xhr.onerror = () => {
      setProgress(null);
      setErrors((e) => [...e, "The upload didn't reach LectureLab. Is it still running? Try again, or see Settings → Help."]);
      fetch("/api/diagnostics", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: `Upload network error for ${ok.length} file(s), ${Math.round(total / 1e6)} MB` }) }).catch(() => {});
    };
    setProgress({ pct: 0, label: "Starting upload…" });
    xhr.send(fd);
  };

  return (
    <div>
      {/* A <label> opens the file picker natively — more reliable than scripted clicks (especially in Safari). */}
      <label
        htmlFor={inputId}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          upload([...e.dataTransfer.files]);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed text-center transition-colors focus-within:border-primary",
          compact ? "px-4 py-5" : "px-6 py-10",
          drag ? "border-primary bg-primary-soft" : "border-border-strong hover:border-primary/60 hover:bg-surface-2",
        )}
      >
        <div className={cn("grid place-items-center rounded-2xl bg-primary-soft text-primary-text", compact ? "size-9" : "size-12")}>
          <CloudUpload className={compact ? "size-4" : "size-5"} />
        </div>
        <p className="mt-3 text-sm font-medium">
          {drag ? "Drop to upload" : "Drag files here, or "}
          {!drag && <span className="text-primary-text underline underline-offset-2">browse</span>}
        </p>
        <p className="mt-1 text-xs text-muted">PDF, PowerPoint (.pptx), Word (.docx), text or markdown · up to 250 MB each</p>
      </label>
      {/* No "accept" filter: every file stays selectable, so unsupported ones get a helpful message instead of being greyed out. */}
      <input
        id={inputId}
        type="file"
        multiple
        className="sr-only"
        aria-label="Upload course files"
        onChange={(e) => {
          const files = e.target.files ? [...e.target.files] : [];
          e.target.value = ""; // allow choosing the same file again (e.g. after fixing it)
          if (files.length) upload(files);
        }}
      />
      {progress && (
        <div className="mt-3 space-y-1.5" aria-live="polite">
          <ProgressBar value={progress.pct} label="Upload progress" />
          <p className="text-xs text-muted">{progress.label}</p>
        </div>
      )}
      {errors.length > 0 && (
        <ul className="mt-3 space-y-1">
          {errors.map((e, i) => (
            <li key={i} className="flex items-start gap-2 text-[13px] text-danger">
              <FileWarning className="mt-0.5 size-3.5 shrink-0" /> {e}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
