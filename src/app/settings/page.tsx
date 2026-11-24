"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Cpu, Download, Gauge, HardDrive, KeyRound, Loader2, Palette, RefreshCw, Shield, Trash2, XCircle, MonitorPlay as Youtube } from "lucide-react";
import { Badge, Button, Card, CardHeader, ErrorNote, Field, InfoNote, Input, PageHeader, ProgressBar, Select, Skeleton, cn } from "@/components/ui";
import { ThemeToggle } from "@/components/shell";
import { Margin, useMarginVisible } from "@/components/margin";
import { LicenseForm, useLicense } from "@/components/pro";
import { Copy, LifeBuoy, Sparkles } from "lucide-react";
import Link from "next/link";
import { useToast } from "@/components/overlay";
import { api, formatBytes, readStream, useApi } from "@/lib/client";

interface Settings {
  aiProvider: "ollama" | "openai-compatible";
  ollamaUrl: string;
  openaiBaseUrl: string;
  openaiApiKeySet: boolean;
  chatModel: string;
  embeddingModel: string;
  visionModel: string;
  temperature: number;
  contextWindow: number;
  thinking: boolean;
  youtubeApiKeySet: boolean;
  describeImages: boolean;
  autoNotes: boolean;
}
interface Overview {
  status: { provider: string; reachable: boolean; version?: string; error?: string; chatModel: { name: string; installed: boolean }; embeddingModel: { name: string; installed: boolean }; visionModel: { name: string; installed: boolean } | null };
  installed: { name: string; size: number; details?: { parameter_size?: string; quantization_level?: string; family?: string } }[];
  running: { name: string; size: number; size_vram: number; expires_at: string }[];
  recommended: readonly { name: string; role: string; size: string; ram: string; note: string }[];
}
interface Bench {
  model: string;
  seconds: number;
  tokensPerSecond: number | null;
  cited: boolean;
  sample: string;
}

function StatusRow({ label, ok, detail }: { label: string; ok: boolean | null; detail: string }) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      {ok === null ? <span className="size-4 rounded-full border-2 border-border-strong" /> : ok ? <CheckCircle2 className="size-4 text-success" /> : <XCircle className="size-4 text-danger" />}
      <span className="w-32 shrink-0 text-sm text-muted">{label}</span>
      <span className="min-w-0 truncate text-sm font-medium">{detail}</span>
    </div>
  );
}

function Models({ settings, save }: { settings: Settings; save: (p: Partial<Settings> & Record<string, unknown>) => Promise<void> }) {
  const toast = useToast();
  const { data, loading, reload } = useApi<Overview>("/api/models");
  const [pulling, setPulling] = useState<{ name: string; status: string; pct: number | null } | null>(null);
  const [bench, setBench] = useState<Bench | null>(null);
  const [benchBusy, setBenchBusy] = useState(false);
  const [benchErr, setBenchErr] = useState<string | null>(null);

  const pull = async (name: string) => {
    setPulling({ name, status: "Starting download…", pct: null });
    try {
      const res = await fetch("/api/models/pull", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      await readStream<{ status?: string; total?: number; completed?: number; error?: string }>(res, (ev) => {
        if (ev.error) throw new Error(ev.error);
        setPulling({ name, status: ev.status ?? "", pct: ev.total ? (ev.completed ?? 0) / ev.total : null });
      });
      toast(`${name} installed`);
    } catch (e) {
      toast(`Couldn't install ${name}: ${(e as Error).message}`, "error");
    } finally {
      setPulling(null);
      reload();
    }
  };

  if (loading && !data) return <Skeleton className="h-80" />;
  if (!data) return null;
  const st = data.status;
  const has = (n: string) => data.installed.some((m) => m.name === n || m.name === `${n}:latest`);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Local AI engine"
          subtitle={settings.aiProvider === "ollama" ? "Ollama runs open-weight models privately on your computer — no API costs, nothing leaves your machine." : "Using an OpenAI-compatible server"}
          icon={<Cpu className="size-4" />}
          action={
            <Button variant="ghost" size="sm" onClick={reload} icon={<RefreshCw className="size-3.5" />}>
              Refresh
            </Button>
          }
        />
        <div className="divide-y divide-border px-5 pb-3 pt-2">
          <StatusRow label="Engine" ok={st.reachable} detail={st.reachable ? `${st.provider === "ollama" ? "Ollama" : "Server"} ${st.version ?? ""} — running` : st.error ?? "Not reachable"} />
          <StatusRow label="Chat model" ok={st.reachable ? st.chatModel.installed : null} detail={`${st.chatModel.name}${st.chatModel.installed ? "" : " — not installed"}`} />
          <StatusRow label="Embedding model" ok={st.reachable ? st.embeddingModel.installed : null} detail={`${st.embeddingModel.name}${st.embeddingModel.installed ? "" : " — not installed (keyword search still works)"}`} />
          <StatusRow label="Vision model" ok={st.visionModel ? st.visionModel.installed : null} detail={st.visionModel ? st.visionModel.name : "Off (optional)"} />
        </div>
        {!st.reachable && settings.aiProvider === "ollama" && (
          <div className="px-5 pb-5">
            <InfoNote tone="warning">
              <b>The AI isn&apos;t set up yet.</b> LectureLab can install everything for you in one click (free, runs on this computer).
              <div className="mt-2">
                <Link href="/setup" className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-[13px] font-medium text-white hover:bg-primary-hover">
                  Set up automatically
                </Link>
              </div>
            </InfoNote>
          </div>
        )}
      </Card>

      {data.running.length > 0 && (
        <Card>
          <CardHeader title="Loaded in memory right now" subtitle="Models unload automatically after 15 minutes of no use" icon={<HardDrive className="size-4" />} />
          <ul className="divide-y divide-border px-5 pb-3 pt-2">
            {data.running.map((m) => (
              <li key={m.name} className="flex justify-between py-2.5 text-sm">
                <span className="font-medium">{m.name}</span>
                <span className="text-muted">{formatBytes(m.size_vram || m.size)} of memory</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardHeader title="Recommended for a 16 GB MacBook" subtitle="Download once; stored by Ollama on your disk" icon={<Download className="size-4" />} />
        <ul className="divide-y divide-border px-5 pb-2 pt-1">
          {data.recommended.map((m) => {
            const installed = has(m.name);
            const active = settings.chatModel === m.name || settings.embeddingModel === m.name || settings.visionModel === m.name;
            return (
              <li key={m.name} className="flex flex-col gap-2 py-3.5 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="text-sm font-semibold">{m.name}</code>
                    <Badge tone={m.role === "chat" ? "primary" : m.role === "vision" ? "warning" : "neutral"}>{m.role}</Badge>
                    {active && <Badge tone="success">in use</Badge>}
                  </div>
                  <p className="mt-0.5 text-xs text-muted">
                    {m.note} · {m.size} download · {m.ram}
                  </p>
                  {pulling?.name === m.name && (
                    <div className="mt-2 max-w-sm space-y-1">
                      <ProgressBar value={pulling.pct ?? 0.02} label="Download progress" />
                      <p className="text-[11px] text-muted">
                        {pulling.status}
                        {pulling.pct != null && ` · ${Math.round(pulling.pct * 100)}%`}
                      </p>
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  {installed ? (
                    !active && (
                      <Button
                        size="sm"
                        variant="soft"
                        onClick={() => save(m.role === "chat" ? { chatModel: m.name } : m.role === "embedding" ? { embeddingModel: m.name } : { visionModel: m.name })}
                      >
                        Use as {m.role} model
                      </Button>
                    )
                  ) : (
                    <Button size="sm" variant="secondary" onClick={() => pull(m.name)} disabled={!st.reachable || Boolean(pulling) || settings.aiProvider !== "ollama"} loading={pulling?.name === m.name} icon={<Download className="size-3.5" />}>
                      Install
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      {data.installed.length > 0 && (
        <Card>
          <CardHeader title="Installed models" icon={<HardDrive className="size-4" />} />
          <ul className="divide-y divide-border px-5 pb-2 pt-1">
            {data.installed.map((m) => (
              <li key={m.name} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <code className="text-sm font-medium">{m.name}</code>
                  <div className="text-xs text-muted">
                    {formatBytes(m.size)}
                    {m.details?.parameter_size && ` · ${m.details.parameter_size} parameters`}
                    {m.details?.quantization_level && ` · ${m.details.quantization_level}`}
                  </div>
                </div>
                <Select
                  className="h-8 w-40 text-xs"
                  value=""
                  aria-label={`Use ${m.name} as`}
                  onChange={(e) => e.target.value && save({ [e.target.value]: m.name })}
                >
                  <option value="">Use as…</option>
                  <option value="chatModel">Chat model</option>
                  <option value="embeddingModel">Embedding model</option>
                  <option value="visionModel">Vision model</option>
                </Select>
                <button
                  onClick={async () => {
                    if (!confirm(`Remove ${m.name} from your computer? You can download it again later.`)) return;
                    await api(`/api/models?name=${encodeURIComponent(m.name)}`, { method: "DELETE" });
                    reload();
                  }}
                  className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-danger"
                  aria-label={`Remove ${m.name}`}
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardHeader title="Measure performance" subtitle="A quick, repeatable test of speed and citation-following for the current chat model" icon={<Gauge className="size-4" />} />
        <div className="p-5 pt-3">
          <Button variant="secondary" onClick={async () => { setBenchBusy(true); setBenchErr(null); try { setBench(await api<Bench>("/api/models/benchmark", { method: "POST" })); } catch (e) { setBenchErr((e as Error).message); } finally { setBenchBusy(false); } }} loading={benchBusy} disabled={!st.chatModel.installed}>
            Run benchmark
          </Button>
          {benchErr && <ErrorNote className="mt-3">{benchErr}</ErrorNote>}
          {bench && (
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl bg-surface-2 p-3">
                  <div className="text-xs text-muted">Speed</div>
                  <div className="text-lg font-semibold">{bench.tokensPerSecond ?? "—"} tok/s</div>
                </div>
                <div className="rounded-xl bg-surface-2 p-3">
                  <div className="text-xs text-muted">Total time</div>
                  <div className="text-lg font-semibold">{bench.seconds.toFixed(1)} s</div>
                </div>
                <div className="rounded-xl bg-surface-2 p-3">
                  <div className="text-xs text-muted">Cited source</div>
                  <div className={cn("text-lg font-semibold", bench.cited ? "text-success" : "text-danger")}>{bench.cited ? "Yes" : "No"}</div>
                </div>
              </div>
              <p className="rounded-xl border border-border p-3 text-sm text-text-2">{bench.sample}</p>
              <p className="text-xs text-muted">First run includes loading the model into memory, so run it twice for a fair speed number.</p>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function Advanced({ settings, save }: { settings: Settings; save: (p: Record<string, unknown>) => Promise<void> }) {
  const [v, setV] = useState({ ...settings, openaiApiKey: "" });
  useEffect(() => setV({ ...settings, openaiApiKey: "" }), [settings]);
  return (
    <Card>
      <CardHeader title="Advanced AI settings" subtitle="Sensible defaults are already set — change these only if you need to." icon={<Cpu className="size-4" />} />
      <form
        className="grid gap-4 p-5 pt-4 sm:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          await save({
            aiProvider: v.aiProvider,
            ollamaUrl: v.ollamaUrl,
            openaiBaseUrl: v.openaiBaseUrl,
            openaiApiKey: v.openaiApiKey,
            chatModel: v.chatModel,
            embeddingModel: v.embeddingModel,
            visionModel: v.visionModel,
            temperature: Number(v.temperature),
            contextWindow: Number(v.contextWindow),
            thinking: v.thinking,
            describeImages: v.describeImages,
            autoNotes: v.autoNotes,
          });
        }}
      >
        <Field label="AI engine" htmlFor="s-prov" hint="OpenAI-compatible works with LM Studio, llama.cpp server, vLLM, or a hosted open-weight model service.">
          <Select id="s-prov" value={v.aiProvider} onChange={(e) => setV({ ...v, aiProvider: e.target.value as Settings["aiProvider"] })}>
            <option value="ollama">Ollama (recommended)</option>
            <option value="openai-compatible">OpenAI-compatible server</option>
          </Select>
        </Field>
        {v.aiProvider === "ollama" ? (
          <Field label="Ollama address" htmlFor="s-url">
            <Input id="s-url" value={v.ollamaUrl} onChange={(e) => setV({ ...v, ollamaUrl: e.target.value })} />
          </Field>
        ) : (
          <>
            <Field label="Server base URL" htmlFor="s-base">
              <Input id="s-base" value={v.openaiBaseUrl} onChange={(e) => setV({ ...v, openaiBaseUrl: e.target.value })} placeholder="http://127.0.0.1:1234/v1" />
            </Field>
            <Field label="API key (optional)" htmlFor="s-key" hint={settings.openaiApiKeySet ? "A key is saved. Leave blank to keep it." : "Only needed for hosted services."}>
              <Input id="s-key" type="password" value={v.openaiApiKey} onChange={(e) => setV({ ...v, openaiApiKey: e.target.value })} autoComplete="off" />
            </Field>
          </>
        )}
        <Field label="Chat model" htmlFor="s-chat">
          <Input id="s-chat" value={v.chatModel} onChange={(e) => setV({ ...v, chatModel: e.target.value })} />
        </Field>
        <Field label="Embedding model" htmlFor="s-emb" hint="Changing this re-indexes files when you click Re-analyse.">
          <Input id="s-emb" value={v.embeddingModel} onChange={(e) => setV({ ...v, embeddingModel: e.target.value })} />
        </Field>
        <Field label="Vision model (optional)" htmlFor="s-vis" hint="e.g. gemma3:4b — leave blank to turn off">
          <Input id="s-vis" value={v.visionModel} onChange={(e) => setV({ ...v, visionModel: e.target.value })} />
        </Field>
        <Field label={`Creativity (temperature): ${Number(v.temperature).toFixed(1)}`} htmlFor="s-temp" hint="Lower = more precise and consistent.">
          <input id="s-temp" type="range" min={0} max={1} step={0.1} value={v.temperature} onChange={(e) => setV({ ...v, temperature: Number(e.target.value) })} className="w-full accent-[var(--primary)]" />
        </Field>
        <Field label="Context window (tokens)" htmlFor="s-ctx" hint="8192 fits comfortably in 16 GB. Higher uses more memory.">
          <Select id="s-ctx" value={v.contextWindow} onChange={(e) => setV({ ...v, contextWindow: Number(e.target.value) })}>
            {[4096, 8192, 12288, 16384, 32768].map((n) => (
              <option key={n} value={n}>
                {n.toLocaleString()}
              </option>
            ))}
          </Select>
        </Field>
        <div className="space-y-3 sm:col-span-2">
          <label className="flex items-start gap-2.5 text-sm">
            <input type="checkbox" checked={v.autoNotes} onChange={(e) => setV({ ...v, autoNotes: e.target.checked })} className="mt-0.5 size-4 accent-[var(--primary)]" />
            <span>
              <b>Turn tutor conversations into notes automatically</b> <span className="text-muted">— about a minute after you stop chatting, your topic notes are updated.</span>
            </span>
          </label>
          <label className="flex items-start gap-2.5 text-sm">
            <input type="checkbox" checked={v.thinking} onChange={(e) => setV({ ...v, thinking: e.target.checked })} className="mt-0.5 size-4 accent-[var(--primary)]" />
            <span>
              <b>Thinking mode for tutor answers</b> <span className="text-muted">— Qwen3 reasons before answering. Sometimes better, always slower.</span>
            </span>
          </label>
          <label className="flex items-start gap-2.5 text-sm">
            <input type="checkbox" checked={v.describeImages} onChange={(e) => setV({ ...v, describeImages: e.target.checked })} className="mt-0.5 size-4 accent-[var(--primary)]" />
            <span>
              <b>Describe slide images with the vision model</b> <span className="text-muted">— reads diagrams and charts in PowerPoint and Word files during upload. Slower uploads.</span>
            </span>
          </label>
        </div>
        <div className="flex justify-end sm:col-span-2">
          <Button type="submit">Save settings</Button>
        </div>
      </form>
    </Card>
  );
}

function Integrations({ settings, save }: { settings: Settings; save: (p: Record<string, unknown>) => Promise<void> }) {
  const [key, setKey] = useState("");
  return (
    <Card id="integrations">
      <CardHeader title="YouTube videos" subtitle="Optional — find real educational videos for each topic" icon={<Youtube className="size-4" />} />
      <div className="space-y-3 p-5 pt-4">
        <div className="flex items-center gap-2 text-sm">
          {settings.youtubeApiKeySet ? (
            <>
              <CheckCircle2 className="size-4 text-success" /> API key saved
            </>
          ) : (
            <>
              <KeyRound className="size-4 text-muted" /> No key yet — encyclopedia explainers (Wikipedia) still work without one
            </>
          )}
        </div>
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            await save({ youtubeApiKey: key });
            setKey("");
          }}
        >
          <Input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste YouTube Data API v3 key" autoComplete="off" aria-label="YouTube API key" />
          <Button type="submit" disabled={!key}>
            Save
          </Button>
          {settings.youtubeApiKeySet && (
            <Button type="button" variant="ghost" onClick={() => save({ youtubeApiKey: " " })}>
              Remove
            </Button>
          )}
        </form>
        <details className="text-xs text-muted">
          <summary className="cursor-pointer font-medium text-text-2">How to get a free key (5 minutes)</summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>Go to console.cloud.google.com and sign in with a Google account.</li>
            <li>Create a project (any name), then open “APIs &amp; Services → Library”.</li>
            <li>Search for “YouTube Data API v3” and click Enable.</li>
            <li>Go to “Credentials → Create credentials → API key” and copy it here.</li>
          </ol>
          <p className="mt-2">The free quota allows roughly 90 topic searches per day. Results are cached for a week so repeat visits cost nothing. The key stays on this computer and is never shown in the browser.</p>
        </details>
      </div>
    </Card>
  );
}

function ProSection() {
  const { data, setData } = useLicense();
  if (!data?.enabled) return null;
  return (
    <section id="pro">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-2">
        <Sparkles className="size-4" /> {data.proName}
      </h2>
      <Card className="space-y-4 p-5">
        {!data.pro && (
          <>
            <p className="text-sm text-text-2">
              The free plan includes everything for {data.freeCourseLimit} courses. {data.proName} ({data.price}) adds: {data.features.join(" · ")}.
            </p>
            {data.buyUrl && (
              <a href={data.buyUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-medium text-white hover:bg-primary-hover">
                Get {data.proName} — {data.price}
              </a>
            )}
          </>
        )}
        {data.status === "invalid" && <p className="text-sm text-danger">Your licence is no longer valid (refunded, expired or disabled). Enter a new key below.</p>}
        <LicenseForm info={data} onChange={setData} />
      </Card>
    </section>
  );
}

function HelpSection() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const { data } = useApi<{ logs: { level: string; source: string; message: string; created_at: string }[] }>("/api/diagnostics");
  const problems = data?.logs.filter((l) => l.level !== "info") ?? [];
  return (
    <section id="help">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-2">
        <LifeBuoy className="size-4" /> Help & diagnostics
      </h2>
      <Card className="space-y-3 p-5 text-sm">
        <p className="text-text-2">Something not working? Copy the diagnostics and paste them into a GitHub issue or message. They include your app version, computer type and recent errors, but never your files or keys.</p>
        <Button
          variant="secondary"
          size="sm"
          loading={busy}
          icon={<Copy className="size-3.5" />}
          onClick={async () => {
            setBusy(true);
            try {
              const d = await api("/api/diagnostics");
              await navigator.clipboard.writeText("LectureLab diagnostics\n```json\n" + JSON.stringify(d, null, 2) + "\n```");
              toast("Diagnostics copied — paste them where you're asking for help");
            } catch (e) {
              toast(`Couldn't copy: ${(e as Error).message}`, "error");
            } finally {
              setBusy(false);
            }
          }}
        >
          Copy diagnostics
        </Button>
        {problems.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted">Recent problems ({problems.length})</summary>
            <ul className="mt-2 max-h-56 space-y-1.5 overflow-y-auto">
              {problems.map((l, i) => (
                <li key={i} className="rounded-lg bg-surface-2 px-2.5 py-1.5">
                  <span className={l.level === "error" ? "text-danger" : "text-warning"}>{l.source}</span> · {new Date(l.created_at).toLocaleString()}
                  <div className="whitespace-pre-wrap text-text-2">{l.message.split("\n")[0]}</div>
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>
    </section>
  );
}

export default function SettingsPage() {
  const toast = useToast();
  const { data: settings, reload } = useApi<Settings>("/api/settings");
  const { data: stats } = useApi<{ task: string; n: number; avg_ms: number | null; up: number; down: number }[]>("/api/settings/stats");
  const save = async (patch: Record<string, unknown>) => {
    try {
      await api("/api/settings", { method: "PATCH", json: patch });
      toast("Settings saved");
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <div className="animate-rise">
      <PageHeader title="Settings" />
      <div className="space-y-8">
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-2">
            <Palette className="size-4" /> Appearance
          </h2>
          <Card className="flex items-center justify-between p-5">
            <div>
              <div className="text-sm font-medium">Theme</div>
              <div className="text-xs text-muted">Light, dark, or follow your computer</div>
            </div>
            <div className="w-64">
              <ThemeToggle />
            </div>
          </Card>
          <MarginSetting />
        </section>

        <section id="models">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-2">
            <Cpu className="size-4" /> AI Models
          </h2>
          {settings ? <Models settings={settings} save={save} /> : <Loader2 className="size-5 animate-spin text-muted" />}
        </section>

        <section>{settings && <Advanced settings={settings} save={save} />}</section>
        <section>{settings && <Integrations settings={settings} save={save} />}</section>

        <ProSection />
        <HelpSection />

        <section>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-2">
            <Shield className="size-4" /> Privacy & data
          </h2>
          <Card className="space-y-3 p-5 text-sm text-text-2">
            <p>
              Everything — your files, extracted text, quizzes, flashcards and progress — is stored on this computer in the <code className="rounded bg-surface-2 px-1">data/</code> folder of the LectureLab project. With Ollama, AI runs locally too: your course material is never sent to an AI company.
            </p>
            <p>The only things that leave your computer are topic titles sent to YouTube or Wikipedia when you ask for external resources.</p>
            {stats && stats.length > 0 && (
              <div className="pt-2">
                <div className="mb-2 text-xs font-semibold text-muted">AI usage on this computer (for evaluating model quality)</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-left text-muted">
                      <tr>
                        <th className="py-1 pr-4 font-medium">Task</th>
                        <th className="py-1 pr-4 font-medium">Runs</th>
                        <th className="py-1 pr-4 font-medium">Avg time</th>
                        <th className="py-1 font-medium">Ratings 👍/👎</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.map((s) => (
                        <tr key={s.task} className="border-t border-border">
                          <td className="py-1.5 pr-4 capitalize">{s.task}</td>
                          <td className="py-1.5 pr-4 tabular-nums">{s.n}</td>
                          <td className="py-1.5 pr-4 tabular-nums">{s.avg_ms ? `${(s.avg_ms / 1000).toFixed(1)} s` : "—"}</td>
                          <td className="py-1.5 tabular-nums">
                            {s.up}/{s.down}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Card>
        </section>
      </div>
    </div>
  );
}

function MarginSetting() {
  const [visible, setVisible] = useMarginVisible();
  return (
    <Card className="mt-3 flex items-center justify-between gap-4 p-5">
      <div className="flex items-center gap-3">
        <Margin state="ready" size={28} />
        <div>
          <div className="text-sm font-medium">Show Margin</div>
          <div className="text-xs text-muted">The little bookmark next to the tutor status. The status text always stays.</div>
        </div>
      </div>
      <input type="checkbox" role="switch" aria-label="Show Margin" checked={visible} onChange={(e) => setVisible(e.target.checked)} className="size-5 accent-[var(--primary)]" />
    </Card>
  );
}
