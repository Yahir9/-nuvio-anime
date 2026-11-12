
#!/usr/bin/env python3

import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
MEDIA_EXT = (".m3u8", ".mp4", ".mpd", ".mkv")


def valid_url(url, media=False):
    if not isinstance(url, str):
        return False

    parsed = urlparse(url)

    if parsed.scheme != "https" or not parsed.hostname:
        return False

    if parsed.username or parsed.password:
        return False

    host = parsed.hostname.lower()

    if host in ("localhost", "127.0.0.1", "::1"):
        return False

    if host.endswith((".local", ".internal")):
        return False

    if media and not parsed.path.lower().endswith(MEDIA_EXT):
        return False

    return True


def read_json(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def save(path, data):
    destination = ROOT / path
    destination.parent.mkdir(
        parents=True,
        exist_ok=True
    )

    destination.write_text(
        json.dumps(
            data,
            ensure_ascii=False,
            indent=2
        ) + "\n",
        encoding="utf-8"
    )


def fetch(url):
    if not valid_url(url):
        raise ValueError("URL de fuente no válida")

    request = Request(
        url,
        headers={
            "User-Agent": "NuvioAnime/1.0",
            "Accept": "application/json, text/plain, application/x-mpegURL"
        }
    )

    with urlopen(request, timeout=25) as response:
        content = response.read(5_000_001)

    if len(content) > 5_000_000:
        raise ValueError("Fuente demasiado grande")

    return content.decode("utf-8-sig")


def slugify(value):
    value = str(value).lower().strip()
    value = re.sub(r"[^a-z0-9-]", "-", value)
    return re.sub(r"-+", "-", value).strip("-")[:80]


def check_expiration(url):
    params = parse_qs(urlparse(url).query)

    expiry = params.get("e", [])

    if not expiry:
        return

    try:
        timestamp = int(expiry[0])
    except ValueError:
        raise ValueError("Fecha de vencimiento inválida")

    now = int(datetime.now(timezone.utc).timestamp())

    if timestamp <= now + 300:
        raise ValueError(
            "El enlace HLS está vencido "
            "o vence en menos de cinco minutos"
        )


def add_anime(storage, item):
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
        anime["description"] = str(item["description"])

    poster = item.get("poster")

    if valid_url(poster):
        anime["poster"] = poster

    for episode in item.get("episodes", []):
        try:
            number = int(episode["episode"])
            season = int(episode.get("season", 1))
        except (KeyError, ValueError, TypeError):
            continue

        if number < 1 or season < 1:
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

        for stream in episode.get("streams", []):
            if not isinstance(stream, dict):
                continue

            url = stream.get("url")

            if not valid_url(url, media=True):
                continue

            check_expiration(url)

            if any(s["url"] == url for s in video["streams"]):
                continue

            video["streams"].append(
                {
                    "name": str(
                        stream.get("name", "Fuente HLS")
                    ),
                    "url": url
                }
            )


def parse_m3u(content):
    items = []
    pending = None

    for line in content.splitlines():
        line = line.strip()

        if line.startswith("#EXTINF:"):
            attributes = dict(
                re.findall(
                    r'([\w-]+)="([^"]*)"',
                    line
                )
            )

            if attributes.get(
                "group-title", ""
            ).lower() != "anime":
                pending = None
                continue

            match = re.fullmatch(
                r"([a-zA-Z0-9-]+):(\d+)",
                attributes.get("tvg-id", "")
            )

            if not match:
                pending = None
                continue

            name = attributes.get(
                "tvg-name",
                line.split(",", 1)[-1]
            )

            pending = (
                match.group(1),
                int(match.group(2)),
                name
            )

        elif pending and line and not line.startswith("#"):
            slug, episode, name = pending

            if valid_url(line, media=True):
                check_expiration(line)

                title = re.sub(
                    r"\s*[-:]\s*\d+$",
                    "",
                    name
                ).strip() or slug

                items.append(
                    {
                        "id": slug,
                        "name": title,
                        "episodes": [
                            {
                                "season": 1,
                                "episode": episode,
                                "streams": [
                                    {
                                        "name": "M3U",
                                        "url": line
                                    }
                                ]
                            }
                        ]
                    }
                )

            pending = None

    return items


def process_source(source):
    kind = source.get("type")

    if kind == "direct":
        secret = source.get("url_env")

        url = (
            os.getenv(secret, "")
            if secret
            else source.get("url", "")
        )

        if not valid_url(url, media=True):
            raise ValueError(
                "Enlace directo inválido o secreto vacío"
            )

        check_expiration(url)

        return [
            {
                "id": source.get("id", "anime-prueba"),
                "name": source.get(
                    "name", "Anime de prueba"
                ),
                "episodes": [
                    {
                        "season": source.get("season", 1),
                        "episode": source.get("episode", 1),
                        "streams": [
                            {
                                "name": "HLS",
                                "url": url
                            }
                        ]
                    }
                ]
            }
        ]

    if kind == "json":
        data = json.loads(fetch(source["url"]))

        if not isinstance(data, dict):
            raise ValueError("Formato JSON inválido")

        items = data.get("animes", [])

        if not isinstance(items, list):
            raise ValueError("La clave animes debe ser una lista")

        return items

    if kind == "m3u":
        content = fetch(source["url"])
        return parse_m3u(content)

    raise ValueError(
        "Tipo de fuente no soportado: " + str(kind)
    )


def generate():
    config = read_json(
        ROOT / "sources.json",
        {"sources": []}
    )

    sources = config.get("sources", [])

    if not isinstance(sources, list):
        raise ValueError("sources debe ser una lista")

    storage = {}
    errors = 0

    for source in sources:
        if not isinstance(source, dict):
            continue

        if not source.get("enabled", True):
            continue

        try:
            items = process_source(source)

            for item in items:
                if isinstance(item, dict):
                    add_anime(storage, item)

            print(
                "Fuente procesada:",
                source.get("type"),
                "- elementos:",
                len(items)
            )

        except Exception as error:
            errors += 1
            print(
                "ERROR EN FUENTE:",
                type(error).__name__,
                str(error),
                file=sys.stderr
            )

    if sources and not storage:
        raise RuntimeError(
            "Ninguna fuente produjo contenido válido. "
            "No se publicará un catálogo nuevo."
        )

    metas = []

    for slug, anime in sorted(storage.items()):
        videos = anime.pop("videos")

        meta = {
            **anime,
            "videos": []
        }

        for video in videos.values():
            meta["videos"].append(
                {
                    key: value
                    for key, value in video.items()
                    if key != "streams"
                }
            )

            save(
                f"stream/series/{video['id']}.json",
                {"streams": video["streams"]}
            )

        save(
            f"meta/series/na:{slug}.json",
            {"meta": meta}
        )

        metas.append(
            {
                key: value
                for key, value in anime.items()
                if key in (
                    "id",
                    "type",
                    "name",
                    "poster",
                    "description"
                )
            }
        )

    for offset in range(0, len(metas), 100):
        path = (
            "catalog/series/anime.json"
            if offset == 0
            else f"catalog/series/anime/skip={offset}.json"
        )

        save(
            path,
            {"metas": metas[offset:offset + 100]}
        )

    if not metas:
        save(
            "catalog/series/anime.json",
            {"metas": []}
        )

    print("Animes generados:", len(metas))
    print("Errores de fuentes:", errors)
    print("Generación completada")


if __name__ == "__main__":
    generate()
