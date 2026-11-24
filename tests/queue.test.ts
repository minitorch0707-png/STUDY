import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ChatRequest, LLMProvider } from "@/lib/ai/types";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ll-queue-"));
process.env.LECTURELAB_DATA_DIR = tmp;
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("AI queue", () => {
  it("runs the student's tutor answer before queued background jobs", async () => {
    const ai = await import("@/lib/ai");
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstDone = new Promise<void>((r) => (releaseFirst = r));
    const llm: LLMProvider = {
      name: "test",
      model: "test",
      async chat(req: ChatRequest) {
        order.push(req.usage!.task);
        if (order.length === 1) await firstDone; // keep the queue busy
        return { text: "ok", model: "test" };
      },
      async *stream(req: ChatRequest) {
        order.push(req.usage!.task);
        yield "ok";
      },
    };
    ai.setProvidersForTests(llm);
    const L = ai.getLLM();
    const busy = L.chat({ messages: [], usage: { task: "notes" } });
    await new Promise((r) => setTimeout(r, 5));
    const bg1 = L.chat({ messages: [], usage: { task: "flashcards" } });
    const bg2 = L.chat({ messages: [], usage: { task: "notes" } });
    const tutor = (async () => {
      for await (const _ of L.stream({ messages: [], usage: { task: "tutor" } })) void _;
    })();
    await new Promise((r) => setTimeout(r, 5));
    releaseFirst();
    await Promise.all([busy, bg1, bg2, tutor]);
    expect(order).toEqual(["notes", "tutor", "flashcards", "notes"]);
  });
});
