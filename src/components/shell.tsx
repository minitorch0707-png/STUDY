"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, Monitor, Moon, Sparkles, Sun, X } from "lucide-react";
import { cn } from "./ui";
import { openUpgrade, useApi } from "@/lib/client";
import { ActivityEntry } from "./activity";

/** Icons from the hand-authored LectureLab sprite (public/brand/icons.svg). */
export type SpriteIcon = "home" | "courses" | "tutor" | "notes" | "practice" | "cards" | "calendar" | "grades" | "upload" | "settings";
export function Icon({ name, className }: { name: SpriteIcon; className?: string }) {
  return (
    <svg className={cn("size-[18px] shrink-0", className)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinejoin="round" strokeLinecap="round" aria-hidden>
      <use href={`/brand/icons.svg#${name}`} />
    </svg>
  );
}

const NAV_GROUPS: { label: string; items: { href: string; label: string; icon: SpriteIcon }[] }[] = [
  {
    label: "Workspace",
    items: [
      { href: "/", label: "Home", icon: "home" },
      { href: "/courses", label: "My courses", icon: "courses" },
    ],
  },
  {
    label: "Learn",
    items: [
      { href: "/tutor", label: "Tutor", icon: "tutor" },
      { href: "/notes", label: "Notes", icon: "notes" },
    ],
  },
  {
    label: "Practice",
    items: [
      { href: "/exams", label: "Practice exams", icon: "practice" },
      { href: "/flashcards", label: "Flashcards", icon: "cards" },
    ],
  },
  {
    label: "Plan",
    items: [
      { href: "/calendar", label: "Calendar", icon: "calendar" },
      { href: "/grades", label: "Grades", icon: "grades" },
      { href: "/progress", label: "Progress", icon: "grades" },
      { href: "/settings", label: "Settings", icon: "settings" },
    ],
  },
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

export function ThemeToggle({ compact, onNav }: { compact?: boolean; onNav?: boolean }) {
  const [theme, setTheme] = useTheme();
  const opts: { id: Theme; icon: typeof Sun; label: string }[] = [
    { id: "light", icon: Sun, label: "Light" },
    { id: "dark", icon: Moon, label: "Dark" },
    { id: "system", icon: Monitor, label: "System" },
  ];
  return (
    <div className={cn("flex rounded-xl p-1", onNav ? "bg-white/5" : "bg-surface-2")} role="radiogroup" aria-label="Colour theme">
      {opts.map((o) => (
        <button
          key={o.id}
          role="radio"
          aria-checked={theme === o.id}
          title={o.label}
          aria-label={o.label}
          onClick={() => setTheme(o.id)}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition-colors",
            onNav ? (theme === o.id ? "bg-white/15 text-nav-text" : "text-nav-muted hover:text-nav-text") : theme === o.id ? "bg-surface text-text shadow-card" : "text-muted hover:text-text",
            compact ? "px-2" : "px-3",
          )}
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
  const label = !data ? "Checking local AI…" : ok ? "Local AI workspace" : data.reachable ? "AI model not installed" : "Local AI offline";
  return (
    <Link href="/settings#models" className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-xs text-nav-muted transition-colors hover:bg-white/5 hover:text-nav-text" title={ok ? `Model: ${data!.chatModel.name}` : undefined}>
      <span className={cn("inline-block size-2 rounded-full", ok ? "bg-[#5fd39d]" : data ? "bg-[#f2c26b]" : "bg-nav-muted")} aria-hidden />
      <span className="truncate">{label}</span>
      {data && data.queue > 0 && <span className="ml-auto">{data.queue} queued</span>}
    </Link>
  );
}

function ProCard() {
  const { data } = useApi<{ enabled: boolean; pro: boolean; proName: string; price: string }>("/api/license");
  if (!data?.enabled || data.pro) return null;
  return (
    <button onClick={() => openUpgrade()} className="w-full rounded-xl border border-white/10 bg-white/5 p-3 text-left text-nav-text transition-colors hover:bg-white/10">
      <div className="flex items-center gap-1.5 text-sm font-semibold">
        <Sparkles className="size-4" /> {data.proName}
      </div>
      <div className="mt-0.5 text-xs text-nav-muted">Unlimited courses, timed mocks and rubric feedback · {data.price}</div>
    </button>
  );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <nav className="space-y-5" aria-label="Main">
      {NAV_GROUPS.map((g) => (
        <div key={g.label}>
          <div className="mb-1.5 px-3 text-[12px] font-semibold text-nav-muted">{g.label}</div>
          <div className="space-y-0.5">
            {g.items.map((n) => {
              const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-3 py-2 text-[15px] transition-colors",
                    active ? "bg-nav-2 font-medium text-nav-text ring-1 ring-white/5" : "text-nav-text/85 hover:bg-white/5 hover:text-nav-text",
                  )}
                >
                  <Icon name={n.icon} />
                  {n.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5 px-2" aria-label="LectureLab home">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/mark.svg" alt="" className="size-9 rounded-[9px]" />
      <span className="text-[19px] font-bold tracking-tight text-nav-text">LectureLab</span>
    </Link>
  );
}

function SidebarFooter({ mobile }: { mobile?: boolean }) {
  return (
    <div className="space-y-2">
      <ProCard />
      <ActivityEntry />
      <AIStatus />
      <ThemeToggle compact={!mobile} onNav />
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  // Distraction-free screens
  const focus = path.startsWith("/flashcards/review") || path.startsWith("/setup");

  return (
    <div className="flex min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      {!focus && (
        <aside className="sticky top-0 hidden h-screen w-[232px] shrink-0 flex-col bg-nav px-4 py-6 lg:flex print:!hidden">
          <Logo />
          <div className="mt-8 flex-1 overflow-y-auto pr-1">
            <NavLinks />
          </div>
          <SidebarFooter />
        </aside>
      )}

      {!focus && (
        <div className="fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between bg-nav px-4 lg:hidden print:hidden">
          <Logo />
          <button onClick={() => setOpen(true)} className="rounded-lg p-2 text-nav-text hover:bg-white/10" aria-label="Open menu">
            <Menu className="size-5" />
          </button>
        </div>
      )}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 flex-col bg-nav px-4 py-5 shadow-pop">
            <div className="flex items-center justify-between">
              <Logo />
              <button onClick={() => setOpen(false)} className="rounded-lg p-2 text-nav-text hover:bg-white/10" aria-label="Close menu">
                <X className="size-5" />
              </button>
            </div>
            <div className="mt-7 flex-1 overflow-y-auto">
              <NavLinks onNavigate={() => setOpen(false)} />
            </div>
            <SidebarFooter mobile />
          </div>
        </div>
      )}

      <main id="main" className={cn("min-w-0 flex-1 print:pt-0", !focus && "pt-14 lg:pt-0")}>
        <div className={cn("mx-auto w-full", focus ? "max-w-4xl px-4 py-6" : "max-w-[1120px] px-4 py-8 sm:px-8 lg:px-14 lg:py-12")}>{children}</div>
      </main>
    </div>
  );
}
