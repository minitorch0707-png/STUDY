/** Course colours as static Tailwind class strings (so Tailwind can see them). */
export const COURSE_COLOR_CLASSES: Record<string, { dot: string; soft: string; bar: string; gradient: string; ring: string }> = {
  indigo: { dot: "bg-indigo-500", soft: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-300", bar: "bg-indigo-500", gradient: "from-indigo-500 to-violet-500", ring: "ring-indigo-500" },
  violet: { dot: "bg-violet-500", soft: "bg-violet-500/10 text-violet-600 dark:text-violet-300", bar: "bg-violet-500", gradient: "from-violet-500 to-fuchsia-500", ring: "ring-violet-500" },
  rose: { dot: "bg-rose-500", soft: "bg-rose-500/10 text-rose-600 dark:text-rose-300", bar: "bg-rose-500", gradient: "from-rose-500 to-orange-400", ring: "ring-rose-500" },
  amber: { dot: "bg-amber-500", soft: "bg-amber-500/10 text-amber-700 dark:text-amber-300", bar: "bg-amber-500", gradient: "from-amber-400 to-orange-500", ring: "ring-amber-500" },
  emerald: { dot: "bg-emerald-500", soft: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", bar: "bg-emerald-500", gradient: "from-emerald-500 to-teal-500", ring: "ring-emerald-500" },
  sky: { dot: "bg-sky-500", soft: "bg-sky-500/10 text-sky-700 dark:text-sky-300", bar: "bg-sky-500", gradient: "from-sky-500 to-indigo-500", ring: "ring-sky-500" },
  teal: { dot: "bg-teal-500", soft: "bg-teal-500/10 text-teal-700 dark:text-teal-300", bar: "bg-teal-500", gradient: "from-teal-500 to-cyan-500", ring: "ring-teal-500" },
  slate: { dot: "bg-slate-500", soft: "bg-slate-500/10 text-slate-700 dark:text-slate-300", bar: "bg-slate-500", gradient: "from-slate-500 to-slate-700", ring: "ring-slate-500" },
};
export const courseColor = (c: string | null | undefined) => COURSE_COLOR_CLASSES[c ?? "indigo"] ?? COURSE_COLOR_CLASSES.indigo;
export const COLOR_NAMES = Object.keys(COURSE_COLOR_CLASSES);
