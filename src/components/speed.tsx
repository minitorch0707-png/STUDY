"use client";

import { useState } from "react";
import { Zap } from "lucide-react";
import { Button, ProgressBar } from "./ui";
import { api, readStream, useApi } from "@/lib/client";

/** Keep in sync with FAST_CHAT_MODEL / OLD_DEFAULT_CHAT_MODEL in src/lib/settings.ts. */
export const FAST_MODEL = "qwen3:4b-instruct-2507-q4_K_M";
const OLD_DEFAULT = "qwen3:4b";

/**
 * Offered to installs still on the original qwen3:4b, which "thinks" before
 * every answer. One click downloads the faster model and switches to it.
 */
export function FasterModelOffer({ onSwitched }: { onSwitched?: () => void }) {
  const { data, reload } = useApi<{ provider: string; reachable: boolean; chatModel: { name: string } }>("/api/status");
  const [step, setStep] = useState<{ pct: number | null; status: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!data || data.provider !== "ollama" || !data.reachable || data.chatModel.name !== OLD_DEFAULT) return null;

  const go = async () => {
    setError(null);
    setStep({ pct: null, status: "Starting download…" });
    try {
      const res = await fetch("/api/models/pull", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: FAST_MODEL }) });
      await readStream<{ status?: string; total?: number; completed?: number; error?: string }>(res, (ev) => {
        if (ev.error) throw new Error(ev.error);
        setStep({ pct: ev.total ? (ev.completed ?? 0) / ev.total : null, status: ev.status ?? "" });
      });
      await api("/api/settings", { method: "PATCH", json: { chatModel: FAST_MODEL } });
      setStep(null);
      reload();
      onSwitched?.();
    } catch (e) {
      setError((e as Error).message);
      setStep(null);
    }
  };

  return (
    <div className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-primary/20 bg-primary-soft px-4 py-3 text-sm text-primary-text">
      <Zap className="size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <b>Make the tutor faster.</b> Your current model thinks before every answer. The faster version answers straight away (one-time 2.5 GB download, stays on this computer).
        {step && (
          <div className="mt-2">
            <ProgressBar value={step.pct ?? 0} label="Download progress" />
            <div className="mt-1 text-xs">{step.pct !== null ? `${Math.round(step.pct * 100)}%` : step.status}</div>
          </div>
        )}
        {error && <div className="mt-1 text-xs text-danger">{error}</div>}
      </div>
      {!step && (
        <Button size="sm" onClick={go}>
          Download and switch
        </Button>
      )}
    </div>
  );
}

/** "Quick replies" switch: short answers by default; detailed when wanted. */
export function QuickRepliesToggle() {
  const { data, setData } = useApi<{ replyLength?: "quick" | "detailed" }>("/api/settings");
  const quick = (data?.replyLength ?? "quick") === "quick";
  return (
    <label className="flex cursor-pointer items-center gap-2.5 text-[13px] text-text-2">
      <input
        type="checkbox"
        checked={quick}
        disabled={!data}
        onChange={async (e) => {
          const replyLength = e.target.checked ? "quick" : "detailed";
          setData({ ...data, replyLength });
          await api("/api/settings", { method: "PATCH", json: { replyLength } }).catch(() => {});
        }}
        className="size-4 accent-[var(--primary)]"
      />
      <span>
        <b>Quick replies</b> — short answers that arrive fast. Turn off for longer, detailed explanations.
      </span>
    </label>
  );
}
