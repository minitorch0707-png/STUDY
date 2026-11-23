"use client";

import { useEffect, useState } from "react";
import { Check, KeyRound, Sparkles } from "lucide-react";
import { Badge, Button, ErrorNote, Input } from "./ui";
import { Modal, useToast } from "./overlay";
import { api, useApi } from "@/lib/client";

export interface LicenseInfo {
  enabled: boolean;
  pro: boolean;
  status: string;
  email: string | null;
  keyHint: string | null;
  checkedAt: string | null;
  buyUrl: string | null;
  price: string;
  proName: string;
  features: string[];
  freeCourseLimit: number;
}

export function useLicense() {
  return useApi<LicenseInfo>("/api/license");
}

export function ProBadge({ show = true }: { show?: boolean }) {
  if (!show) return null;
  return (
    <Badge tone="primary" className="gap-0.5">
      <Sparkles className="size-3" /> Pro
    </Badge>
  );
}

export function LicenseForm({ info, onChange }: { info: LicenseInfo; onChange: (i: LicenseInfo) => void }) {
  const toast = useToast();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (info.pro && info.keyHint)
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm">
          <Check className="size-4 text-success" /> {info.proName} is active{info.email ? ` for ${info.email}` : ""} · key {info.keyHint}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            if (!confirm("Remove the licence from this computer? You can use the key on another computer afterwards.")) return;
            onChange(await api<LicenseInfo>("/api/license", { method: "DELETE" }));
            toast("Licence removed from this computer");
          }}
        >
          Remove from this computer
        </Button>
      </div>
    );
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        try {
          onChange(await api<LicenseInfo>("/api/license", { method: "POST", json: { key } }));
          toast(`${info.proName} unlocked — thank you! 🎉`);
          setKey("");
        } catch (e) {
          setErr((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="flex gap-2">
        <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste your licence key" aria-label="Licence key" autoComplete="off" />
        <Button type="submit" loading={busy} disabled={key.trim().length < 8} icon={<KeyRound className="size-4" />}>
          Unlock
        </Button>
      </div>
      {err && <ErrorNote>{err}</ErrorNote>}
    </form>
  );
}

/** Global "Unlock Pro" dialog, opened whenever a Pro-only action is attempted. */
export function UpgradeDialog() {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const { data, setData } = useLicense();
  useEffect(() => {
    const on = (e: Event) => {
      setReason((e as CustomEvent<string | undefined>).detail ?? null);
      setOpen(true);
    };
    window.addEventListener("ll-needs-pro", on);
    return () => window.removeEventListener("ll-needs-pro", on);
  }, []);
  if (!data) return null;
  return (
    <Modal open={open} onClose={() => setOpen(false)} title={`Unlock ${data.proName}`}>
      <div className="space-y-5">
        {reason && <p className="text-sm text-text-2">{reason}</p>}
        <ul className="space-y-2">
          {data.features.map((f) => (
            <li key={f} className="flex gap-2 text-sm">
              <Sparkles className="mt-0.5 size-4 shrink-0 text-primary-text" /> {f}
            </li>
          ))}
          <li className="flex gap-2 text-sm">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-primary-text" /> Every future Pro feature, and support for development
          </li>
        </ul>
        {data.buyUrl && (
          <a href={data.buyUrl} target="_blank" rel="noopener noreferrer" className="flex h-12 w-full items-center justify-center rounded-xl bg-primary text-[15px] font-medium text-white shadow-card hover:bg-primary-hover">
            Get {data.proName} — {data.price}
          </a>
        )}
        <div>
          <p className="mb-2 text-xs text-muted">Already bought it? Your key is in your purchase email.</p>
          <LicenseForm
            info={data}
            onChange={(i) => {
              setData(i);
              if (i.pro) setOpen(false);
            }}
          />
        </div>
        <p className="text-xs text-muted">Everything still runs privately on your own computer. The key is checked with the store once, then works offline.</p>
      </div>
    </Modal>
  );
}
