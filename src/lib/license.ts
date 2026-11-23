import "server-only";
import os from "node:os";
import { PRODUCT, PLAN, type ProFeature } from "@/lib/product";
import { getSettings, updateSettings } from "@/lib/settings";
import { logEvent } from "@/lib/logs";

/**
 * Pro licence keys, checked directly with the store (no LectureLab server).
 *
 *  - Lemon Squeezy: activate → gets an "instance id" (one per computer, limit
 *    set in the store), validate later, deactivate to move to a new computer.
 *  - Gumroad: verify the key; the number of uses is counted by Gumroad.
 *
 * After a successful check Pro works offline for PRODUCT.offlineGraceDays.
 */

export class LicenseError extends Error {}

type Fetch = typeof fetch;
let fetchImpl: Fetch = (...a) => fetch(...a);
export function setFetchForTests(f: Fetch) {
  fetchImpl = f;
}

const instanceName = () => `${os.hostname()} (${process.platform})`.slice(0, 100);

async function form(url: string, data: Record<string, string>) {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(data).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

interface CheckResult {
  ok: boolean;
  instanceId?: string;
  email?: string;
  message?: string;
}

async function lemonActivate(key: string): Promise<CheckResult> {
  const { json } = await form("https://api.lemonsqueezy.com/v1/licenses/activate", { license_key: key, instance_name: instanceName() });
  const meta = json.meta as { store_id?: number; product_id?: number; customer_email?: string } | undefined;
  if (!json.activated) return { ok: false, message: String(json.error ?? "This key couldn't be activated.") };
  if (PRODUCT.lemonSqueezy.storeId && meta?.store_id !== PRODUCT.lemonSqueezy.storeId) return { ok: false, message: "This key is for a different product." };
  if (PRODUCT.lemonSqueezy.productId && meta?.product_id !== PRODUCT.lemonSqueezy.productId) return { ok: false, message: "This key is for a different product." };
  return { ok: true, instanceId: String((json.instance as { id?: string } | undefined)?.id ?? ""), email: meta?.customer_email };
}

async function lemonValidate(key: string, instanceId: string): Promise<CheckResult> {
  const { json } = await form("https://api.lemonsqueezy.com/v1/licenses/validate", { license_key: key, instance_id: instanceId });
  const lk = json.license_key as { status?: string } | undefined;
  if (json.valid && lk?.status !== "disabled" && lk?.status !== "expired") return { ok: true };
  return { ok: false, message: String(json.error ?? `Licence is ${lk?.status ?? "not valid"}.`) };
}

async function gumroadVerify(key: string, countUse: boolean): Promise<CheckResult> {
  const { json } = await form("https://api.gumroad.com/v2/licenses/verify", {
    product_id: PRODUCT.gumroad.productId,
    license_key: key,
    increment_uses_count: countUse ? "true" : "false",
  });
  if (!json.success) return { ok: false, message: String(json.message ?? "That licence key wasn't recognised.") };
  const p = (json.purchase ?? {}) as { refunded?: boolean; chargebacked?: boolean; disputed?: boolean; subscription_ended_at?: string | null; email?: string };
  if (p.refunded || p.chargebacked || p.disputed) return { ok: false, message: "This purchase was refunded or disputed." };
  if (p.subscription_ended_at) return { ok: false, message: "This subscription has ended." };
  if (countUse && typeof json.uses === "number" && json.uses > PRODUCT.maxDevices)
    return { ok: false, message: `This key is already used on ${PRODUCT.maxDevices} computers. Remove it from one first (Settings → Pro).` };
  return { ok: true, email: p.email };
}

let providerOverride: (typeof PRODUCT)["licenseProvider"] | null = null;
/** Tests only: pretend a store is configured. */
export function setProviderForTests(p: (typeof PRODUCT)["licenseProvider"] | null) {
  providerOverride = p;
}
const provider = () => providerOverride ?? PRODUCT.licenseProvider;
export const licensingEnabled = () => provider() !== "none";

/** True when Pro features are unlocked on this computer. */
export function isPro(now = new Date()): boolean {
  if (!licensingEnabled()) return true;
  const s = getSettings();
  if (s.licenseStatus !== "active" || !s.licenseKey) return false;
  const checked = s.licenseCheckedAt ? new Date(s.licenseCheckedAt).getTime() : 0;
  return now.getTime() - checked < PRODUCT.offlineGraceDays * 86_400_000;
}

export function requirePro(feature: ProFeature) {
  if (!isPro()) {
    throw new LicenseError(`${PLAN.proFeatures[feature]} is part of ${PRODUCT.proName}. Unlock it in Settings → ${PRODUCT.proName}.`);
  }
}

export function licenseInfo() {
  const s = getSettings();
  return {
    enabled: licensingEnabled(),
    pro: isPro(),
    status: s.licenseStatus,
    email: s.licenseEmail || null,
    keyHint: s.licenseKey ? `••••${s.licenseKey.slice(-4)}` : null,
    checkedAt: s.licenseCheckedAt || null,
    buyUrl: PRODUCT.buyUrl || null,
    price: PRODUCT.proPrice,
    proName: PRODUCT.proName,
    features: Object.values(PLAN.proFeatures),
    freeCourseLimit: PLAN.freeCourseLimit,
  };
}

export async function activateLicense(rawKey: string) {
  const key = rawKey.trim();
  if (!licensingEnabled()) throw new LicenseError("Licences aren't set up in this build — everything is already unlocked.");
  if (key.length < 8 || key.length > 200) throw new LicenseError("That doesn't look like a licence key.");
  let r: CheckResult;
  try {
    r = provider() === "lemonsqueezy" ? await lemonActivate(key) : await gumroadVerify(key, true);
  } catch (e) {
    throw new LicenseError(`Couldn't reach the licence server — check your internet connection. (${(e as Error).message})`);
  }
  if (!r.ok) {
    logEvent("warn", "license", `Activation refused: ${r.message}`);
    throw new LicenseError(r.message ?? "That key isn't valid.");
  }
  updateSettings({ licenseKey: key, licenseInstanceId: r.instanceId ?? "", licenseStatus: "active", licenseCheckedAt: new Date().toISOString(), licenseEmail: r.email ?? "" });
  return licenseInfo();
}

/** Re-check occasionally while online. Network problems don't remove Pro (grace period applies). */
export async function revalidateLicense(force = false) {
  const s = getSettings();
  if (!licensingEnabled() || s.licenseStatus !== "active" || !s.licenseKey) return licenseInfo();
  const age = Date.now() - (s.licenseCheckedAt ? new Date(s.licenseCheckedAt).getTime() : 0);
  if (!force && age < 3 * 86_400_000) return licenseInfo();
  try {
    const r = provider() === "lemonsqueezy" ? await lemonValidate(s.licenseKey, s.licenseInstanceId) : await gumroadVerify(s.licenseKey, false);
    if (r.ok) updateSettings({ licenseCheckedAt: new Date().toISOString() });
    else {
      updateSettings({ licenseStatus: "invalid" });
      logEvent("warn", "license", `Licence no longer valid: ${r.message}`);
    }
  } catch {
    /* offline — keep using the grace period */
  }
  return licenseInfo();
}

export async function removeLicense() {
  const s = getSettings();
  if (provider() === "lemonsqueezy" && s.licenseKey && s.licenseInstanceId) {
    try {
      await form("https://api.lemonsqueezy.com/v1/licenses/deactivate", { license_key: s.licenseKey, instance_id: s.licenseInstanceId });
    } catch {
      /* best effort */
    }
  }
  updateSettings({ licenseKey: "", licenseInstanceId: "", licenseStatus: "none", licenseCheckedAt: "", licenseEmail: "" });
  return licenseInfo();
}
