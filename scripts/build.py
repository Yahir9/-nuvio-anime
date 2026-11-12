
#!/usr/bin/env python3
# Nuvio Anime - Catalogo y reproduccion automatica
# GitHub Actions + GitHub Pages
# Sin servidores externos propios

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse, parse_qs

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
PUBLIC = ROOT / "public"

MEDIA_EXT = (".m3u8", ".mp4", ".mpd", ".mkv")


def leer_json(ruta, defecto=None):
    if defecto is None:
        defecto = {}

    try:
        with open(ruta, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return defecto


def guardar(ruta, datos):
    destino = PUBLIC / ruta
    destino.parent.mkdir(
        parents=True,
        exist_ok=True
    )

    with open(destino, "w", encoding="utf-8") as f:
        json.dump(
            datos,
            f,
            ensure_ascii=False,
            indent=2
        )
        f.write("\n")


def slug_valido(texto):
    return isinstance(texto, str) and bool(
        re.fullmatch(
            r"[a-z0-9][a-z0-9-]*",
            texto
        )
    )


def url_valida(url, video=False):
    if not isinstance(url, str):
        return False

    try:
        p = urlparse(url)
        host = (p.hostname or "").lower()

        if p.scheme != "https" or not host:
            return False

        if p.username or p.password:
            return False

        if host in (
            "localhost",
            "127.0.0.1",
            "::1"
        ):
            return False

        if host.endswith(
            (".local", ".internal")
        ):
            return False

        if video and not p.path.lower().endswith(
            MEDIA_EXT
        ):
            return False

        return True

    except ValueError:
        return False


def stream_vigente(url):
    if not url_valida(url, video=True):
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

            if limite <= ahora + 300:
                return False

        except (ValueError, IndexError):
            return False

    return True


def catalogo_importado():
    registros = {}

    if not DATA.exists():
        print("AVISO: No existe data/")
        return registros

    archivos = sorted(
        DATA.glob("anime-pagina-*.json")
    )

    print(
        "Archivos de catalogo:",
        len(archivos)
    )

    for ruta in archivos:
        documento = leer_json(ruta)

        animes = documento.get(
            "metas", []
        )

        if not isinstance(animes, list):
            continue

        agregados = 0

        for anime in animes:
            if not isinstance(anime, dict):
                continue

            ident = anime.get("id", "")

            if not isinstance(ident, str):
                continue

            if not ident.startswith("na:"):
                continue

            slug = ident[3:]

            if not slug_valido(slug):
                continue

            nombre = str(
                anime.get("name", "")
            ).strip()

            if not nombre:
                continue

            ficha = {
                "id": ident,
                "type": "series",
                "name": nombre
            }

            poster = anime.get("poster")

            if url_valida(poster):
                ficha["poster"] = poster

            descripcion = anime.get(
                "description"
            )

            if descripcion:
                ficha["description"] = str(
                    descripcion
                )

            fondo = anime.get("background")

            if url_valida(fondo):
                ficha["background"] = fondo

            registros[ident] = ficha
            agregados += 1

        print(
            "Importado:",
            ruta.name,
            "-",
            agregados,
            "registros"
        )

    return registros


def cargar_fuentes():
    # Fuentes originales, incluyendo Meitantei
    config = leer_json(
        ROOT / "sources.json",
        {"sources": []}
    )

    originales = config.get(
        "sources", []
    )

    # Enlaces encontrados por extract_m3u.py
    extraidas = leer_json(
        DATA / "extracted_sources.json",
        {"sources": []}
    ).get("sources", [])

    if not isinstance(originales, list):
        originales = []

    if not isinstance(extraidas, list):
        extraidas = []

    print(
        "Fuentes configuradas:",
        len(originales)
    )

    print(
        "Fuentes extraidas:",
        len(extraidas)
    )

    return originales + extraidas


def agregar_fuentes(catalogo):
    fuentes = cargar_fuentes()

    episodios = {}
    streams = {}

    for fuente in fuentes:
        if not isinstance(fuente, dict):
            continue

        if not fuente.get("enabled", True):
            continue

        tipo = fuente.get("type")

        if tipo not in ("direct", "html"):
            continue

        slug = fuente.get("id", "")

        if not slug_valido(slug):
            continue

        ident = "na:" + slug

        # Conservar animes y agregar los faltantes
        if ident not in catalogo:
            catalogo[ident] = {
                "id": ident,
                "type": "series",
                "name": fuente.get(
                    "name", slug
                )
            }

        try:
            temporada = int(
                fuente.get("season", 1)
            )

            numero = int(
                fuente.get("episode", 1)
            )

        except (ValueError, TypeError):
            continue

        if temporada < 1 or numero < 1:
            continue

        video_id = (
            f"{ident}:{temporada}:{numero}"
        )

        episodios.setdefault(ident, {})

        episodios[ident][video_id] = {
            "id": video_id,
            "title": f"Episodio {numero}",
            "season": temporada,
            "episode": numero
        }

        streams.setdefault(video_id, [])

        # Las paginas HTML solo identifican episodios.
        # No son URLs reproducibles directamente.
        if tipo != "direct":
            continue

        variable = fuente.get(
            "url_env", ""
        )

        if variable:
            url = os.getenv(
                variable, ""
            )
        else:
            url = fuente.get(
                "url", ""
            )

        if not stream_vigente(url):
            print(
                "Fuente ausente o vencida:",
                video_id
            )
            continue

        # Evitar enlaces duplicados
        repetido = any(
            item.get("url") == url
            for item in streams[video_id]
        )

        if repetido:
            continue

        nombre_fuente = fuente.get(
            "name", "Fuente HLS"
        )

        streams[video_id].append({
            "name": nombre_fuente,
            "title": "Reproduccion directa",
            "url": url
        })

        print(
            "Stream agregado:",
            video_id
        )

    return episodios, streams


def generar():
    print("==============================")
    print("INICIANDO NUVIO ANIME")
    print("==============================")

    PUBLIC.mkdir(
        parents=True,
        exist_ok=True
    )

    catalogo = catalogo_importado()

    episodios, streams = agregar_fuentes(
        catalogo
    )

    if not catalogo:
        raise RuntimeError(
            "No se encontraron animes"
        )

    metas = sorted(
        catalogo.values(),
        key=lambda anime: (
            anime["name"].casefold()
        )
    )

    # Catalogo principal y paginacion
    for inicio in range(
        0,
        len(metas),
        100
    ):
        if inicio == 0:
            ruta = (
                "catalog/series/anime.json"
            )
        else:
            ruta = (
                "catalog/series/anime/"
                f"skip={inicio}.json"
            )

        guardar(ruta, {
            "metas": metas[
                inicio:inicio + 100
            ]
        })

    # Metadatos y episodios
    for anime in metas:
        ident = anime["id"]

        lista_episodios = list(
            episodios.get(
                ident, {}
            ).values()
        )

        lista_episodios.sort(
            key=lambda ep: (
                ep["season"],
                ep["episode"]
            )
        )

        ficha = {
            **anime,
            "videos": lista_episodios
        }

        guardar(
            f"meta/series/{ident}.json",
            {"meta": ficha}
        )

        # Fuentes de cada episodio
        for episodio in lista_episodios:
            video_id = episodio["id"]

            guardar(
                f"stream/series/{video_id}.json",
                {
                    "streams": streams.get(
                        video_id, []
                    )
                }
            )

    # Manifiesto del addon
    manifest = leer_json(
        ROOT / "manifest.json"
    )

    if not manifest:
        raise RuntimeError(
            "Falta manifest.json"
        )

    guardar(
        "manifest.json",
        manifest
    )

    # Compatibilidad GitHub Pages
    (
        PUBLIC / ".nojekyll"
    ).touch()

    total_episodios = sum(
        len(lista)
        for lista in episodios.values()
    )

    total_streams = sum(
        len(lista)
        for lista in streams.values()
    )

    print("==============================")
    print("CATALOGO GENERADO")
    print("Animes:", len(metas))
    print("Episodios:", total_episodios)
    print("Streams vigentes:", total_streams)
    print("GitHub Pages: preparado")
    print("==============================")


if __name__ == "__main__":
    generar()
