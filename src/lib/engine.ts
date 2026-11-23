import "server-only";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import zlib from "node:zlib";
import { DATA_DIR } from "@/lib/db";
import { logEvent } from "@/lib/logs";

/**
 * The "managed" AI engine: LectureLab downloads its own private copy of
 * Ollama (open source, MIT licence) and runs it in the background, so students
 * don't install anything separately. If the student already runs Ollama, we
 * simply use theirs.
 *
 * Everything lives in the LectureLab data folder:
 *   engine/<version>/   the Ollama program
 *   models/             downloaded AI models
 */

export const OLLAMA_VERSION = "v0.40.17";
export const EXTERNAL_URL = "http://127.0.0.1:11434";
export const MANAGED_PORT = 11435;
export const MANAGED_URL = `http://127.0.0.1:${MANAGED_PORT}`;

export type EnginePhase = "idle" | "downloading" | "extracting" | "starting" | "running" | "error";

interface EngineState {
  phase: EnginePhase;
  progress: number; // 0..1 while downloading
  detail: string | null;
  error: string | null;
  proc: ChildProcess | null;
  busy: boolean;
}

const g = globalThis as unknown as { __llEngine?: EngineState; __llManagedUrl?: string | null };
const state: EngineState = (g.__llEngine ??= { phase: "idle", progress: 0, detail: null, error: null, proc: null, busy: false });

const engineDir = () => path.join(DATA_DIR, "engine", OLLAMA_VERSION);
export const modelsDir = () => path.join(DATA_DIR, "models");

export function assetFor(platform = process.platform, arch = process.arch): { name: string; kind: "tgz" | "zip" | "tzst"; approxMB: number } | null {
  if (platform === "darwin") return { name: "ollama-darwin.tgz", kind: "tgz", approxMB: 190 };
  if (platform === "win32") return arch === "arm64" ? { name: "ollama-windows-arm64.zip", kind: "zip", approxMB: 300 } : { name: "ollama-windows-amd64.zip", kind: "zip", approxMB: 1620 };
  if (platform === "linux") return arch === "arm64" ? { name: "ollama-linux-arm64.tar.zst", kind: "tzst", approxMB: 1500 } : { name: "ollama-linux-amd64.tar.zst", kind: "tzst", approxMB: 1550 };
  return null;
}

/** Which model fits this computer. Based on total memory, so it never overloads the machine. */
export function recommendedModels(totalBytes = os.totalmem()) {
  const gb = totalBytes / 1024 ** 3;
  const chat =
    gb < 7
      ? { name: "qwen3:1.7b", sizeGB: 1.4, why: `Your computer has ${Math.round(gb)} GB of memory, so we picked the smaller, faster model.` }
      : { name: "qwen3:4b", sizeGB: 2.5, why: `Your computer has ${Math.round(gb)} GB of memory — enough for the recommended model.` };
  return { chat, embedding: { name: "nomic-embed-text", sizeGB: 0.27 }, memoryGB: Math.round(gb) };
}

async function reachable(url: string) {
  try {
    const r = await fetch(`${url}/api/version`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

function findBinary(dir: string): string | null {
  const exe = process.platform === "win32" ? "ollama.exe" : "ollama";
  const queue = [dir];
  while (queue.length) {
    const d = queue.shift()!;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) if (e.isFile() && e.name === exe) return path.join(d, e.name);
    for (const e of entries) if (e.isDirectory()) queue.push(path.join(d, e.name));
  }
  return null;
}

export const managedBinary = () => (fs.existsSync(engineDir()) ? findBinary(engineDir()) : null);

/** The URL the app should use right now (null = no engine found). */
export function activeEngineUrl(): string | null {
  return g.__llManagedUrl ?? null;
}

export async function engineStatus() {
  const external = await reachable(EXTERNAL_URL);
  const managedUp = await reachable(MANAGED_URL);
  if (managedUp) {
    g.__llManagedUrl = MANAGED_URL;
    if (state.phase !== "running") Object.assign(state, { phase: "running", detail: null, error: null });
  }
  const asset = assetFor();
  return {
    mode: external ? ("external" as const) : managedUp ? ("managed" as const) : ("none" as const),
    phase: external ? ("running" as EnginePhase) : state.phase,
    progress: state.progress,
    detail: state.detail,
    error: state.error,
    installed: external || Boolean(managedBinary()),
    downloadMB: asset?.approxMB ?? null,
    supported: Boolean(asset) || external,
  };
}

async function download(url: string, dest: string) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status})`);
  const total = Number(res.headers.get("content-length") ?? 0);
  let done = 0;
  let lastTick = 0;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctl) {
      done += chunk.byteLength;
      const now = Date.now();
      if (now - lastTick > 300) {
        lastTick = now;
        state.progress = total ? done / total : 0;
        state.detail = `Downloading the AI engine… ${Math.round(done / 1e6)} of ${Math.round(total / 1e6) || "?"} MB`;
      }
      ctl.enqueue(chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body.pipeThrough(counter) as import("node:stream/web").ReadableStream), fs.createWriteStream(dest));
}

function run(cmd: string, args: string[], input?: NodeJS.ReadableStream) {
  return new Promise<void>((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: [input ? "pipe" : "ignore", "ignore", "pipe"], windowsHide: true });
    let err = "";
    p.stderr?.on("data", (d) => (err += d));
    if (input && p.stdin) input.pipe(p.stdin);
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}: ${err.slice(-400)}`))));
  });
}

async function extract(file: string, kind: "tgz" | "zip" | "tzst", dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  if (kind === "tgz") return run("tar", ["-xzf", file, "-C", dir]);
  if (kind === "zip") {
    // Windows 10+ includes tar.exe, which can unpack zip files; PowerShell is the fallback.
    try {
      return await run("tar", ["-xf", file, "-C", dir]);
    } catch {
      return run("powershell", ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${file}' -DestinationPath '${dir}' -Force`]);
    }
  }
  // .tar.zst: decompress with Node's built-in zstd, pipe into tar.
  const zstd = (zlib as unknown as { createZstdDecompress?: () => NodeJS.ReadWriteStream }).createZstdDecompress;
  if (!zstd) return run("tar", ["--zstd", "-xf", file, "-C", dir]);
  return run("tar", ["-xf", "-", "-C", dir], fs.createReadStream(file).pipe(zstd()));
}

async function startManaged(bin: string) {
  state.phase = "starting";
  state.detail = "Starting the AI engine…";
  fs.mkdirSync(modelsDir(), { recursive: true });
  const log = fs.openSync(path.join(DATA_DIR, "engine", "ollama.log"), "a");
  const proc = spawn(bin, ["serve"], {
    env: { ...process.env, OLLAMA_HOST: `127.0.0.1:${MANAGED_PORT}`, OLLAMA_MODELS: modelsDir(), OLLAMA_KEEP_ALIVE: "15m" },
    stdio: ["ignore", log, log],
    windowsHide: true,
  });
  state.proc = proc;
  proc.on("exit", (code) => {
    if (state.proc === proc) {
      state.proc = null;
      g.__llManagedUrl = null;
      if (state.phase === "running") {
        state.phase = "error";
        state.error = `The AI engine stopped unexpectedly (code ${code}). Restart LectureLab to try again.`;
        logEvent("error", "engine", state.error);
      }
    }
  });
  for (let i = 0; i < 60; i++) {
    if (await reachable(MANAGED_URL)) {
      g.__llManagedUrl = MANAGED_URL;
      Object.assign(state, { phase: "running", detail: null, error: null, progress: 1 });
      return;
    }
    if (proc.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("The AI engine didn't start. See engine/ollama.log in the data folder.");
}

/**
 * Make sure an AI engine is available. Uses an existing Ollama if one is
 * running, otherwise starts (and, if allowed, downloads) the managed copy.
 */
export async function ensureEngine(opts: { allowDownload: boolean }) {
  if (state.busy) return;
  state.busy = true;
  try {
    if (await reachable(EXTERNAL_URL)) return;
    if (await reachable(MANAGED_URL)) {
      g.__llManagedUrl = MANAGED_URL;
      state.phase = "running";
      return;
    }
    let bin = managedBinary();
    if (!bin) {
      if (!opts.allowDownload) return;
      const asset = assetFor();
      if (!asset) throw new Error(`Automatic setup isn't available for ${process.platform}/${process.arch}. Install Ollama from ollama.com instead.`);
      Object.assign(state, { phase: "downloading", progress: 0, error: null, detail: "Downloading the AI engine…" });
      const tmpDir = path.join(DATA_DIR, "engine", "download");
      fs.mkdirSync(tmpDir, { recursive: true });
      const file = path.join(tmpDir, asset.name);
      await download(`https://github.com/ollama/ollama/releases/download/${OLLAMA_VERSION}/${asset.name}`, file);
      Object.assign(state, { phase: "extracting", detail: "Unpacking…" });
      const partial = engineDir() + ".partial";
      fs.rmSync(partial, { recursive: true, force: true });
      await extract(file, asset.kind, partial);
      fs.renameSync(partial, engineDir());
      fs.rmSync(tmpDir, { recursive: true, force: true });
      bin = managedBinary();
      if (!bin) throw new Error("The AI engine download didn't contain the expected program.");
      if (process.platform !== "win32") fs.chmodSync(bin, 0o755);
    }
    await startManaged(bin);
  } catch (e) {
    Object.assign(state, { phase: "error", error: (e as Error).message, detail: null });
    logEvent("error", "engine", (e as Error).message);
  } finally {
    state.busy = false;
  }
}

export function stopEngine() {
  try {
    state.proc?.kill();
  } catch {
    /* already gone */
  }
}

let hooked = false;
export function installShutdownHooks() {
  if (hooked) return;
  hooked = true;
  process.on("exit", stopEngine);
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(sig, () => {
      stopEngine();
      process.exit(0);
    });
  }
}
