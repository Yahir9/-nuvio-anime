
#!/usr/bin/env python3
# Nuvio Anime - Catalogo, episodios y reproduccion
# GitHub Actions + GitHub Pages

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
PUBLIC = ROOT / "public"

MEDIA = (".m3u8", ".mp4", ".mpd", ".mkv")
SLUG = re.compile(r"[a-z0-9][a-z0-9-]*")


def leer(ruta, defecto):
    try:
        return json.loads(
            Path(ruta).read_text(encoding="utf-8")
        )
    except (OSError, ValueError):
        return defecto


def guardar(ruta, datos):
    destino = PUBLIC / ruta
    destino.parent.mkdir(
        parents=True,
        exist_ok=True
    )

    destino.write_text(
        json.dumps(
            datos,
            ensure_ascii=False,
            indent=2
        ) + "\n",
        encoding="utf-8"
    )


def url_valida(url, media=False):
    if not isinstance(url, str):
        return False

    try:
        p = urlparse(url)
        host = (p.hostname or "").lower()

        if p.scheme != "https" or not host:
            return False

        if p.username or p.password:
            return False

        if host in ("localhost", "127.0.0.1", "::1"):
            return False

        if host.endswith((".local", ".internal")):
            return False

        if media and not p.path.lower().endswith(MEDIA):
            return False

        return True

    except ValueError:
        return False


def fuente_vigente(url):
    if not url_valida(url, media=True):
        return False

    query = parse_qs(urlparse(url).query)
    vencimiento = query.get("e", [])

    if vencimiento:
        try:
            limite = int(vencimiento[0])
            ahora = int(
                datetime.now(timezone.utc).timestamp()
            )

            return limite > ahora + 300

        except (ValueError, TypeError, IndexError):
            return False

    return True


def obtener_catalogo():
    catalogo = {}

    archivos = sorted(
        DATA.glob("anime-pagina-*.json")
    )

    print("Archivos de catalogo:", len(archivos))

    for archivo in archivos:
        datos = leer(archivo, {"metas": []})
        animes = datos.get("metas", [])

        if not isinstance(animes, list):
            continue

        agregados = 0

        for anime in animes:
            if not isinstance(anime, dict):
                continue

            ident = anime.get("id", "")
            nombre = anime.get("name", "")

            if not isinstance(ident, str):
                continue

            if not ident.startswith("na:"):
                continue

            if not SLUG.fullmatch(ident[3:]):
                continue

            if not isinstance(nombre, str) or not nombre.strip():
                continue

            ficha = {
                "id": ident,
                "type": "series",
                "name": nombre.strip()
            }

            for campo in ("poster", "background"):
                valor = anime.get(campo)

                if url_valida(valor):
                    ficha[campo] = valor

            descripcion = anime.get("description")

            if isinstance(descripcion, str):
                ficha["description"] = descripcion

            catalogo[ident] = ficha
            agregados += 1

        print(
            "Importado:",
            archivo.name,
            "-",
            agregados,
            "registros"
        )

    return catalogo


def registrar_episodio(
    episodios,
    ident,
    temporada,
    numero
):
    try:
        temporada = int(temporada)
        numero = int(numero)

    except (ValueError, TypeError):
        return None

    if not 1 <= temporada <= 100:
        return None

    if not 1 <= numero <= 10000:
        return None

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

    return video_id


def importar_episodios(catalogo, episodios):
    datos = leer(
        DATA / "episodes.json",
        {"episodes": []}
    )

    nuevos = 0

    for item in datos.get("episodes", []):
        if not isinstance(item, dict):
            continue

        ident = item.get("id")

        # Solo agregar episodios a animes existentes
        if ident not in catalogo:
            continue

        video_id = registrar_episodio(
            episodios,
            ident,
            item.get("season", 1),
            item.get("episode")
        )

        if video_id:
            nuevos += 1

    print(
        "Episodios importados desde HTML:",
        nuevos
    )


def importar_fuentes(catalogo, episodios):
    originales = leer(
        ROOT / "sources.json",
        {"sources": []}
    ).get("sources", [])

    extraidas = leer(
        DATA / "extracted_sources.json",
        {"sources": []}
    ).get("sources", [])

    if not isinstance(originales, list):
        originales = []

    if not isinstance(extraidas, list):
        extraidas = []

    fuentes = originales + extraidas
    streams = {}

    print("Fuentes configuradas:", len(originales))
    print("Fuentes extraidas:", len(extraidas))

    for fuente in fuentes:
        if not isinstance(fuente, dict):
            continue

        if not fuente.get("enabled", True):
            continue

        tipo = fuente.get("type")
        slug = fuente.get("id", "")

        if tipo not in ("direct", "html"):
            continue

        if not isinstance(slug, str):
            continue

        if not SLUG.fullmatch(slug):
            continue

        ident = "na:" + slug

        # Registrar series que no esten en el catalogo
        if ident not in catalogo:
            catalogo[ident] = {
                "id": ident,
                "type": "series",
                "name": fuente.get("name", slug)
            }

        video_id = registrar_episodio(
            episodios,
            ident,
            fuente.get("season", 1),
            fuente.get("episode", 1)
        )

        if video_id is None:
            continue

        # Un HTML registra un episodio,
        # pero no es una fuente de video.
        if tipo != "direct":
            continue

        variable = fuente.get("url_env")

        if variable:
            url = os.getenv(variable, "")
        else:
            url = fuente.get("url", "")

        if not fuente_vigente(url):
            print(
                "Fuente ausente o vencida:",
                video_id
            )
            continue

        streams.setdefault(video_id, [])

        # No repetir el mismo enlace
        if any(
            item["url"] == url
            for item in streams[video_id]
        ):
            continue

        streams[video_id].append({
            "name": fuente.get("name", "HLS"),
            "title": "Reproduccion directa",
            "url": url
        })

        print("Stream agregado:", video_id)

    return streams


def generar():
    print("==============================")
    print("INICIANDO NUVIO ANIME")
    print("==============================")

    PUBLIC.mkdir(
        parents=True,
        exist_ok=True
    )

    catalogo = obtener_catalogo()
    episodios = {}

    # IMPORTANTE:
    # Primero registrar fuentes y el anime
    # Meitantei Precure!
    streams = importar_fuentes(
        catalogo,
        episodios
    )

    # Despues incorporar los episodios HTML
    importar_episodios(
        catalogo,
        episodios
    )

    if not catalogo:
        raise RuntimeError(
            "No se encontraron animes"
        )

    metas = sorted(
        catalogo.values(),
        key=lambda x: x["name"].casefold()
    )

    # Generar catalogo
    for inicio in range(
        0,
        len(metas),
        100
    ):
        if inicio == 0:
            ruta = "catalog/series/anime.json"
        else:
            ruta = (
                "catalog/series/anime/"
                f"skip={inicio}.json"
            )

        guardar(
            ruta,
            {"metas": metas[inicio:inicio + 100]}
        )

    # Crear fichas de animes y episodios
    for anime in metas:
        ident = anime["id"]

        videos = list(
            episodios.get(ident, {}).values()
        )

        videos.sort(
            key=lambda x: (
                x["season"],
                x["episode"]
            )
        )

        guardar(
            f"meta/series/{ident}.json",
            {
                "meta": {
                    **anime,
                    "videos": videos
                }
            }
        )

        # Crear fuentes para cada episodio
        for video in videos:
            video_id = video["id"]

            guardar(
                f"stream/series/{video_id}.json",
                {
                    "streams": streams.get(
                        video_id,
                        []
                    )
                }
            )

    # Publicar manifiesto
    manifest = leer(
        ROOT / "manifest.json",
        {}
    )

    if not manifest:
        raise RuntimeError(
            "No se encontro manifest.json"
        )

    guardar(
        "manifest.json",
        manifest
    )

    # GitHub Pages
    (PUBLIC / ".nojekyll").touch()

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
