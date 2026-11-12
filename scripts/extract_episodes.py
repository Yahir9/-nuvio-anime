
#!/usr/bin/env python3
# Nuvio Anime - Detector de episodios desde HTML local
# No realiza solicitudes de red

import html
import json
import re
from pathlib import Path
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
INPUT = ROOT / "data" / "episodes-html"
OUTPUT = ROOT / "data" / "episodes.json"

BASE = "https://jkanime.net/"
SLUG = re.compile(r"[a-z0-9][a-z0-9-]*")
MAX_EPISODE = 10000


def numero_de_enlace(enlace, slug):
    if not isinstance(enlace, str):
        return None

    enlace = html.unescape(
        enlace.replace("\\/", "/")
    )

    url = urlparse(urljoin(BASE, enlace))

    if url.scheme not in ("http", "https"):
        return None

    if (url.hostname or "").lower() not in (
        "jkanime.net",
        "www.jkanime.net"
    ):
        return None

    patron = rf"/{re.escape(slug)}/(\d+)/?"
    match = re.fullmatch(patron, url.path)

    if not match:
        return None

    numero = int(match.group(1))

    if 1 <= numero <= MAX_EPISODE:
        return numero

    return None


def detectar_episodios(texto, slug):
    resultados = set()

    soup = BeautifulSoup(texto, "html.parser")

    # Enlaces normales dentro de la pagina
    for etiqueta in soup.select("a[href]"):
        numero = numero_de_enlace(
            etiqueta.get("href", ""),
            slug
        )

        if numero is not None:
            resultados.add(numero)

    # Enlaces insertados en scripts JavaScript
    texto = html.unescape(
        texto.replace("\\/", "/")
    )

    patron = (
        rf"(?:https?://(?:www\.)?jkanime\.net)?"
        rf"/{re.escape(slug)}/(\d+)/?"
        rf"(?=[\s\"'<>?\\]|$)"
    )

    for match in re.finditer(
        patron, texto, flags=re.IGNORECASE
    ):
        numero = int(match.group(1))

        if 1 <= numero <= MAX_EPISODE:
            resultados.add(numero)

    return sorted(resultados)


def main():
    INPUT.mkdir(parents=True, exist_ok=True)
    OUTPUT.parent.mkdir(
        parents=True,
        exist_ok=True
    )

    archivos = sorted(
        list(INPUT.glob("*.html"))
        + list(INPUT.glob("*.txt"))
    )

    episodios = {}
    print("=== DETECTOR DE EPISODIOS ===")
    print("Archivos HTML:", len(archivos))

    for archivo in archivos:
        slug = archivo.stem.lower()

        if not SLUG.fullmatch(slug):
            print("Archivo omitido:", archivo.name)
            continue

        texto = archivo.read_text(
            encoding="utf-8",
            errors="replace"
        )

        numeros = detectar_episodios(texto, slug)
        identificador = "na:" + slug

        episodios.setdefault(identificador, set())
        episodios[identificador].update(numeros)

        print(
            slug,
            "- episodios encontrados:",
            len(numeros)
        )

    lista = []

    for identificador in sorted(episodios):
        for numero in sorted(episodios[identificador]):
            lista.append({
                "id": identificador,
                "season": 1,
                "episode": numero
            })

    OUTPUT.write_text(
        json.dumps(
            {"episodes": lista},
            ensure_ascii=False,
            indent=2
        ) + "\n",
        encoding="utf-8"
    )

    print("Total episodios detectados:", len(lista))
    print("Archivo generado: data/episodes.json")


if __name__ == "__main__":
    main()
