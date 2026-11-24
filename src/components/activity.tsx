"use client";

import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { Modal } from "./overlay";
import { Select, Spinner, cn } from "./ui";
import { useApi } from "@/lib/client";
import { REFERENCE_MODELS, estimateCloudCost, formatMoney } from "@/lib/pricing";

/**
 * Study activity: how much local AI work LectureLab did. Counts come from the
 * inference runtime; only usage metadata is stored (never prompts, answers,
 * course names or files).
 */

type Range = "today" | "7d" | "30d";
export interface ActivityReport {
  range: Range;
  from: string;
  to: string;
  runs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  tokensProcessed: number | null;
  runsMissingCounts: number;
  countedInput: number;
  countedOutput: number;
  completedReplies: number;
  allLocal: boolean;
  nonLocalRuns: number;
  daily: { day: string; tokens: number | null }[];
  models: { model: string; runs: number; outputTokensPerS: number | null; firstTextMs: number | null }[];
}

const fmt = (n: number | null) => (n === null ? "Unavailable" : n.toLocaleString());
const compact = (n: number) => new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(n);
const RANGES: { id: Range; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
];

function readPref(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writePref(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {}
}

/** Compact sidebar entry, next to the Local AI status. Opens the panel. */
export function ActivityEntry() {
  const [open, setOpen] = useState(false);
  const { data } = useApi<ActivityReport>(open ? null : "/api/activity?range=7d", { poll: 60000 });
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-xs text-nav-muted transition-colors hover:bg-white/5 hover:text-nav-text"
        aria-haspopup="dialog"
      >
        <Activity className="size-3.5" aria-hidden />
        <span>Study activity</span>
        {data && data.tokensProcessed !== null && (
          <span className="ml-auto tabular-nums" aria-label={`${data.tokensProcessed.toLocaleString()} tokens in the last 7 days`}>
            {compact(data.tokensProcessed)}
          </span>
        )}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Study activity">
        <ActivityPanel />
      </Modal>
    </>
  );
}

export function ActivityPanel() {
  const [range, setRange] = useState<Range>("7d");
  const [ref, setRef] = useState<string>("");
  const [details, setDetails] = useState(false);
  useEffect(() => {
    const r = readPref("ll-activity-range");
    if (r === "today" || r === "7d" || r === "30d") setRange(r);
    setRef(readPref("ll-activity-ref") ?? "");
  }, []);
  const { data, error } = useApi<ActivityReport>(`/api/activity?range=${range}`);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-1 text-xs font-medium text-success">
          <span className="size-1.5 rounded-full bg-success" aria-hidden /> Local AI
        </span>
        <div className="flex rounded-xl bg-surface-2 p-1" role="radiogroup" aria-label="Time range">
          {RANGES.map((r) => (
            <button
              key={r.id}
              role="radio"
              aria-checked={range === r.id}
              onClick={() => {
                setRange(r.id);
                writePref("ll-activity-range", r.id);
              }}
              className={cn("rounded-lg px-3 py-1 text-xs font-medium", range === r.id ? "bg-surface text-text shadow-card" : "text-muted hover:text-text")}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}
      {!data && !error && <Spinner />}
      {data && (
        <>
          <div>
            <div className="text-[13px] text-muted">Tokens processed</div>
            <div className="font-display text-[44px] leading-none text-primary-text tabular-nums">{data.tokensProcessed === null ? "Unavailable" : data.tokensProcessed.toLocaleString()}</div>
            {data.runs === 0 && <p className="mt-2 text-sm text-muted">No AI work yet in this period. Ask the tutor something and it will show up here.</p>}
            {data.runsMissingCounts > 0 && (
              <p className="mt-2 text-xs text-muted">
                {data.runsMissingCounts} {data.runsMissingCounts === 1 ? "run" : "runs"} didn&apos;t report token counts, so they aren&apos;t included.
              </p>
            )}
          </div>

          <dl className="grid grid-cols-3 gap-3 text-sm">
            {[
              ["Input", fmt(data.inputTokens)],
              ["Output", fmt(data.outputTokens)],
              ["Tutor replies", data.completedReplies.toLocaleString()],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl border border-border px-3 py-2.5">
                <dt className="text-xs text-muted">{k}</dt>
                <dd className="mt-0.5 font-semibold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>

          {data.daily.length > 1 && <DailyChart daily={data.daily} />}

          <Costs data={data} refId={ref} onRef={(v) => (setRef(v), writePref("ll-activity-ref", v))} />

          <div>
            <button className="text-sm font-medium text-primary-text underline-offset-2 hover:underline" aria-expanded={details} onClick={() => setDetails((d) => !d)}>
              {details ? "Hide details" : "Show details"}
            </button>
            {details && (
              <div className="mt-3 overflow-x-auto">
                {data.models.length === 0 ? (
                  <p className="text-sm text-muted">No runs in this period.</p>
                ) : (
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs text-muted">
                      <tr>
                        <th className="py-1 pr-3 font-medium">Model</th>
                        <th className="py-1 pr-3 font-medium">Runs</th>
                        <th className="py-1 pr-3 font-medium">Speed</th>
                        <th className="py-1 font-medium">First text</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.models.map((m) => (
                        <tr key={m.model} className="border-t border-border">
                          <td className="py-1.5 pr-3 font-mono text-xs">{m.model}</td>
                          <td className="py-1.5 pr-3 tabular-nums">{m.runs}</td>
                          <td className="py-1.5 pr-3 tabular-nums">{m.outputTokensPerS === null ? "Unavailable" : `${m.outputTokensPerS} tokens/s`}</td>
                          <td className="py-1.5 tabular-nums">{m.firstTextMs === null ? "Unavailable" : `${(m.firstTextMs / 1000).toFixed(1)} s`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
          <p className="text-xs leading-relaxed text-muted">Only counts and timings are recorded on this device — never your questions, answers, course names or files.</p>
        </>
      )}
    </div>
  );
}

function DailyChart({ daily }: { daily: ActivityReport["daily"] }) {
  const max = Math.max(1, ...daily.map((d) => d.tokens ?? 0));
  const label = (day: string, long = false) => new Date(day + "T12:00:00").toLocaleDateString(undefined, long ? { weekday: "long", month: "short", day: "numeric" } : daily.length > 7 ? { day: "numeric" } : { weekday: "short" });
  return (
    <figure>
      <figcaption className="mb-2 text-xs text-muted">Tokens per day</figcaption>
      <div className="flex h-28 items-end gap-1" aria-hidden>
        {daily.map((d) => (
          <div key={d.day} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${label(d.day, true)}: ${d.tokens === null ? "unavailable" : d.tokens.toLocaleString()}`}>
            <div className={cn("w-full max-w-7 rounded-t-md", d.tokens ? "bg-primary" : "bg-surface-3")} style={{ height: d.tokens ? `${Math.max(4, (d.tokens / max) * 100)}%` : "3px" }} />
            {(daily.length <= 7 || Number(d.day.slice(8)) % 5 === 0) && <span className="text-[10px] text-muted">{label(d.day)}</span>}
          </div>
        ))}
      </div>
      <ul className="sr-only">
        {daily.map((d) => (
          <li key={d.day}>
            {label(d.day, true)}: {d.tokens === null ? "unavailable" : `${d.tokens.toLocaleString()} tokens`}
          </li>
        ))}
      </ul>
    </figure>
  );
}

function Costs({ data, refId, onRef }: { data: ActivityReport; refId: string; onRef: (v: string) => void }) {
  const est = estimateCloudCost(data.runsMissingCounts === data.runs ? null : data.countedInput, data.runsMissingCounts === data.runs ? null : data.countedOutput, refId || null, data.to);
  return (
    <div className="space-y-3 rounded-xl border border-border p-4">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-text-2">Local inference provider charges</span>
        <span className="font-semibold tabular-nums">{data.allLocal ? "$0.00" : "Not verified"}</span>
      </div>
      {!data.allLocal && <p className="text-xs text-muted">{data.nonLocalRuns} runs used an AI server that isn&apos;t on this computer, so LectureLab can&apos;t confirm what it charged.</p>}
      <div className="border-t border-border pt-3">
        <label htmlFor="ll-ref-model" className="text-[13px] font-medium text-text-2">
          Cloud comparison
        </label>
        <Select id="ll-ref-model" className="mt-1.5" value={refId} onChange={(e) => onRef(e.target.value)}>
          <option value="">Choose a model</option>
          {REFERENCE_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </Select>
        {refId && (
          <div className="mt-3 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-text-2">Estimated cloud API equivalent</span>
              <span className="font-semibold tabular-nums">{est ? formatMoney(est.amount, est.price.currency) : "Estimate unavailable"}</span>
            </div>
            {est && (
              <p className="mt-1.5 text-xs leading-relaxed text-muted">
                {est.price.provider} {est.price.model}: {formatMoney(est.price.inputPerMillion)} per 1M input and {formatMoney(est.price.outputPerMillion)} per 1M output tokens ({est.price.currency}), list price checked {est.price.pricingDate}. Local token counts only approximate a cloud model&apos;s count. Excludes subscriptions, sync and electricity.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
