"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BarChart3,
  BookOpen,
  CalendarDays,
  ClipboardCheck,
  GraduationCap,
  Layers,
  LayoutDashboard,
  Menu,
  Monitor,
  Moon,
  Settings,
  Sparkles,
  Sun,
  X,
} from "lucide-react";
import { cn } from "./ui";
import { useApi } from "@/lib/client";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/courses", label: "My Courses", icon: BookOpen },
  { href: "/tutor", label: "AI Tutor", icon: Sparkles },
  { href: "/exams", label: "Practice Exams", icon: ClipboardCheck },
  { href: "/flashcards", label: "Flashcards", icon: Layers },
  { href: "/planner", label: "Study Planner", icon: CalendarDays },
  { href: "/progress", label: "Progress", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
];

type Theme = "light" | "dark" | "system";

export function applyTheme(t: Theme) {
  const dark = t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>("system");
  useEffect(() => {
    try {
      setTheme((localStorage.getItem("ll-theme") as Theme) || "system");
    } catch {}
  }, []);
  const update = (t: Theme) => {
    setTheme(t);
    try {
      localStorage.setItem("ll-theme", t);
    } catch {}
    applyTheme(t);
  };
  return [theme, update] as const;
}

export function ThemeToggle({ compact }: { compact?: boolean }) {
  const [theme, setTheme] = useTheme();
  const opts: { id: Theme; icon: typeof Sun; label: string }[] = [
    { id: "light", icon: Sun, label: "Light" },
    { id: "dark", icon: Moon, label: "Dark" },
    { id: "system", icon: Monitor, label: "System" },
  ];
  return (
    <div className="flex rounded-xl bg-surface-2 p-1" role="radiogroup" aria-label="Colour theme">
      {opts.map((o) => (
        <button
          key={o.id}
          role="radio"
          aria-checked={theme === o.id}
          title={o.label}
          onClick={() => setTheme(o.id)}
          className={cn("flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition-colors", theme === o.id ? "bg-surface text-text shadow-card" : "text-muted hover:text-text", compact ? "px-2" : "px-3")}
        >
          <o.icon className="size-3.5" />
          {!compact && o.label}
        </button>
      ))}
    </div>
  );
}

function AIStatus() {
  const { data } = useApi<{ reachable: boolean; chatModel: { name: string; installed: boolean }; queue: number }>("/api/status", { poll: 20000 });
  const ok = data?.reachable && data.chatModel.installed;
  const label = !data ? "Checking AI…" : ok ? data.chatModel.name : data.reachable ? "Model not installed" : "AI offline";
  return (
    <Link href="/settings#models" className="flex items-center gap-2.5 rounded-xl border border-border bg-surface px-3 py-2.5 text-xs hover:bg-surface-2 transition-colors">
      <span className={cn("relative flex size-2", !data && "opacity-40")}>
        {ok && <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-40" />}
        <span className={cn("relative inline-flex size-2 rounded-full", ok ? "bg-success" : data ? "bg-warning" : "bg-muted")} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-muted">Local AI</div>
        <div className="truncate font-medium text-text">{label}</div>
      </div>
      {data && data.queue > 0 && <span className="text-[11px] text-muted">{data.queue} queued</span>}
    </Link>
  );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <nav className="space-y-0.5" aria-label="Main">
      {NAV.map((n) => {
        const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
        return (
          <Link
            key={n.href}
            href={n.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
              active ? "bg-primary-soft text-primary-text" : "text-text-2 hover:bg-surface-2 hover:text-text",
            )}
          >
            <n.icon className={cn("size-[18px]", active ? "text-primary-text" : "text-muted group-hover:text-text")} />
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5 px-2">
      <div className="grid size-8 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-card">
        <GraduationCap className="size-[18px]" />
      </div>
      <span className="text-[17px] font-semibold tracking-tight">LectureLab</span>
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  // Distraction-free review mode
  const focus = path.startsWith("/flashcards/review");

  return (
    <div className="flex min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      {!focus && (
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-surface/60 px-3 py-5 backdrop-blur lg:flex">
          <Logo />
          <div className="mt-7 flex-1 overflow-y-auto">
            <NavLinks />
          </div>
          <div className="space-y-3">
            <AIStatus />
            <ThemeToggle compact />
          </div>
        </aside>
      )}

      {/* Mobile top bar */}
      {!focus && (
        <div className="fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-surface/85 px-4 backdrop-blur lg:hidden">
          <Logo />
          <button onClick={() => setOpen(true)} className="rounded-lg p-2 hover:bg-surface-2" aria-label="Open menu">
            <Menu className="size-5" />
          </button>
        </div>
      )}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/40 animate-rise" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 flex-col bg-surface px-3 py-5 shadow-pop animate-rise">
            <div className="flex items-center justify-between">
              <Logo />
              <button onClick={() => setOpen(false)} className="rounded-lg p-2 hover:bg-surface-2" aria-label="Close menu">
                <X className="size-5" />
              </button>
            </div>
            <div className="mt-7 flex-1">
              <NavLinks onNavigate={() => setOpen(false)} />
            </div>
            <div className="space-y-3">
              <AIStatus />
              <ThemeToggle />
            </div>
          </div>
        </div>
      )}

      <main id="main" className={cn("min-w-0 flex-1", !focus && "pt-14 lg:pt-0")}>
        <div className={cn("mx-auto w-full", focus ? "max-w-4xl px-4 py-6" : "max-w-6xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10")}>{children}</div>
      </main>
    </div>
  );
}
