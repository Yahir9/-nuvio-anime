
#!/usr/bin/env python3
# M3U AutoExtractor - Nuvio Anime
# Extrae enlaces multimedia expuestos en HTML autorizado.

import json
import re
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
CONFIG = DATA / "players.json"
OUTPUT = DATA / "extracted_sources.json"

EXTENSIONS = (".m3u8", ".mp4", ".mpd")
TIMEOUT = 15
MAX_HTML = 2_000_000

session = requests.Session()
session.headers.update({
    "User-Agent": "NuvioAnime/1.0",
    "Accept": "text/html,application/xhtml+xml"
})


def valid_media(url):
    try:
        p = urlparse(url)
        return (
            p.scheme == "https"
            and bool(p.hostname)
            and p.path.lower().endswith(EXTENSIONS)
            and not p.username
            and not p.password
        )
    except ValueError:
        return False


def valid_page(url):
    try:
        p = urlparse(url)
        return (
            p.scheme == "https"
            and bool(p.hostname)
            and not p.username
            and not p.password
        )
    except ValueError:
        return False


def download_html(url):
    response = session.get(
        url,
        timeout=TIMEOUT,
        allow_redirects=False
    )
    response.raise_for_status()

    ctype = response.headers.get(
        "Content-Type", ""
    ).lower()

    if "html" not in ctype:
        raise ValueError(
            "La respuesta no es HTML: " + ctype
        )

    if len(response.content) > MAX_HTML:
        raise ValueError("HTML demasiado grande")

    return response.text


def extract_urls(html, base):
    found = set()
    soup = BeautifulSoup(html, "html.parser")

    # Etiquetas HTML de multimedia
    for tag in soup.select(
        "video[src], source[src], a[href]"
    ):
        raw = tag.get("src") or tag.get("href")
        if not raw:
            continue

        url = urljoin(base, raw)

        if valid_media(url):
            found.add(url)

    # URLs expuestas como texto en scripts HTML
    texto = html.replace("\\/", "/")
    texto = texto.replace("&amp;", "&")

    patron = (
        r'https://[^\s"\'<>\\]+?'
        r'(?:\.m3u8|\.mp4|\.mpd)'
        r'(?:\?[^\s"\'<>\\]*)?'
    )

    for match in re.findall(
        patron, texto, flags=re.IGNORECASE
    ):
        url = match.rstrip(");,}")

        if valid_media(url):
            found.add(url)

    return sorted(found)


def inspect_page(url):
    if valid_media(url):
        return [url]

    if not valid_page(url):
        return []

    html = download_html(url)
    results = set(extract_urls(html, url))

    # Revisar un iframe autorizado del mismo sitio.
    soup = BeautifulSoup(html, "html.parser")
    host = urlparse(url).hostname

    for frame in soup.select("iframe[src]")[:3]:
        target = urljoin(url, frame["src"])

        if (
            valid_page(target)
            and urlparse(target).hostname == host
        ):
            try:
                child = download_html(target)
                results.update(
                    extract_urls(child, target)
                )
            except (requests.RequestException, ValueError):
                pass

    return sorted(results)


def main():
    DATA.mkdir(parents=True, exist_ok=True)

    if not CONFIG.exists():
        print("No existe data/players.json")
        OUTPUT.write_text(
            '{"sources": []}\n',
            encoding="utf-8"
        )
        return

    config = json.loads(
        CONFIG.read_text(encoding="utf-8")
    )

    result = []
    seen = set()

    for item in config.get("players", []):
        if not item.get("enabled", True):
            continue

        slug = item.get("id", "")
        page = item.get("url", "")

        if not re.fullmatch(
            r"[a-z0-9][a-z0-9-]*", slug
        ):
            print("ID invalido:", slug)
            continue

        try:
            season = int(item.get("season", 1))
            episode = int(item.get("episode", 1))

            if season < 1 or episode < 1:
                continue

            urls = inspect_page(page)

        except (
            requests.RequestException,
            ValueError,
            TypeError
        ) as error:
            print(
                "No se pudo consultar:",
                slug,
                str(error)
            )
            continue

        print(
            slug,
            "episodio",
            episode,
            "enlaces encontrados:",
            len(urls)
        )

        for url in urls:
            key = (slug, season, episode, url)

            if key in seen:
                continue

            seen.add(key)

            result.append({
                "type": "direct",
                "id": slug,
                "name": item.get("name", slug),
                "season": season,
                "episode": episode,
                "url": url,
                "enabled": True
            })

    OUTPUT.write_text(
        json.dumps(
            {"sources": result},
            ensure_ascii=False,
            indent=2
        ) + "\n",
        encoding="utf-8"
    )

    print("Total de fuentes:", len(result))


if __name__ == "__main__":
    main()
