function kvEnv() {
  // Vercel Storage integrations can inject different env var names depending on provider/prefix.
  const url =
    process.env.KV_REST_API_URL ||
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.STORAGE_REST_URL ||
    process.env.STORAGE_REST_API_URL;

  const token =
    process.env.KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.STORAGE_REST_TOKEN ||
    process.env.STORAGE_REST_API_TOKEN;

  return { url, token };
}

async function kvGet(key) {
  const { url, token } = kvEnv();
  if (!url || !token) {
    throw new Error("Missing KV env: (KV_REST_API_URL/KV_REST_API_TOKEN) or (UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN)");
  }

  const resp = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!resp.ok) throw new Error(`KV get failed: ${resp.status}`);
  const data = await resp.json();
  return data?.result ?? null;
}

export default async function handler(req, res) {
  try {
    const raw = await kvGet("status");
    if (!raw) {
      res.status(200).json({
        isWarNow: false,
        peaceStartAtISO: new Date().toISOString(),
        updatedAtISO: new Date().toISOString(),
        windowHours: 24,
        minArticles: 1,
        activeConflicts: [],
        diagnostics: [{ scope: "kv", note: "no cached status yet; call /api/refresh" }]
      });
      return;
    }

    const status = JSON.parse(raw);
    res.setHeader("cache-control", "no-store");
    res.status(200).json(status);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
