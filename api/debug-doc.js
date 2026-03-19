// Deprecated: GDELT is rate-limited. Prefer looking at /api/refresh diagnostics sampleSeendates.
import { WINDOW_HOURS } from "./config.js";

function ymdhmsUTC(d) {
  const pad2 = (n) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear() +
    pad2(d.getUTCMonth() + 1) +
    pad2(d.getUTCDate()) +
    pad2(d.getUTCHours()) +
    pad2(d.getUTCMinutes()) +
    pad2(d.getUTCSeconds())
  );
}

async function fetchGdeltDocs({ start, end, max = 10 }) {
  const url = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
  url.searchParams.set(
    "query",
    "(war OR attack OR strike OR missile OR drone OR airstrike OR shelling OR invasion)"
  );
  url.searchParams.set("mode", "ArtList");
  url.searchParams.set("format", "json");
  url.searchParams.set("startdatetime", start);
  url.searchParams.set("enddatetime", end);
  url.searchParams.set("maxrecords", String(max));
  url.searchParams.set("sort", "HybridRel");

  const resp = await fetch(url.toString(), {
    headers: { "user-agent": "world-peace-timer/1.0" }
  });

  const text = await resp.text().catch(() => "");
  if (!resp.ok) {
    return { ok: false, status: resp.status, text: text.slice(0, 240) };
  }

  try {
    return { ok: true, json: JSON.parse(text) };
  } catch {
    return { ok: false, status: 200, text: text.slice(0, 240) };
  }
}

export default async function handler(req, res) {
  const now = new Date();
  const end = ymdhmsUTC(now);
  const start = ymdhmsUTC(new Date(now.getTime() - WINDOW_HOURS * 3600 * 1000));

  const r = await fetchGdeltDocs({ start, end, max: 10 });
  if (!r.ok) {
    res.status(200).json({ ok: false, upstream: r });
    return;
  }

  const arts = r.json?.articles || [];
  const sample = arts.slice(0, 5).map((a) => ({
    seendate: a?.seendate,
    sourceCountry: a?.sourceCountry,
    domain: a?.domain,
    title: a?.title,
    url: a?.url
  }));

  res.status(200).json({
    ok: true,
    windowHours: WINDOW_HOURS,
    sample
  });
}
