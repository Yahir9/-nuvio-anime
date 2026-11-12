
#!/usr/bin/env python3
# Nuvio Anime - Generador de catalogo estatico
# Compatible con GitHub Actions y GitHub Pages

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
        with open(ruta, "r", encoding="utf-8") as archivo:
            return json.load(archivo)
    except (OSError, ValueError):
        return defecto


def guardar(ruta, datos):
    destino = PUBLIC / ruta
    destino.parent.mkdir(parents=True, exist_ok=True)

    with open(destino, "w", encoding="utf-8") as archivo:
        json.dump(
            datos,
            archivo,
            ensure_ascii=False,
            indent=2
        )
        archivo.write("\n")


def slug_valido(texto):
    return bool(
        re.fullmatch(r"[a-z0-9][a-z0-9-]*", texto)
    )


def url_valida(url, video=False):
    if not isinstance(url, str):
        return False

    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()

    if parsed.scheme != "https" or not host:
        return False

    if parsed.username or parsed.password:
        return False

    if host in ("localhost", "127.0.0.1", "::1"):
        return False

    if host.endswith((".local", ".internal")):
        return False

    if video and not parsed.path.lower().endswith(MEDIA_EXT):
        return False

    return True


def stream_vigente(url):
    if not url_valida(url, video=True):
        return False

    parametros = parse_qs(urlparse(url).query)
    vencimiento = parametros.get("e", [])

    if vencimiento:
        try:
            limite = int(vencimiento[0])
            ahora = int(
                datetime.now(timezone.utc).timestamp()
            )

            # Exigir al menos cinco minutos de vigencia
            if limite <= ahora + 300:
                return False

        except (ValueError, IndexError):
            return False

    return True


def catalogo_importado():
    registros = {}

    if not DATA.exists():
        print("AVISO: No existe la carpeta data")
        return registros

    archivos = sorted(DATA.glob("anime-pagina-*.json"))

    print("Archivos de catalogo:", len(archivos))

    for ruta in archivos:
        documento = leer_json(ruta)
        animes = documento.get("metas", [])

        if not isinstance(animes, list):
            continue

        agregados = 0

        for anime in animes:
            if not isinstance(anime, dict):
                continue

            identificador = anime.get("id", "")

            if not identificador.startswith("na:"):
                continue

            slug = identificador[3:]

            if not slug_valido(slug):
                continue

            nombre = str(anime.get("name", "")).strip()

            if not nombre:
                continue

            ficha = {
                "id": identificador,
                "type": "series",
                "name": nombre
            }

            poster = anime.get("poster")

            if url_valida(poster):
                ficha["poster"] = poster

            descripcion = anime.get("description")

            if descripcion:
                ficha["description"] = str(descripcion)

            registros[identificador] = ficha
            agregados += 1

        print(
            "Importado:",
            ruta.name,
            "-",
            agregados,
            "registros"
        )

    return registros


def agregar_fuentes(catalogo):
    configuracion = leer_json(
        ROOT / "sources.json",
        {"sources": []}
    )

    fuentes = configuracion.get("sources", [])

    if not isinstance(fuentes, list):
        raise ValueError("sources debe ser una lista")

    episodios = {}
    streams = {}

    for fuente in fuentes:
        if not isinstance(fuente, dict):
            continue

        if not fuente.get("enabled", True):
            continue

        tipo = fuente.get("type")

        # Los HTML no se consultan: JKAnime bloquea
        # las solicitudes de GitHub Actions con 403.
        if tipo not in ("direct", "html"):
            print("Fuente no configurada:", tipo)
            continue

        slug = fuente.get("id", "")

        if not slug_valido(slug):
            continue

        identificador = "na:" + slug

        if identificador not in catalogo:
            catalogo[identificador] = {
                "id": identificador,
                "type": "series",
                "name": fuente.get("name", slug)
            }

        try:
            temporada = int(fuente.get("season", 1))
            numero = int(fuente.get("episode", 1))
        except (ValueError, TypeError):
            continue

        if temporada < 1 or numero < 1:
            continue

        video_id = (
            f"{identificador}:{temporada}:{numero}"
        )

        episodios.setdefault(identificador, {})

        episodios[identificador][video_id] = {
            "id": video_id,
            "title": f"Episodio {numero}",
            "season": temporada,
            "episode": numero
        }

        streams.setdefault(video_id, [])

        if tipo != "direct":
            continue

        variable = fuente.get("url_env", "")

        if variable:
            url = os.getenv(variable, "")
        else:
            url = fuente.get("url", "")

        if not stream_vigente(url):
            print(
                "AVISO: Fuente HLS vencida o ausente:",
                video_id
            )
            continue

        if not any(
            stream["url"] == url
            for stream in streams[video_id]
        ):
            streams[video_id].append({
                "name": "HLS",
                "title": "Fuente autorizada",
                "url": url
            })

    return episodios, streams


def generar():
    print("Iniciando Nuvio Anime")

    PUBLIC.mkdir(parents=True, exist_ok=True)

    catalogo = catalogo_importado()

    episodios, streams = agregar_fuentes(catalogo)

    if not catalogo:
        raise RuntimeError(
            "No se encontraron animes para publicar"
        )

    # Orden alfabetico
    metas = sorted(
        catalogo.values(),
        key=lambda anime: anime["name"].casefold()
    )

    # Crear catalogo paginado
    for inicio in range(0, len(metas), 100):
        if inicio == 0:
            ruta = "catalog/series/anime.json"
        else:
            ruta = (
                f"catalog/series/anime/skip={inicio}.json"
            )

        guardar(ruta, {
            "metas": metas[inicio:inicio + 100]
        })

    # Crear fichas individuales y streams
    for anime in metas:
        identificador = anime["id"]

        lista_episodios = list(
            episodios.get(identificador, {}).values()
        )

        lista_episodios.sort(
            key=lambda video: (
                video["season"],
                video["episode"]
            )
        )

        ficha = {
            **anime,
            "videos": lista_episodios
        }

        guardar(
            f"meta/series/{identificador}.json",
            {"meta": ficha}
        )

        for video in lista_episodios:
            video_id = video["id"]

            guardar(
                f"stream/series/{video_id}.json",
                {
                    "streams": streams.get(video_id, [])
                }
            )

    # Publicar manifiesto
    manifiesto = leer_json(ROOT / "manifest.json")

    if not manifiesto:
        raise RuntimeError("Falta manifest.json")

    guardar("manifest.json", manifiesto)

    # Evitar procesamiento Jekyll en Pages
    (PUBLIC / ".nojekyll").touch()

    total_streams = sum(
        len(lista) for lista in streams.values()
    )

    print("-------------------------------")
    print("Animes:", len(metas))
    print(
        "Episodios:",
        sum(len(lista) for lista in episodios.values())
    )
    print("Streams vigentes:", total_streams)
    print("Catalogo JSON generado")
    print("Generacion finalizada")
    print("-------------------------------")


if __name__ == "__main__":
    generar()
