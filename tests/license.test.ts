import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.LECTURELAB_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ll-license-"));

let L: typeof import("@/lib/license");
let S: typeof import("@/lib/settings");
let E: typeof import("@/lib/engine");
let calls: { url: string; body: string }[] = [];

function fakeStore(responder: (url: string, body: URLSearchParams) => unknown) {
  L.setFetchForTests(async (input, init) => {
    const url = String(input);
    const body = String(init?.body ?? "");
    calls.push({ url, body });
    return new Response(JSON.stringify(responder(url, new URLSearchParams(body))), { status: 200, headers: { "Content-Type": "application/json" } });
  });
}

beforeAll(async () => {
  L = await import("@/lib/license");
  S = await import("@/lib/settings");
  E = await import("@/lib/engine");
});
beforeEach(async () => {
  calls = [];
  L.setProviderForTests(null);
  S.updateSettings({ licenseKey: "", licenseInstanceId: "", licenseStatus: "none", licenseCheckedAt: "", licenseEmail: "" });
});

describe("licensing", () => {
  it("unlocks everything when no store is configured", () => {
    expect(L.licensingEnabled()).toBe(false);
    expect(L.isPro()).toBe(true);
  });

  it("activates a Lemon Squeezy key and stores the device instance", async () => {
    L.setProviderForTests("lemonsqueezy");
    expect(L.isPro()).toBe(false);
    fakeStore((url) =>
      url.endsWith("/activate")
        ? { activated: true, error: null, license_key: { status: "active" }, instance: { id: "inst-1" }, meta: { store_id: 0, product_id: 0, customer_email: "a@b.c" } }
        : { valid: true, license_key: { status: "active" } },
    );
    const info = await L.activateLicense("  ABCD-1234-EFGH-5678 ");
    expect(info.pro).toBe(true);
    expect(info.keyHint).toBe("••••5678");
    expect(S.getSettings().licenseInstanceId).toBe("inst-1");
    expect(calls[0].body).toContain("license_key=ABCD-1234-EFGH-5678");
  });

  it("rejects a key the store refuses, with the store's reason", async () => {
    L.setProviderForTests("lemonsqueezy");
    fakeStore(() => ({ activated: false, error: "This license key has reached the activation limit." }));
    await expect(L.activateLicense("ABCD-1234-EFGH-5678")).rejects.toThrow(/activation limit/);
    expect(L.isPro()).toBe(false);
  });

  it("verifies Gumroad keys and refuses refunded purchases", async () => {
    L.setProviderForTests("gumroad");
    fakeStore(() => ({ success: true, uses: 1, purchase: { email: "s@uni.edu", refunded: false } }));
    expect((await L.activateLicense("GUMROAD-KEY-0001")).pro).toBe(true);
    await L.removeLicense();
    fakeStore(() => ({ success: true, uses: 1, purchase: { refunded: true } }));
    await expect(L.activateLicense("GUMROAD-KEY-0001")).rejects.toThrow(/refunded/);
  });

  it("keeps working offline within the grace period, then asks to reconnect", async () => {
    L.setProviderForTests("gumroad");
    fakeStore(() => ({ success: true, uses: 1, purchase: {} }));
    await L.activateLicense("GUMROAD-KEY-0002");
    L.setFetchForTests(async () => {
      throw new Error("offline");
    });
    await L.revalidateLicense(true); // network failure must not remove Pro
    expect(L.isPro()).toBe(true);
    expect(L.isPro(new Date(Date.now() + 40 * 86_400_000))).toBe(false);
  });

  it("marks a licence invalid when the store says it was disabled", async () => {
    L.setProviderForTests("lemonsqueezy");
    fakeStore((url) => (url.endsWith("/activate") ? { activated: true, instance: { id: "i" }, meta: {} } : { valid: false, error: "disabled", license_key: { status: "disabled" } }));
    await L.activateLicense("ABCD-1234-EFGH-9999");
    await L.revalidateLicense(true);
    expect(L.isPro()).toBe(false);
    expect(S.getSettings().licenseStatus).toBe("invalid");
  });

  it("requirePro throws a friendly LicenseError only when locked", () => {
    expect(() => L.requirePro("studyPlanner")).not.toThrow();
    L.setProviderForTests("gumroad");
    expect(() => L.requirePro("studyPlanner")).toThrow(L.LicenseError);
  });
});

describe("automatic AI engine", () => {
  it("picks the right download for each computer", () => {
    expect(E.assetFor("darwin", "arm64")?.name).toBe("ollama-darwin.tgz");
    expect(E.assetFor("win32", "x64")?.name).toBe("ollama-windows-amd64.zip");
    expect(E.assetFor("linux", "x64")?.kind).toBe("tzst");
    expect(E.assetFor("aix", "ppc")).toBeNull();
  });
  it("chooses a model that fits the computer's memory", () => {
    expect(E.recommendedModels(16 * 1024 ** 3).chat.name).toBe("qwen3:4b-instruct-2507-q4_K_M");
    expect(E.recommendedModels(4 * 1024 ** 3).chat.name).toBe("qwen3:1.7b");
  });
});
