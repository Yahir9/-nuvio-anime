
#!/usr/bin/env python3
# Nuvio Anime - Extractor multiple de reproductores
# Lee archivos HTML locales desde GitHub Actions.
# Identifica enlaces multimedia directos y Base64.
# No necesita Render ni consultar JKAnime.

import base64
import html
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
HTML_DIR = DATA / "html"
OUTPUT = DATA / "extracted_sources.json"

EXTENSIONES = (".m3u8", ".mp4", ".mpd")

PATRON_ARCHIVO = re.compile(
    r"^([a-z0-9][a-z0-9-]*)-(\d+)-(\d+)$"
)

PATRON_URL = re.compile(
    r"""https?://[^\s"'<>\\]+""",
    re.IGNORECASE
)

PATRON_BASE64 = re.compile(
    r"""atob\s*\(\s*['"]([A-Za-z0-9+/=]+)['"]\s*\)""",
    re.IGNORECASE
)


def normalizar(texto):
    return html.unescape(
        texto.replace("\\/", "/")
    )


def url_multimedia(url):
    try:
        parsed = urlparse(url)

        return (
            parsed.scheme == "https"
            and bool(parsed.hostname)
            and not parsed.username
            and not parsed.password
            and parsed.path.lower().endswith(
                EXTENSIONES
            )
        )

    except ValueError:
        return False


def comprobar_vigencia(url):
    if not url_multimedia(url):
        return False

    parametros = parse_qs(
        urlparse(url).query
    )

    vencimiento = parametros.get("e", [])

    if vencimiento:
        try:
            limite = int(vencimiento[0])

            ahora = int(
                datetime.now(
                    timezone.utc
                ).timestamp()
            )

            return limite > ahora + 300

        except (ValueError, IndexError):
            return False

    return True


def encontrar_urls(texto):
    resultados = set()
    texto = normalizar(texto)

    for coincidencia in PATRON_URL.findall(texto):
        url = coincidencia.rstrip(
            ');,}]\r\n'
        )

        if url_multimedia(url):
            resultados.add(url)

    return resultados


def encontrar_base64(texto):
    resultados = set()

    for cadena in PATRON_BASE64.findall(texto):
        try:
            decodificado = base64.b64decode(
                cadena,
                validate=True
            ).decode("utf-8")

            resultados.update(
                encontrar_urls(decodificado)
            )

        except (
            ValueError,
            UnicodeDecodeError
        ):
            continue

    return resultados


def analizar_html(contenido):
    resultados = encontrar_urls(contenido)

    resultados.update(
        encontrar_base64(contenido)
    )

    return sorted(resultados)


def obtener_datos_archivo(archivo):
    nombre = archivo.stem.lower()
    coincidencia = PATRON_ARCHIVO.fullmatch(
        nombre
    )

    if not coincidencia:
        print(
            "Nombre de archivo no valido:",
            archivo.name
        )
        return None

    slug = coincidencia.group(1)
    temporada = int(coincidencia.group(2))
    episodio = int(coincidencia.group(3))

    if not 1 <= temporada <= 100:
        return None

    if not 1 <= episodio <= 10000:
        return None

    return slug, temporada, episodio


def procesar_html(archivo):
    datos = obtener_datos_archivo(archivo)

    if datos is None:
        return []

    slug, temporada, episodio = datos

    contenido = archivo.read_text(
        encoding="utf-8",
        errors="replace"
    )

    urls = analizar_html(contenido)

    vigentes = [
        url for url in urls
        if comprobar_vigencia(url)
    ]

    video_id = (
        f"na:{slug}:{temporada}:{episodio}"
    )

    print("-----------------------------")
    print("Archivo:", archivo.name)
    print("Video:", video_id)
    print("Enlaces encontrados:", len(urls))
    print("Enlaces no vencidos:", len(vigentes))

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
    HTML_DIR.mkdir(
        parents=True,
        exist_ok=True
    )

    archivos = sorted(
        list(HTML_DIR.glob("*.html"))
        + list(HTML_DIR.glob("*.txt"))
    )

    print("============================")
    print("NUVIO - EXTRACCION MULTIPLE")
    print("============================")
    print("Archivos HTML:", len(archivos))

    fuentes = []
    vistos = set()
    episodios_con_fuente = set()

    for archivo in archivos:
        extraidas = procesar_html(archivo)

        for fuente in extraidas:
            clave = (
                fuente["id"],
                fuente["season"],
                fuente["episode"],
                fuente["url"]
            )

            if clave in vistos:
                continue

            vistos.add(clave)
            fuentes.append(fuente)

            episodios_con_fuente.add((
                fuente["id"],
                fuente["season"],
                fuente["episode"]
            ))

    DATA.mkdir(
        parents=True,
        exist_ok=True
    )

    OUTPUT.write_text(
        json.dumps(
            {"sources": fuentes},
            ensure_ascii=False,
            indent=2
        ) + "\n",
        encoding="utf-8"
    )

    print("============================")
    print("RESUMEN FINAL")
    print("HTML analizados:", len(archivos))
    print(
        "Episodios con fuente:",
        len(episodios_con_fuente)
    )
    print("Fuentes HLS:", len(fuentes))
    print(
        "Resultado:",
        "data/extracted_sources.json"
    )
    print("============================")


if __name__ == "__main__":
    main()
