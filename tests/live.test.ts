import { describe, expect, it } from "vitest";
import { startLive, subscribe, type LiveEvent } from "@/lib/services/live";

/** The Tutor shows "Saved" only on a `done` event, so `done` must mean "stored". */
async function collect(key: string) {
  const events: LiveEvent[] = [];
  for await (const e of subscribe(key, 0, () => ({ text: "", status: "failed", error: "gone" }))) events.push(e);
  return events;
}

describe("live generations", () => {
  it("sends done only after the finished text has been stored", async () => {
    const order: string[] = [];
    startLive(
      "t:ok",
      async (emit) => {
        emit("Hello ");
        emit("world");
      },
      {
        checkpoint: () => {},
        complete: async (text) => {
          await new Promise((r) => setTimeout(r, 30)); // slow disk
          order.push(`stored:${text}`);
        },
        fail: () => {},
      },
    );
    const events = await collect("t:ok");
    order.push(events.at(-1)!.type);
    expect(order).toEqual(["stored:Hello world", "done"]);
  });

  it("reports an error, never done, when storing the result fails", async () => {
    startLive("t:bad", async (emit) => emit("partial"), {
      checkpoint: () => {},
      complete: () => {
        throw new Error("disk full");
      },
      fail: () => {},
    });
    const events = await collect("t:bad");
    expect(events.some((e) => e.type === "done")).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: "error", message: "disk full" });
  });

  it("replays from an offset without repeating text", async () => {
    startLive("t:from", async (emit) => emit("abcdef"), { checkpoint: () => {}, complete: () => {}, fail: () => {} });
    const out: LiveEvent[] = [];
    for await (const e of subscribe("t:from", 3, () => ({ text: "abcdef", status: "complete" }))) out.push(e);
    const text = out.filter((e) => e.type === "text").map((e) => (e as { text: string }).text).join("");
    expect(text).toBe("def");
  });
});
