
#!/usr/bin/env python3
# Nuvio Anime - Detector de episodios V2
# HTML local + JSON de episodios guardados
# No consulta servicios externos

import html
import json
import re
from pathlib import Path
from urllib.parse import urlparse, urljoin

from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
HTML_DIR = DATA / "episodes-html"
JSON_DIR = DATA / "episodes-api"
OUTPUT = DATA / "episodes.json"

BASE = "https://jkanime.net/"
SLUG = re.compile(r"^[a-z0-9][a-z0-9-]*$")


def numero_episodio(url, slug):
    try:
        url = html.unescape(
            url.replace("\\/", "/")
        )

        p = urlparse(urljoin(BASE, url))

        if p.hostname not in (
            "jkanime.net",
            "www.jkanime.net"
        ):
            return None

        patron = (
            rf"/{re.escape(slug)}/(\d+)/?"
        )

        match = re.fullmatch(
            patron,
            p.path
        )

        if match:
            numero = int(match.group(1))

            if 0 <= numero <= 10000:
                return numero

    except (ValueError, TypeError):
        pass

    return None


def desde_html(contenido, slug):
    encontrados = set()

    soup = BeautifulSoup(
        contenido,
        "html.parser"
    )

    for a in soup.select("a[href]"):
        numero = numero_episodio(
            a.get("href", ""),
            slug
        )

        if numero is not None:
            encontrados.add(numero)

    texto = html.unescape(
        contenido.replace("\\/", "/")
    )

    patron = (
        rf"(?:https?://(?:www\.)?jkanime\.net)?"
        rf"/{re.escape(slug)}/(\d+)/?"
        rf"(?=[\s\"'<>?\\]|$)"
    )

    for match in re.finditer(
        patron,
        texto,
        re.IGNORECASE
    ):
        numero = int(match.group(1))

        if 0 <= numero <= 10000:
            encontrados.add(numero)

    return encontrados


def desde_api(contenido):
    encontrados = set()

    try:
        datos = json.loads(contenido)
    except ValueError:
        return encontrados

    if isinstance(datos, list):
        lista = datos
    elif isinstance(datos, dict):
        lista = datos.get("data", [])
    else:
        return encontrados

    if not isinstance(lista, list):
        return encontrados

    for episodio in lista:
        if not isinstance(episodio, dict):
            continue

        try:
            numero = int(
                episodio.get("number")
            )

            if 0 <= numero <= 10000:
                encontrados.add(numero)

        except (ValueError, TypeError):
            continue

    return encontrados


def main():
    HTML_DIR.mkdir(
        parents=True,
        exist_ok=True
    )
    JSON_DIR.mkdir(
        parents=True,
        exist_ok=True
    )

    encontrados = {}

    for ruta in sorted([
        *HTML_DIR.glob("*.html"),
        *HTML_DIR.glob("*.txt")
    ]):
        slug = ruta.stem.lower()

        if not SLUG.fullmatch(slug):
            continue

        contenido = ruta.read_text(
            encoding="utf-8",
            errors="replace"
        )

        numeros = desde_html(
            contenido,
            slug
        )

        encontrados.setdefault(
            slug, set()
        ).update(numeros)

        print(
            "HTML:",
            slug,
            "episodios:",
            len(numeros)
        )

    for ruta in sorted(
        JSON_DIR.glob("*.json")
    ):
        slug = ruta.stem.lower()

        if not SLUG.fullmatch(slug):
            continue

        contenido = ruta.read_text(
            encoding="utf-8"
        )

        numeros = desde_api(contenido)

        encontrados.setdefault(
            slug, set()
        ).update(numeros)

        print(
            "API JSON:",
            slug,
            "episodios:",
            len(numeros)
        )

    resultado = []

    for slug, numeros in sorted(
        encontrados.items()
    ):
        for numero in sorted(numeros):
            resultado.append({
                "id": "na:" + slug,
                "season": 1,
                "episode": numero
            })

    OUTPUT.write_text(
        json.dumps(
            {"episodes": resultado},
            ensure_ascii=False,
            indent=2
        ) + "\n",
        encoding="utf-8"
    )

    print("============================")
    print("DETECCION FINALIZADA")
    print("Series:", len(encontrados))
    print("Episodios:", len(resultado))
    print("============================")


if __name__ == "__main__":
    main()
