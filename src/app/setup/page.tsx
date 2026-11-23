"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Circle, Cpu, Download, GraduationCap, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { Button, Card, ErrorNote, ProgressBar, cn } from "@/components/ui";
import { api, readStream, useApi } from "@/lib/client";

interface SetupInfo {
  engine: { mode: "external" | "managed" | "none"; phase: string; progress: number; detail: string | null; error: string | null; installed: boolean; downloadMB: number | null; supported: boolean };
  ai: { reachable: boolean };
  recommended: { chat: { name: string; sizeGB: number; why: string }; embedding: { name: string; sizeGB: number }; memoryGB: number };
  models: { chat: boolean; embedding: boolean };
  setupComplete: boolean;
  desktop: boolean;
}

type StepState = "todo" | "active" | "done" | "error";

function Step({ state, title, detail, progress }: { state: StepState; title: string; detail?: string | null; progress?: number | null }) {
  return (
    <li className="flex gap-3">
      <div className="mt-0.5">
        {state === "done" ? <CheckCircle2 className="size-5 text-success" /> : state === "active" ? <Loader2 className="size-5 animate-spin text-primary" /> : state === "error" ? <Circle className="size-5 text-danger" /> : <Circle className="size-5 text-border-strong" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className={cn("text-sm font-medium", state === "todo" && "text-muted")}>{title}</div>
        {detail && <div className="text-xs text-muted">{detail}</div>}
        {state === "active" && progress != null && <ProgressBar value={Math.max(0.02, progress)} className="mt-2" label={title} />}
      </div>
    </li>
  );
}

export default function SetupPage() {
  const router = useRouter();
  const { data, reload } = useApi<SetupInfo>("/api/setup", { poll: 1000 });
  const [running, setRunning] = useState(false);
  const [modelStep, setModelStep] = useState<{ name: string; pct: number | null; status: string } | null>(null);
  const [modelsDone, setModelsDone] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  const engineReady = Boolean(data?.ai.reachable);
  const engineBusy = data && ["downloading", "extracting", "starting"].includes(data.engine.phase);

  const pull = async (name: string) => {
    setModelStep({ name, pct: null, status: "Starting download…" });
    const res = await fetch("/api/models/pull", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    await readStream<{ status?: string; total?: number; completed?: number; error?: string }>(res, (ev) => {
      if (ev.error) throw new Error(ev.error);
      setModelStep({ name, pct: ev.total ? (ev.completed ?? 0) / ev.total : null, status: ev.status ?? "" });
    });
    setModelsDone((d) => [...d, name]);
  };

  const run = async () => {
    if (!data || started.current) return;
    started.current = true;
    setRunning(true);
    setError(null);
    try {
      if (!data.ai.reachable) {
        await api("/api/setup/engine", { method: "POST" });
        // Wait for the engine (download + start can take several minutes).
        for (;;) {
          const s = await api<SetupInfo>("/api/setup");
          if (s.ai.reachable) break;
          if (s.engine.phase === "error") throw new Error(s.engine.error ?? "The AI engine couldn't be set up.");
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
      const s = await api<SetupInfo>("/api/setup");
      if (!s.models.embedding) await pull(s.recommended.embedding.name);
      if (!s.models.chat) await pull(s.recommended.chat.name);
      setModelStep(null);
      await api("/api/setup/complete", { method: "POST", json: { chatModel: s.recommended.chat.name, embeddingModel: s.recommended.embedding.name } });
      router.replace("/?welcome=1");
    } catch (e) {
      setError((e as Error).message);
      started.current = false;
      reload();
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    if (data?.setupComplete && data.ai.reachable && data.models.chat) router.replace("/");
  }, [data, router]);

  if (!data)
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <Loader2 className="size-6 animate-spin text-muted" />
      </div>
    );

  const totalGB = (data.ai.reachable ? 0 : (data.engine.downloadMB ?? 0) / 1000) + (data.models.chat ? 0 : data.recommended.chat.sizeGB) + (data.models.embedding ? 0 : data.recommended.embedding.sizeGB);
  const engineState: StepState = engineReady ? "done" : data.engine.phase === "error" ? "error" : engineBusy || (running && !engineReady) ? "active" : "todo";
  const modelState = (name: string, installed: boolean): StepState => (installed || modelsDone.includes(name) ? "done" : modelStep?.name === name ? "active" : "todo");

  return (
    <div className="mx-auto max-w-xl animate-rise py-6">
      <div className="mb-8 text-center">
        <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-card">
          <GraduationCap className="size-7" />
        </div>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight sm:text-3xl">Welcome to LectureLab</h1>
        <p className="mt-2 text-[15px] text-muted">One quick setup and your private AI tutor is ready. It runs entirely on this computer: free, offline, and your files never leave it.</p>
      </div>

      <Card className="p-6">
        <ol className="space-y-5">
          <Step
            state={engineState}
            title={engineReady ? "AI engine ready" : "Install the AI engine"}
            detail={engineReady ? (data.engine.mode === "external" ? "Using the Ollama already on this computer" : "Running privately on this computer") : data.engine.detail ?? (data.engine.downloadMB ? `About ${data.engine.downloadMB >= 1000 ? `${(data.engine.downloadMB / 1000).toFixed(1)} GB` : `${data.engine.downloadMB} MB`}, one time` : null)}
            progress={data.engine.phase === "downloading" ? data.engine.progress : null}
          />
          <Step
            state={modelState(data.recommended.embedding.name, data.models.embedding)}
            title="Download the search model"
            detail={modelStep?.name === data.recommended.embedding.name ? modelStep.status : `${data.recommended.embedding.name} · ${Math.round(data.recommended.embedding.sizeGB * 1000)} MB`}
            progress={modelStep?.name === data.recommended.embedding.name ? modelStep.pct : null}
          />
          <Step
            state={modelState(data.recommended.chat.name, data.models.chat)}
            title="Download the AI tutor model"
            detail={modelStep?.name === data.recommended.chat.name ? modelStep.status : `${data.recommended.chat.name} · ${data.recommended.chat.sizeGB} GB. ${data.recommended.chat.why}`}
            progress={modelStep?.name === data.recommended.chat.name ? modelStep.pct : null}
          />
        </ol>

        {error && (
          <ErrorNote className="mt-5">
            {error} <span className="block pt-1 text-xs">Check your internet connection and try again. Steps that already finished won&apos;t be repeated.</span>
          </ErrorNote>
        )}

        <Button size="lg" className="mt-6 w-full" onClick={run} loading={running} icon={!running ? <Download className="size-4" /> : undefined} disabled={!data.engine.supported && !data.ai.reachable}>
          {running ? "Setting up… you can leave this open" : totalGB > 0.05 ? `Set everything up (${totalGB.toFixed(1)} GB download)` : "Finish setup"}
        </Button>
        {!data.engine.supported && !data.ai.reachable && <p className="mt-3 text-center text-xs text-danger">Automatic setup isn&apos;t available on this system. Install Ollama from ollama.com, then reopen this page.</p>}
        <p className="mt-3 text-center text-xs text-muted">Depending on your internet this takes 5–20 minutes. It only happens once.</p>
      </Card>

      <div className="mt-6 grid gap-3 text-xs text-muted sm:grid-cols-3">
        <div className="flex gap-2">
          <ShieldCheck className="size-4 shrink-0" /> Private: nothing is uploaded
        </div>
        <div className="flex gap-2">
          <Cpu className="size-4 shrink-0" /> Fits your computer ({data.recommended.memoryGB} GB memory)
        </div>
        <div className="flex gap-2">
          <Sparkles className="size-4 shrink-0" /> Free: no AI subscription
        </div>
      </div>
      <div className="mt-6 text-center">
        <button
          className="text-xs text-muted underline underline-offset-2 hover:text-text"
          onClick={async () => {
            await api("/api/setup/complete", { method: "POST", json: {} });
            router.replace("/");
          }}
        >
          Skip for now (AI features stay off until set up in Settings)
        </button>
      </div>
    </div>
  );
}
