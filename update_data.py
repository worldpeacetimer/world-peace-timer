import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from urllib.parse import quote
from urllib.request import urlopen, Request

STATE_PATH = "state.json"
CONFLICTS_PATH = "conflicts.json"

# v1 快速版阈值（你要“宁可更快”）
WINDOW_RESET_HOURS = 3
WINDOW_LIST_HOURS = 24

RESET_MIN_ARTICLES = 8
RESET_MIN_UNIQUE_SOURCES = 4

LIST_MIN_ARTICLES = 5
LIST_MIN_UNIQUE_SOURCES = 3

# 冷却期：触发后 24 小时内不重复归零（除非换 pair，这里先简单：只要有 reset 就冷却）
RESET_COOLDOWN_HOURS = 24

# 军事冲突关键词（英文，v1 先只做英文，后面可加多语言）
KEYWORDS = [
    "cross-border", "border clash", "invasion", "invaded",
    "airstrike", "air strike", "missile", "shelling",
    "artillery", "drone strike", "incursion", "troops"
]

# 内战/国内冲突词（命中不直接排除，先降权；v1 为了快，先不做复杂权重）
CIVIL_HINTS = ["civil war", "rebels", "insurgents", "militia"]

# 国家/地区词表（v1 简化：只要标题/摘要里出现两个国家名就认为跨境候选）
# 先放一份常见国家名，后面可以扩充（你要全覆盖再扩）
COUNTRIES = [
    "United States", "US", "USA", "China", "Russia", "Ukraine", "Israel", "Palestine", "Iran",
    "Iraq", "Syria", "Lebanon", "Turkey", "Armenia", "Azerbaijan", "India", "Pakistan",
    "North Korea", "South Korea", "Japan", "Philippines", "Vietnam", "Thailand", "Myanmar",
    "Yemen", "Saudi Arabia", "United Arab Emirates", "Qatar", "Jordan", "Egypt",
    "Sudan", "South Sudan", "Ethiopia", "Eritrea", "Somalia", "Kenya", "Nigeria",
    "France", "Germany", "United Kingdom", "Britain", "UK", "Poland", "Romania"
]

def utc_now():
    return datetime.now(timezone.utc)

def iso_z(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

def load_json(path, default):
    if not os.path.exists(path):
        return default
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def save_json(path, obj):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)

def fetch_json(url):
    req = Request(url, headers={"User-Agent": "worldpeacetimer-bot/1.0"})
    with urlopen(req, timeout=30) as resp:
        data = resp.read().decode("utf-8", errors="replace")
        return json.loads(data)

def gdelt_doc_query(query, start_dt, end_dt, max_records=250):
    # GDELT 2.1 DOC API
    # docs: https://blog.gdeltproject.org/gdelt-2-0-our-global-world-in-realtime/
    # We use mode=ArtList for stable fields
    start = start_dt.strftime("%Y%m%d%H%M%S")
    end = end_dt.strftime("%Y%m%d%H%M%S")
    q = quote(query)
    url = (
        "https://api.gdeltproject.org/api/v2/doc/doc"
        f"?query={q}"
        f"&mode=ArtList"
        f"&format=json"
        f"&startdatetime={start}"
        f"&enddatetime={end}"
        f"&maxrecords={max_records}"
        f"&format=JSON"
        f"&sort=HybridRel"
    )
    return fetch_json(url)

def normalize_source(domain: str) -> str:
    d = (domain or "").lower().strip()
    d = re.sub(r"^www\.", "", d)
    return d

def contains_keyword(text: str) -> bool:
    t = (text or "").lower()
    return any(k in t for k in KEYWORDS)

def find_countries(text: str):
    t = (text or "")
    found = []
    for c in COUNTRIES:
        # 简单包含匹配（v1），加边界防止 US 命中无关词
        if re.search(rf"\b{re.escape(c)}\b", t, flags=re.IGNORECASE):
            found.append(c)
    # 去重保持顺序
    seen = set()
    out = []
    for x in found:
        if x.lower() not in seen:
            out.append(x)
            seen.add(x.lower())
    return out

def make_pair(entities):
    # 取前两个实体作为 pair（v1 简化）
    if len(entities) < 2:
        return None
    a, b = entities[0], entities[1]
    # 排序保证一致性
    sa, sb = sorted([a, b], key=lambda x: x.lower())
    return f"{sa} vs {sb}"

def main():
    now = utc_now()
    state = load_json(STATE_PATH, {"last_reset_at": iso_z(now), "last_reset_pair": "None", "evidence": []})
    last_reset_at = datetime.fromisoformat(state["last_reset_at"].replace("Z", "+00:00"))
    cooldown_ok = (now - last_reset_at) > timedelta(hours=RESET_COOLDOWN_HOURS)

    # 构造查询（关键词 OR）
    kw_q = " OR ".join([f'"{k}"' for k in KEYWORDS])
    query = f"({kw_q})"


    # 拉取 3 小时窗口：用于 reset
    start_reset = now - timedelta(hours=WINDOW_RESET_HOURS)
    data_reset = gdelt_doc_query(query, start_reset, now, max_records=250)
    articles_reset = data_reset.get("articles", []) if isinstance(data_reset, dict) else []

    # 拉取 24 小时窗口：用于列表
    start_list = now - timedelta(hours=WINDOW_LIST_HOURS)
    data_list = gdelt_doc_query(query, start_list, now, max_records=250)
    articles_list = data_list.get("articles", []) if isinstance(data_list, dict) else []

    def process_articles(articles):
        buckets = {}  # pair -> stats
        for a in articles:
            title = a.get("title", "") or ""
            seendate = a.get("seendate", "") or ""  # YYYYMMDDHHMMSS
            url = a.get("url", "") or ""
            domain = normalize_source(a.get("domain", "") or "")
            # 只做关键词命中（GDELT query 已筛过，但再防一下）
            if not contains_keyword(title):
                continue
            ents = find_countries(title)
            pair = make_pair(ents)
            if not pair:
                continue

            b = buckets.setdefault(pair, {
                "pair": pair,
                "articles": 0,
                "sources": set(),
                "last_seen_at": None,
                "top_links": []
            })
            b["articles"] += 1
            if domain:
                b["sources"].add(domain)
            # last_seen
            try:
                dt = datetime.strptime(seendate, "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
                if (b["last_seen_at"] is None) or (dt > b["last_seen_at"]):
                    b["last_seen_at"] = dt
            except Exception:
                pass

            # 收集链接（最多 8）
            if url and len(b["top_links"]) < 8:
                b["top_links"].append({"title": title[:120], "url": url})
        # finalize
        out = []
        for pair, b in buckets.items():
            out.append({
                "pair": b["pair"],
                "articles": b["articles"],
                "unique_sources": len(b["sources"]),
                "last_seen_at": iso_z(b["last_seen_at"]) if b["last_seen_at"] else None,
                "top_links": b["top_links"]
            })
        return out

    reset_stats = process_articles(articles_reset)
    list_stats = process_articles(articles_list)

    # 生成 conflicts.json（列表）
    active = []
    for item in list_stats:
        if item["articles"] >= LIST_MIN_ARTICLES and item["unique_sources"] >= LIST_MIN_UNIQUE_SOURCES:
            # score：快版简单排序
            score = item["articles"] + item["unique_sources"] * 2
            active.append({
                "pair": item["pair"],
                "last_seen_at": item["last_seen_at"],
                "articles_6h": item["articles"],       # v1 简化：用窗口内文章数当 6h
                "sources_6h": item["unique_sources"], # 同上
                "score": score,
                "top_links": item["top_links"][:5]
            })

    active.sort(key=lambda x: x["score"], reverse=True)
    save_json(CONFLICTS_PATH, active[:30])

    # 判断是否需要 reset
    triggered = None
    if cooldown_ok:
        for item in sorted(reset_stats, key=lambda x: (x["articles"], x["unique_sources"]), reverse=True):
            if item["articles"] >= RESET_MIN_ARTICLES and item["unique_sources"] >= RESET_MIN_UNIQUE_SOURCES:
                triggered = item
                break

    if triggered:
        state["last_reset_at"] = iso_z(now)
        state["last_reset_pair"] = triggered["pair"]
        # evidence：取 top_links
        state["evidence"] = [{"title": x["title"], "url": x["url"], "published_at": iso_z(now)} for x in triggered["top_links"][:20]]
        save_json(STATE_PATH, state)
    else:
# 只保存一次 state，避免无意义改动；这里不写也行
        pass

    print("OK:", iso_z(now), "active_conflicts=", len(active), "reset_triggered=", bool(triggered))

if __name__ == "__main__":
    main()
