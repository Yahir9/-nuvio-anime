
#!/usr/bin/env python3
# Nuvio Anime - Extractor HTML local
# Detecta HLS directos y codificados en Base64
# No necesita acceso web ni servidores adicionales

import base64
import html
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse, parse_qs

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
HTML_DIR = DATA / "html"
OUTPUT = DATA / "extracted_sources.json"

EXTENSIONS = (".m3u8", ".mp4", ".mpd")

# Formato de nombre:
# anime-slug-1-40.html
# donde 1 = temporada y 40 = episodio

FILENAME_PATTERN = re.compile(
    r"^([a-z0-9][a-z0-9-]*)-(\d+)-(\d+)$"
)

URL_PATTERN = re.compile(
    r'https?://[^\s"\'<>\\]+',
    re.IGNORECASE
)

ATOB_PATTERN = re.compile(
    r"""atob\s*\(\s*['"]([A-Za-z0-9+/=]+)['"]\s*\)""",
    re.IGNORECASE
)


def media_valida(url):
    try:
        parsed = urlparse(url)

        if parsed.scheme != "https":
            return False

        if not parsed.hostname:
            return False

        if parsed.username or parsed.password:
            return False

        return parsed.path.lower().endswith(EXTENSIONS)

    except ValueError:
        return False


def enlace_vigente(url):
    if not media_valida(url):
        return False

    query = parse_qs(urlparse(url).query)
    expiracion = query.get("e", [])

    if expiracion:
        try:
            limite = int(expiracion[0])
            ahora = int(
                datetime.now(timezone.utc).timestamp()
            )

            # Margen de seguridad de 5 minutos
            return limite > ahora + 300

        except (ValueError, IndexError):
            return False

    return True


def normalizar(texto):
    return html.unescape(
        texto.replace("\\/", "/")
    )


def buscar_urls(texto):
    encontrados = set()
    texto = normalizar(texto)

    for coincidencia in URL_PATTERN.findall(texto):
        url = coincidencia.rstrip(");,}]")

        if media_valida(url):
            encontrados.add(url)

    return encontrados


def extraer_base64(texto):
    encontrados = set()

    for codificado in ATOB_PATTERN.findall(texto):
        try:
            decoded = base64.b64decode(
                codificado,
                validate=True
            ).decode("utf-8")

            encontrados.update(
                buscar_urls(decoded)
            )

        except (
            ValueError,
            UnicodeDecodeError
        ):
            continue

    return encontrados


def extraer_de_html(contenido):
    encontrados = set()

    # Detectar URLs visibles en HTML y JavaScript
    encontrados.update(
        buscar_urls(contenido)
    )

    # Detectar atob('URL_EN_BASE64')
    encontrados.update(
        extraer_base64(contenido)
    )

    return sorted(encontrados)


def procesar_archivo(ruta):
    nombre = ruta.stem.lower()
    match = FILENAME_PATTERN.fullmatch(nombre)

    if not match:
        print(
            "Nombre de archivo invalido:",
            ruta.name
        )
        return []

    slug = match.group(1)
    temporada = int(match.group(2))
    episodio = int(match.group(3))

    if temporada < 1 or episodio < 1:
        print("Temporada o episodio invalido")
        return []

    contenido = ruta.read_text(
        encoding="utf-8",
        errors="replace"
    )

    encontrados = extraer_de_html(contenido)

    vigentes = [
        url for url in encontrados
        if enlace_vigente(url)
    ]

    video_id = (
        f"na:{slug}:{temporada}:{episodio}"
    )

    print("-----------------------------")
    print("Archivo:", ruta.name)
    print("Episodio:", video_id)
    print("URLs detectadas:", len(encontrados))
    print("URLs vigentes:", len(vigentes))

    fuentes = []

    for url in vigentes:
        fuentes.append({
            "type": "direct",
            "id": slug,
            "name": "Desu HTML",
            "season": temporada,
            "episode": episodio,
            "url": url,
            "enabled": True
        })

    return fuentes


def main():
    DATA.mkdir(
        parents=True,
        exist_ok=True
    )

    HTML_DIR.mkdir(
        parents=True,
        exist_ok=True
    )

    archivos = sorted(
        list(HTML_DIR.glob("*.html"))
        + list(HTML_DIR.glob("*.txt"))
    )

    print("============================")
    print("NUVIO ANIME - EXTRACTOR HTML")
    print("Archivos encontrados:", len(archivos))
    print("============================")

    fuentes = []
    duplicados = set()

    for ruta in archivos:
        for fuente in procesar_archivo(ruta):
            key = (
                fuente["id"],
                fuente["season"],
                fuente["episode"],
                fuente["url"]
            )

            if key in duplicados:
                continue

            duplicados.add(key)
            fuentes.append(fuente)

    OUTPUT.write_text(
        json.dumps(
            {"sources": fuentes},
            ensure_ascii=False,
            indent=2
        ) + "\n",
        encoding="utf-8"
    )

    print("============================")
    print("Fuentes nuevas:", len(fuentes))
    print("Archivo generado:")
    print("data/extracted_sources.json")
    print("============================")


if __name__ == "__main__":
    main()
