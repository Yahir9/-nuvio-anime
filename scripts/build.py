
#!/usr/bin/env python3

import json
import os
import re
import sys
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
MEDIA = (".m3u8", ".mp4", ".mpd", ".mkv")


def load(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def save(relative, data):
    path = ROOT / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8"
    )


def valid_url(value, media=False):
    if not isinstance(value, str):
        return False

    u = urlparse(value)
    host = (u.hostname or "").lower()

    if u.scheme != "https" or not host:
        return False

    if u.username or u.password:
        return False

    if host in ("localhost", "127.0.0.1", "::1"):
        return False

    if host.endswith((".local", ".internal")):
        return False

    if media and not u.path.lower().endswith(MEDIA):
        return False

    return True


def fresh(url):
    if not valid_url(url, media=True):
        return False

    expiry = parse_qs(urlparse(url).query).get("e")

    if expiry:
        try:
            now = int(datetime.now(timezone.utc).timestamp())
            return int(expiry[0]) > now + 300
        except (ValueError, IndexError):
            return False

    return True


def fetch(url):
    if not valid_url(url):
        raise ValueError("URL HTTPS no válida")

    request = Request(
        url,
        headers={
            "User-Agent": "NuvioAnime/1.1",
            "Accept": "text/html, application/json, text/plain"
        }
    )

    with urlopen(request, timeout=20) as response:
        data = response.read(5_000_001)

    if len(data) > 5_000_000:
        raise ValueError("Respuesta demasiado grande")

    return data.decode("utf-8-sig")


class MetadataParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.metadata = {}
        self.in_title = False
        self.title = ""

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)

        if tag == "title":
            self.in_title = True

        if tag == "meta":
            key = values.get(
                "property",
                values.get("name", "")
            ).lower()
            content = values.get("content", "")

            if key in (
                "og:title",
                "og:description",
                "og:image",
                "description"
            ):
                self.metadata[key] = content

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False

    def handle_data(self, data):
        if self.in_title:
            self.title += data


def slugify(value):
    text = str(value).lower().strip()
    text = re.sub(r"[^a-z0-9-]", "-", text)
    return re.sub(r"-+", "-", text).strip("-")[:80]


def source_url(source):
    env = source.get("url_env")

    if env:
        return os.getenv(env, "")

    return source.get("url", "")


def add(storage, item):
    slug = slugify(item.get("id", ""))
    name = str(item.get("name", "")).strip()

    if not slug or not name:
        return

    anime = storage.setdefault(
        slug,
        {
            "id": "na:" + slug,
            "type": "series",
            "name": name,
            "videos": {}
        }
    )

    if item.get("description"):
        anime["description"] = item["description"]

    if valid_url(item.get("poster")):
        anime["poster"] = item["poster"]

    for ep in item.get("episodes", []):
        try:
            season = int(ep.get("season", 1))
            number = int(ep["episode"])
        except (ValueError, TypeError, KeyError):
            continue

        if season < 1 or number < 1:
            continue

        video_id = f"na:{slug}:{season}:{number}"

        video = anime["videos"].setdefault(
            video_id,
            {
                "id": video_id,
                "title": f"Episodio {number}",
                "season": season,
                "episode": number,
                "streams": []
            }
        )

        for stream in ep.get("streams", []):
            if not isinstance(stream, dict):
                continue

            url = stream.get("url")

            if not fresh(url):
                continue

            if any(
                s["url"] == url
                for s in video["streams"]
            ):
                continue

            video["streams"].append({
                "name": str(stream.get("name", "HLS")),
                "url": url
            })


def html_source(source):
    name = source.get("name", "Anime")
    description = source.get("description", "")
    poster = ""

    url = source_url(source)

    try:
        html = fetch(url)
        parser = MetadataParser()
        parser.feed(html)

        metadata = parser.metadata

        name = (
            metadata.get("og:title", "")
            .split(" - ")[0]
            .strip()
        ) or name

        description = (
            metadata.get("og:description")
            or metadata.get("description")
            or description
        )

        poster = metadata.get("og:image", "")

        print("HTML consultado correctamente")

    except Exception as error:
        print(
            "AVISO HTML:",
            type(error).__name__,
            str(error),
            file=sys.stderr
        )

    return [{
        "id": source["id"],
        "name": name,
        "description": description,
        "poster": poster,
        "episodes": [{
            "season": source.get("season", 1),
            "episode": source.get("episode", 1),
            "streams": []
        }]
    }]


def direct_source(source):
    url = source_url(source)

    if not fresh(url):
        print("AVISO: HLS ausente o vencido")
        return html_source_fallback(source)

    return [{
        "id": source["id"],
        "name": source.get("name", "Anime"),
        "episodes": [{
            "season": source.get("season", 1),
            "episode": source.get("episode", 1),
            "streams": [{
                "name": "HLS",
                "url": url
            }]
        }]
    }]


def html_source_fallback(source):
    return [{
        "id": source["id"],
        "name": source.get("name", "Anime"),
        "episodes": [{
            "season": source.get("season", 1),
            "episode": source.get("episode", 1),
            "streams": []
        }]
    }]


def json_source(source):
    url = source_url(source)

    if not valid_url(url):
        raise ValueError("API no configurada")

    data = json.loads(fetch(url))

    if not isinstance(data, dict):
        raise ValueError("JSON inválido")

    items = data.get("animes", [])

    if not isinstance(items, list):
        raise ValueError("Falta lista animes")

    return items


def m3u_source(source):
    raw = fetch(source_url(source))
    items = []
    pending = None

    for line in raw.splitlines():
        line = line.strip()

        if line.startswith("#EXTINF:"):
            attrs = dict(
                re.findall(
                    r'([\w-]+)="([^"]*)"',
                    line
                )
            )

            if attrs.get(
                "group-title", ""
            ).lower() != "anime":
                pending = None
                continue

            match = re.fullmatch(
                r"([a-zA-Z0-9-]+):(\d+)",
                attrs.get("tvg-id", "")
            )

            pending = (
                (
                    match.group(1),
                    int(match.group(2)),
                    attrs.get("tvg-name", match.group(1))
                )
                if match else None
            )

        elif pending and line and not line.startswith("#"):
            slug, number, title = pending

            if fresh(line):
                items.append({
                    "id": slug,
                    "name": title,
                    "episodes": [{
                        "episode": number,
                        "streams": [{
                            "name": "M3U",
                            "url": line
                        }]
                    }]
                })

            pending = None

    return items


def generate():
    config = load(
        ROOT / "sources.json",
        {"sources": []}
    )

    sources = config.get("sources", [])

    if not isinstance(sources, list):
        raise ValueError("sources debe ser una lista")

    storage = {}
    errors = 0

    handlers = {
        "html": html_source,
        "direct": direct_source,
        "json": json_source,
        "m3u": m3u_source
    }

    for source in sources:
        if not isinstance(source, dict):
            continue

        if not source.get("enabled", True):
            continue

        try:
            kind = source.get("type")
            handler = handlers.get(kind)

            if handler is None:
                raise ValueError("Tipo no soportado")

            items = handler(source)

            for item in items:
                if isinstance(item, dict):
                    add(storage, item)

            print("Procesada fuente:", kind)

        except Exception as error:
            errors += 1
            print(
                "ERROR:",
                type(error).__name__,
                str(error),
                file=sys.stderr
            )

    if not storage:
        raise RuntimeError(
            "Ninguna fuente produjo metadatos válidos"
        )

    metas = []
    stream_count = 0

    for slug, anime in sorted(storage.items()):
        videos = anime.pop("videos")
        episode_list = []

        for video in videos.values():
            streams = video.pop("streams")

            stream_count += len(streams)

            episode_list.append(video)

            save(
                f"stream/series/{video['id']}.json",
                {"streams": streams}
            )

        save(
            f"meta/series/na:{slug}.json",
            {
                "meta": {
                    **anime,
                    "videos": episode_list
                }
            }
        )

        metas.append(anime)

    for offset in range(0, len(metas), 100):
        path = (
            "catalog/series/anime.json"
            if offset == 0
            else f"catalog/series/anime/skip={offset}.json"
        )

        save(path, {
            "metas": metas[offset:offset + 100]
        })

    print("Animes:", len(metas))
    print("Streams vigentes:", stream_count)
    print("Errores:", errors)
    print("Generación finalizada")


if __name__ == "__main__":
    generate()
