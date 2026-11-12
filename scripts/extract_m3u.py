
#!/usr/bin/env python3
# Nuvio Anime - Extractor Desu / Magi / HLS
# Lee archivos locales sin consultar JKAnime.
# Detecta URLs directas, Base64 y var servers.

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
SERVER_REPORT = DATA / "detected_servers.json"

MEDIA_EXT = (".m3u8", ".mp4", ".mpd")

FILE_PATTERN = re.compile(
    r"^([a-z0-9][a-z0-9-]*)-(\d+)-(\d+)$"
)

URL_PATTERN = re.compile(
    r"""https?://[^\s"'<>\\]+""",
    re.IGNORECASE
)

BASE64_PATTERN = re.compile(
    r"""atob\s*\(\s*['"]([A-Za-z0-9+/=]+)['"]\s*\)""",
    re.IGNORECASE
)

SERVERS_PATTERN = re.compile(
    r"var\s+servers\s*=\s*(\[[^\n;]*\])\s*;?",
    re.IGNORECASE
)


def guardar(ruta, contenido):
    ruta.parent.mkdir(
        parents=True,
        exist_ok=True
    )

    ruta.write_text(
        json.dumps(
            contenido,
            indent=2,
            ensure_ascii=False
        ) + "\n",
        encoding="utf-8"
    )


def normalizar(texto):
    return html.unescape(
        texto.replace("\\/", "/")
    )


def url_valida(url, multimedia=False):
    if not isinstance(url, str):
        return False

    try:
        p = urlparse(url)

        if p.scheme != "https" or not p.hostname:
            return False

        if p.username or p.password:
            return False

        if multimedia:
            return p.path.lower().endswith(
                MEDIA_EXT
            )

        return True

    except ValueError:
        return False


def url_vigente(url):
    if not url_valida(url, multimedia=True):
        return False

    query = parse_qs(urlparse(url).query)
    expira = query.get("e", [])

    if expira:
        try:
            ahora = int(
                datetime.now(timezone.utc).timestamp()
            )

            return int(expira[0]) > ahora + 300

        except (TypeError, ValueError, IndexError):
            return False

    return True


def buscar_urls(texto):
    encontrados = set()
    texto = normalizar(texto)

    for candidato in URL_PATTERN.findall(texto):
        url = candidato.rstrip(
            ');,}]\r\n'
        )

        if url_valida(url, multimedia=True):
            encontrados.add(url)

    return encontrados


def decodificar_base64(texto):
    try:
        return base64.b64decode(
            texto,
            validate=True
        ).decode("utf-8").strip()

    except (
        ValueError,
        UnicodeDecodeError
    ):
        return None


def buscar_base64(contenido):
    encontrados = set()

    for valor in BASE64_PATTERN.findall(contenido):
        decodificado = decodificar_base64(valor)

        if decodificado:
            encontrados.update(
                buscar_urls(decodificado)
            )

    return encontrados


def detectar_servers(contenido):
    resultados = []
    contenido = normalizar(contenido)

    for coincidencia in SERVERS_PATTERN.finditer(
        contenido
    ):
        try:
            servidores = json.loads(
                coincidencia.group(1)
            )
        except (ValueError, TypeError):
            continue

        if not isinstance(servidores, list):
            continue

        for servidor in servidores:
            if not isinstance(servidor, dict):
                continue

            remote = servidor.get("remote", "")
            direccion = decodificar_base64(remote)

            if not direccion:
                continue

            if not url_valida(direccion):
                continue

            resultados.append({
                "server": str(
                    servidor.get("server", "Servidor")
                ),
                "lang": servidor.get("lang"),
                "url": direccion,
                "direct": url_valida(
                    direccion,
                    multimedia=True
                )
            })

    return resultados


def datos_archivo(ruta):
    coincidencia = FILE_PATTERN.fullmatch(
        ruta.stem.lower()
    )

    if not coincidencia:
        return None

    slug = coincidencia.group(1)
    season = int(coincidencia.group(2))
    episode = int(coincidencia.group(3))

    if not 1 <= season <= 100:
        return None

    if not 1 <= episode <= 10000:
        return None

    return slug, season, episode


def procesar(ruta):
    datos = datos_archivo(ruta)

    if not datos:
        print("Archivo omitido:", ruta.name)
        return [], []

    slug, season, episode = datos

    contenido = ruta.read_text(
        encoding="utf-8",
        errors="replace"
    )

    # URLs HLS visibles en HTML y JavaScript
    encontradas = buscar_urls(contenido)

    # URLs ocultas mediante atob()
    encontradas.update(
        buscar_base64(contenido)
    )

    # Lista var servers de JKAnime
    servidores = detectar_servers(contenido)

    reporte = []

    for servidor in servidores:
        reporte.append({
            "anime": slug,
            "season": season,
            "episode": episode,
            **servidor
        })

        # Solo aceptar fuentes multimedia directas.
        # Un iframe HTML no es un stream de Nuvio.
        if servidor["direct"]:
            encontradas.add(servidor["url"])

    vigentes = sorted(
        url for url in encontradas
        if url_vigente(url)
    )

    print("-----------------------------")
    print("Archivo:", ruta.name)
    print("Anime:", slug)
    print("Episodio:", episode)
    print("Servidores detectados:", len(servidores))
    print("Multimedia encontrada:", len(encontradas))
    print("Enlaces vigentes:", len(vigentes))

    fuentes = []

    for url in vigentes:
        fuentes.append({
            "type": "direct",
            "id": slug,
            "name": "Desu HTML",
            "season": season,
            "episode": episode,
            "url": url,
            "enabled": True
        })

    return fuentes, reporte


def main():
    HTML_DIR.mkdir(
        parents=True,
        exist_ok=True
    )

    archivos = sorted([
        *HTML_DIR.glob("*.html"),
        *HTML_DIR.glob("*.txt")
    ])

    fuentes = []
    servidores = []
    vistos = set()
    episodios_con_fuente = set()

    print("============================")
    print("NUVIO ANIME - EXTRACTOR V3")
    print("Archivos HTML:", len(archivos))
    print("============================")

    for archivo in archivos:
        nuevas, reporte = procesar(archivo)

        servidores.extend(reporte)

        for fuente in nuevas:
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

    guardar(
        OUTPUT,
        {"sources": fuentes}
    )

    guardar(
        SERVER_REPORT,
        {"servers": servidores}
    )

    print("============================")
    print("RESULTADOS")
    print("HTML procesados:", len(archivos))
    print("Servidores encontrados:", len(servidores))
    print(
        "Episodios con fuente:",
        len(episodios_con_fuente)
    )
    print("Fuentes vigentes:", len(fuentes))
    print("============================")


if __name__ == "__main__":
    main()
