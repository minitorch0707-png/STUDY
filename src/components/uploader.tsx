"use client";

import { useRef, useState } from "react";
import { CloudUpload, FileWarning } from "lucide-react";
import { cn, ProgressBar } from "./ui";
import { formatBytes } from "@/lib/client";

const ACCEPT = ".pdf,.pptx,.docx,.txt,.md";
const MAX = 50 * 1024 * 1024;

interface UploadResult {
  ok: boolean;
  error?: string;
  filename?: string;
  duplicate?: boolean;
  document?: { display_name: string };
}

/** Drag-and-drop uploader with real upload progress (via XMLHttpRequest). */
export function Uploader({ courseId, onUploaded, compact }: { courseId: string; onUploaded: (results: UploadResult[]) => void; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [progress, setProgress] = useState<{ pct: number; label: string } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const upload = (files: File[]) => {
    const errs: string[] = [];
    const ok = files.filter((f) => {
      const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
      if (!["pdf", "pptx", "docx", "txt", "md"].includes(ext)) {
        errs.push(`${f.name}: ${ext === "ppt" || ext === "doc" ? "old Office format — re-save as .pptx/.docx" : "unsupported file type"}`);
        return false;
      }
      if (f.size > MAX) {
        errs.push(`${f.name}: larger than 50 MB`);
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
      setErrors((e) => [...e, "Network error during upload"]);
    };
    setProgress({ pct: 0, label: "Starting upload…" });
    xhr.send(fd);
  };

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload course files"
        onClick={() => input.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
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
          "flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed text-center transition-colors",
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
        <p className="mt-1 text-xs text-muted">PDF, PowerPoint (.pptx), Word (.docx), text or markdown · up to 50 MB each</p>
        <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => e.target.files && upload([...e.target.files])} />
      </div>
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
