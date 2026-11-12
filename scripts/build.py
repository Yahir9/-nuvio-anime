#!/usr/bin/env python3
"""Generate static Stremio-style addon JSON routes for GitHub Pages.

Inputs (sources.json):
{
  "sources": [
    {"type":"json", "url":"https://your-authorized-site/catalog.json"},
    {"type":"m3u", "url":"https://your-authorized-site/list.m3u"}
  ]
}

JSON feed schema: {"animes":[{"id":"slug", "name":"Title", "poster":"https://...",
 "description":"...", "episodes":[{"episode":1,"season":1,
 "streams":[{"url":"https://.../video.m3u8","name":"HLS"}]}]}]}

M3U schema: #EXTINF:-1 tvg-id="slug:1" tvg-name="Anime title - 1" group-title="Anime",Title
              https://.../video.m3u8
For M3U, tvg-id 'slug:episode' is required. Only explicitly tagged Anime lines are accepted.
"""
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
ALLOW_SCHEMES = {"https"}
MEDIA_EXT = (".m3u8", ".mp4", ".mpd", ".mkv")


def valid_url(value, extensions=None):
    if not isinstance(value, str):
        return False
    u = urlparse(value)
    if u.scheme not in ALLOW_SCHEMES or not u.hostname or u.username or u.password:
        return False
    # Server-side fetches should not be directed to local/private networks.
    host = u.hostname.lower()
    if host in {"localhost", "127.0.0.1", "::1"} or host.endswith((".local", ".internal")):
        return False
    if extensions and not u.path.lower().endswith(extensions):
        return False
    return True


def fetch_text(url):
    if not valid_url(url):
        raise ValueError("Invalid public HTTPS URL")
    req = Request(url, headers={"User-Agent": "NuvioAnimeAuthorizedCatalog/1.0", "Accept": "application/json, audio/x-mpegurl, text/plain"})
    with urlopen(req, timeout=25) as response:
        return response.read(5_000_001).decode("utf-8-sig")


def slugify(value):
    return re.sub(r"[^a-z0-9-]", "", str(value).lower().replace(" ", "-"))[:90]


def read_json(path, default):
    try:
        return json.loads(path.read_text(encoding="utf8"))
    except (OSError, ValueError):
        return default


def save(relative, value):
    path = ROOT / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf8")


def add_anime(storage, item):
    slug = slugify(item.get("id", ""))
    name = str(item.get("name", "")).strip()
    if not slug or not name:
        return
    info = storage.setdefault(slug, {"id": "na:" + slug, "type": "series", "name": name, "videos": {}})
    if item.get("description"):
        info["description"] = str(item["description"])
    if valid_url(item.get("poster")):
        info["poster"] = item["poster"]
    for episode in item.get("episodes", []):
        try:
            n = int(episode["episode"])
            season = int(episode.get("season", 1))
        except (KeyError, ValueError, TypeError):
            continue
        if n < 1 or season < 1:
            continue
        video_id = f"na:{slug}:{season}:{n}"
        v = info["videos"].setdefault(video_id, {"id": video_id, "title": f"Episodio {n}", "season": season, "episode": n, "streams": []})
        for stream in episode.get("streams", []):
            url = stream.get("url") if isinstance(stream, dict) else None
            if valid_url(url, MEDIA_EXT) and url not in {s["url"] for s in v["streams"]}:
                v["streams"].append({"name": str(stream.get("name", "Fuente autorizada")), "url": url})


def m3u_items(raw):
    pending = None
    for line in raw.splitlines():
        line = line.strip()
        if line.startswith("#EXTINF:"):
            attrs = dict(re.findall(r'([\w-]+)="([^"]*)"', line))
            if attrs.get("group-title", "").lower() != "anime":
                pending = None
                continue
            ref = attrs.get("tvg-id", "")
            match = re.fullmatch(r"([a-zA-Z0-9-]+):(\d+)", ref)
            if not match:
                pending = None
                continue
            title = attrs.get("tvg-name", line.split(",", 1)[-1]).strip()
            pending = (match.group(1), int(match.group(2)), title)
        elif pending and line and not line.startswith("#"):
            slug, num, title = pending
            if valid_url(line, MEDIA_EXT):
                name = re.sub(r"\s*[-:]\s*\d+$", "", title).strip() or slug
                yield {"id": slug, "name": name, "episodes": [{"episode": num, "streams": [{"name": "M3U", "url": line}]}]}
            pending = None


def main():
    cfg = read_json(ROOT / "sources.json", {"sources": []})
    entries = cfg.get("sources", [])
    if not isinstance(entries, list):
        raise ValueError("sources must be an array")
    anime = {}
    errors = []
    for entry in entries:
        if not isinstance(entry, dict) or not entry.get("enabled", True):
            continue
        try:
            kind = entry.get("type")
            url = entry.get("url")
            if kind not in {"json", "m3u"}:
                raise ValueError("Supported source types: json, m3u")
            raw = fetch_text(url)
            if kind == "json":
                parsed = json.loads(raw)
                items = parsed.get("animes", [])
                if not isinstance(items, list):
                    raise ValueError("animes must be an array")
            else:
                items = list(m3u_items(raw))
            for item in items:
                if isinstance(item, dict):
                    add_anime(anime, item)
            print(f"Loaded {len(items)} entries from {kind}: {urlparse(url).hostname}")
        except Exception as e:
            errors.append(str(e))
            print(f"WARNING source failed: {type(e).__name__}: {e}", file=sys.stderr)
    # Never erase a previously published catalog when all configured sources fail.
    if entries and not anime:
        existing = read_json(ROOT / "catalog/series/anime.json", {"metas": []})
        if existing.get("metas"):
            print("All feeds unavailable; keeping previously generated files")
            return
        raise RuntimeError("No authorized sources returned valid anime; no old catalog to retain")
    metas = []
    for slug, info in sorted(anime.items()):
        videos = info.pop("videos")
        metas.append({k: v for k, v in info.items() if k in ("id", "type", "name", "poster", "description")})
        save(f"meta/series/na:{slug}.json", {"meta": {**info, "videos": [{k: v for k, v in video.items() if k != "streams"} for video in videos.values()]}})
        for video in videos.values():
            save(f"stream/series/{video['id']}.json", {"streams": video["streams"]})
    for offset in range(0, len(metas), 100):
        route = "catalog/series/anime.json" if offset == 0 else f"catalog/series/anime/skip={offset}.json"
        save(route, {"metas": metas[offset:offset+100]})
    if not metas:
        save("catalog/series/anime.json", {"metas": []})
    print(f"Complete: {len(metas)} anime titles. Errors: {len(errors)}")


if __name__ == "__main__":
    main()
