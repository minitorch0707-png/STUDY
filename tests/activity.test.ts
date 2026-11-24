import { describe, expect, it } from "vitest";
import { estimateCloudCost, priceFor, formatMoney } from "@/lib/pricing";
import { addDays, daysBetween, isIsoDate, localDateIso, monthGrid } from "@/lib/dates";
import { verifyCitations, markUncertain } from "@/lib/learning/citations";

describe("cloud comparison estimate", () => {
  it("uses separate input and output rates", () => {
    const e = estimateCloudCost(1_000_000, 200_000, "anthropic-claude-sonnet-4-6", "2026-11-24")!;
    expect(e.amount).toBeCloseTo(3 + 3); // $3/M input + 0.2M × $15/M output
    expect(e.price).toMatchObject({ provider: "Anthropic", currency: "USD", pricingDate: "2026-11-24" });
  });
  it("is unavailable without usage, without a reference, or when a dated price has ended", () => {
    expect(estimateCloudCost(null, 10, "openai-gpt-6-luna", "2026-11-24")).toBeNull();
    expect(estimateCloudCost(10, 10, null, "2026-11-24")).toBeNull();
    expect(estimateCloudCost(0, 0, "openai-gpt-6-luna", "2026-11-24")).toBeNull();
    expect(priceFor("google-gemini-4-argon", "2026-11-30")!.inputPerMillion).toBe(2);
    expect(priceFor("google-gemini-4-argon", "2026-12-01")!.inputPerMillion).toBe(4);
    expect(estimateCloudCost(10, 10, "no-such-model", "2026-11-24")).toBeNull();
    expect(formatMoney(0)).toBe("$0.00");
  });
});

describe("local dates", () => {
  it("does calendar math without time-zone drift", () => {
    expect(addDays("2026-03-07", 1)).toBe("2026-03-08"); // US DST weekend
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(daysBetween("2026-11-24", "2026-12-03")).toBe(9);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(localDateIso(new Date(2026, 10, 24, 23, 30))).toBe("2026-11-24"); // late evening stays the same local day
    const grid = monthGrid(2026, 11);
    expect(grid[0][0]).toBe("2026-10-26"); // Monday before Nov 1, 2026 (a Sunday)
    expect(grid.flat()).toContain("2026-11-30");
  });
});

describe("citation verification", () => {
  it("flags citations to sources that weren't provided, and uncited claims", () => {
    const text = "Elasticity measures how much quantity demanded responds to a change in price [S1].\n\nAn absolute value greater than one means demand is elastic, which is a key idea here.\n\n**Beyond your materials:** Economists also use cross-price elasticity in many other settings.\n\nSee also [S7].";
    const v = verifyCitations(text, 3);
    expect(v.cited).toEqual([1]);
    expect(v.invalid).toEqual([7]);
    expect(v.uncertainBlocks).toBe(1);
    const marked = markUncertain(text);
    expect(marked).toContain("elastic, which is a key idea here. [?](#uncertain)");
    expect(marked).not.toContain("[S1]. [?](#uncertain)");
    expect(marked).not.toMatch(/Beyond your materials.*#uncertain/);
  });
});
