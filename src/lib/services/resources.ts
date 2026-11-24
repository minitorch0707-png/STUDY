import "server-only";
import { z } from "zod";
import { db, newId, nowIso } from "@/lib/db";
import { generateJson, getStatus } from "@/lib/ai";
import { resourceReasonPrompt } from "@/lib/ai/prompts";
import { getSettings } from "@/lib/settings";
import { getCourse } from "./courses";
import { getTopic } from "./topics";

/**
 * Real external resources only:
 *  - YouTube Data API v3 (needs a free API key) for videos
 *  - Wikipedia's public API for encyclopedia explainers (no key needed)
 * Results are cached for 7 days per topic to save API quota.
 */

export interface Resource {
  id: string;
  provider: "youtube" | "wikipedia";
  title: string;
  url: string;
  thumbnail: string | null;
  channel: string | null;
  duration: string | null;
  description: string | null;
  reason: string | null;
}

const CACHE_DAYS = 7;

export function isoDurationToText(iso: string | undefined): string | null {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso ?? "");
  if (!m) return null;
  const [h, mi, s] = [Number(m[1] ?? 0), Number(m[2] ?? 0), Number(m[3] ?? 0)];
  return h ? `${h}:${String(mi).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${mi}:${String(s).padStart(2, "0")}`;
}

const decodeHtml = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

async function searchYouTube(query: string, key: string): Promise<Omit<Resource, "id" | "reason">[]> {
  const params = new URLSearchParams({ part: "snippet", q: query, type: "video", maxResults: "8", safeSearch: "strict", relevanceLanguage: "en", videoEmbeddable: "true", key });
  const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(`YouTube API: ${body.error?.message ?? res.status}`);
  }
  const data = (await res.json()) as { items: { id: { videoId: string }; snippet: { title: string; description: string; channelTitle: string; thumbnails: { medium?: { url: string } } } }[] };
  const ids = data.items.map((i) => i.id.videoId).filter(Boolean);
  if (!ids.length) return [];
  const det = await fetch(`https://www.googleapis.com/youtube/v3/videos?${new URLSearchParams({ part: "contentDetails", id: ids.join(","), key })}`, { signal: AbortSignal.timeout(10_000) });
  const details = det.ok ? ((await det.json()) as { items: { id: string; contentDetails: { duration: string } }[] }).items : [];
  const dur = new Map(details.map((d) => [d.id, isoDurationToText(d.contentDetails.duration)]));
  return data.items
    .filter((i) => i.id.videoId)
    .map((i) => ({
      provider: "youtube" as const,
      title: decodeHtml(i.snippet.title),
      url: `https://www.youtube.com/watch?v=${i.id.videoId}`,
      thumbnail: i.snippet.thumbnails.medium?.url ?? null,
      channel: decodeHtml(i.snippet.channelTitle),
      duration: dur.get(i.id.videoId) ?? null,
      description: decodeHtml(i.snippet.description),
      externalId: i.id.videoId,
    }));
}

async function searchWikipedia(query: string): Promise<Omit<Resource, "id" | "reason">[]> {
  const res = await fetch(`https://en.wikipedia.org/w/rest.php/v1/search/page?${new URLSearchParams({ q: query, limit: "4" })}`, {
    headers: { "User-Agent": "LectureLab/0.1 (educational study app)" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Wikipedia: HTTP ${res.status}`);
  const data = (await res.json()) as { pages: { key: string; title: string; excerpt: string; description: string | null; thumbnail: { url: string } | null }[] };
  return data.pages.map((p) => ({
    provider: "wikipedia" as const,
    title: p.title,
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(p.key)}`,
    thumbnail: p.thumbnail?.url ? (p.thumbnail.url.startsWith("//") ? `https:${p.thumbnail.url}` : p.thumbnail.url) : null,
    channel: "Wikipedia",
    duration: null,
    description: (p.description ? `${p.description}. ` : "") + p.excerpt.replace(/<[^>]+>/g, ""),
    externalId: p.key,
  }));
}

export function cachedResources(topicId: string): Resource[] {
  return db().prepare("SELECT * FROM resources WHERE topic_id = ? ORDER BY provider DESC, rowid").all(topicId) as Resource[];
}

export async function findResources(topicId: string, refresh = false) {
  const topic = getTopic(topicId);
  if (!topic) throw new Error("Topic not found");
  const s = getSettings();
  const cached = cachedResources(topicId);
  const fresh = db().prepare("SELECT MIN(fetched_at) t FROM resources WHERE topic_id = ?").get(topicId) as { t: string | null };
  if (!refresh && cached.length && fresh.t && Date.now() - new Date(fresh.t).getTime() < CACHE_DAYS * 86_400_000) {
    return { resources: cached, youtubeEnabled: Boolean(s.youtubeApiKey), errors: [] as string[] };
  }

  const course = getCourse(topic.course_id);
  // Add course context so "Duress" finds the criminal-law meaning, not something else.
  const subject = course?.title.replace(/\b[A-Z]{2,5}\s?\d{3}\b/g, "").trim() ?? "";
  const query = `${topic.title} ${subject}`.trim();
  const errors: string[] = [];
  const found: (Omit<Resource, "id" | "reason"> & { externalId?: string })[] = [];
  if (s.youtubeApiKey) {
    try {
      found.push(...(await searchYouTube(`${query} explained`, s.youtubeApiKey)));
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  try {
    found.push(...(await searchWikipedia(query)));
  } catch (e) {
    errors.push((e as Error).message);
  }
  if (!found.length) return { resources: cached, youtubeEnabled: Boolean(s.youtubeApiKey), errors };

  // Short "why this is relevant" notes from the local model, based only on title/description.
  const reasons = new Map<number, string>();
  try {
    const st = await getStatus();
    if (st.reachable && st.chatModel.installed) {
      const res = await generateJson(
        z.object({ reasons: z.array(z.object({ i: z.number().int(), reason: z.string() })) }),
        { messages: [{ role: "user", content: resourceReasonPrompt(topic.title, found.map((f, i) => ({ i, title: f.title, description: f.description ?? "" }))) }], temperature: 0.2, maxTokens: 900, usage: { task: "resources" } },
      );
      for (const r of res.reasons) reasons.set(r.i, r.reason.slice(0, 200));
    }
  } catch {
    /* reasons are optional */
  }

  db().transaction(() => {
    db().prepare("DELETE FROM resources WHERE topic_id = ?").run(topicId);
    const ins = db().prepare(
      "INSERT INTO resources (id, topic_id, provider, external_id, title, url, thumbnail, channel, duration, description, reason, fetched_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    );
    found.forEach((f, i) =>
      ins.run(newId(), topicId, f.provider, f.externalId ?? f.url, f.title, f.url, f.thumbnail, f.channel, f.duration, (f.description ?? "").slice(0, 500), reasons.get(i) ?? null, nowIso()),
    );
  })();
  return { resources: cachedResources(topicId), youtubeEnabled: Boolean(s.youtubeApiKey), errors };
}
