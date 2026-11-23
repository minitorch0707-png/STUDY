/** Display helpers for document formats (safe to use in the browser). */

export const isSlides = (ext: string) => ext === "pptx" || ext === "ppt" || ext === "odp";
export const unitName = (ext: string, n = 2) => {
  const u = isSlides(ext) ? "slide" : ext === "pdf" ? "page" : ext === "image" ? "image" : "section";
  return n === 1 ? u : `${u}s`;
};

/** Badge label + colour for a file type. */
export function formatBadge(ext: string, originalName?: string): { label: string; className: string } {
  const label = ext === "image" ? (originalName?.split(".").pop() ?? "img").slice(0, 4) : ext;
  if (ext === "pdf") return { label, className: "bg-red-500/10 text-red-600 dark:text-red-400" };
  if (isSlides(ext)) return { label, className: "bg-orange-500/10 text-orange-600 dark:text-orange-400" };
  if (ext === "docx" || ext === "doc" || ext === "odt" || ext === "rtf") return { label, className: "bg-blue-500/10 text-blue-600 dark:text-blue-400" };
  if (ext === "image") return { label, className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" };
  if (ext === "epub" || ext === "html") return { label, className: "bg-violet-500/10 text-violet-600 dark:text-violet-400" };
  return { label, className: "bg-surface-2 text-muted" };
}
