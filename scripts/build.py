
#!/usr/bin/env python3
# Nuvio Anime - Catalogo, episodios y streams

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
    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_text(
        json.dumps(datos, ensure_ascii=False, indent=2)
        + "\n",
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
    valor = query.get("e", [])

    if valor:
        try:
            limite = int(valor[0])
            ahora = int(
                datetime.now(timezone.utc).timestamp()
            )
            return limite > ahora + 300
        except (TypeError, ValueError, IndexError):
            return False

    return True


def obtener_catalogo():
    catalogo = {}

    for archivo in sorted(
        DATA.glob("anime-pagina-*.json")
    ):
        datos = leer(archivo, {"metas": []})

        for anime in datos.get("metas", []):
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

            if not isinstance(nombre, str) or not nombre:
                continue

            ficha = {
                "id": ident,
                "type": "series",
                "name": nombre
            }

            for campo in ("poster", "background"):
                valor = anime.get(campo)
                if url_valida(valor):
                    ficha[campo] = valor

            descripcion = anime.get("description")

            if isinstance(descripcion, str):
                ficha["description"] = descripcion

            catalogo[ident] = ficha

    return catalogo


def registrar_episodio(episodios, ident, temporada, numero):
    try:
        temporada = int(temporada)
        numero = int(numero)
    except (ValueError, TypeError):
        return None

    if not (1 <= temporada <= 100):
        return None

    if not (1 <= numero <= 10000):
        return None

    video_id = f"{ident}:{temporada}:{numero}"

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

        # Solo importar series existentes
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

    print("Episodios importados desde HTML:", nuevos)


def importar_fuentes(catalogo, episodios):
    originales = leer(
        ROOT / "sources.json",
        {"sources": []}
    ).get("sources", [])

    extraidas = leer(
        DATA / "extracted_sources.json",
        {"sources": []}
    ).get("sources", [])

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

        # Mantener la serie de prueba existente
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

        # HTML identifica episodios,
        # pero no es una fuente reproducible.
        if tipo != "direct":
            continue

        variable = fuente.get("url_env")

        if variable:
            url = os.getenv(variable, "")
        else:
            url = fuente.get("url", "")

        if not fuente_vigente(url):
            print("Fuente ausente o vencida:", video_id)
            continue

        streams.setdefault(video_id, [])

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

    return streams


def generar():
    print("=== NUVIO ANIME ===")

    PUBLIC.mkdir(parents=True, exist_ok=True)

    catalogo = obtener_catalogo()
    episodios = {}

    # Incorporar episodios detectados
    importar_episodios(catalogo, episodios)

    # Mantener Desu HTML y HLS original
    streams = importar_fuentes(catalogo, episodios)

    if not catalogo:
        raise RuntimeError("El catalogo esta vacio")

    metas = sorted(
        catalogo.values(),
        key=lambda x: x["name"].casefold()
    )

    # Catalogo
    for inicio in range(0, len(metas), 100):
        ruta = (
            "catalog/series/anime.json"
            if inicio == 0
            else f"catalog/series/anime/skip={inicio}.json"
        )

        guardar(
            ruta,
            {"metas": metas[inicio:inicio + 100]}
        )

    # Metadatos y streams de cada episodio
    for anime in metas:
        ident = anime["id"]

        videos = list(
            episodios.get(ident, {}).values()
        )

        videos.sort(
            key=lambda x: (x["season"], x["episode"])
        )

        guardar(
            f"meta/series/{ident}.json",
            {"meta": {**anime, "videos": videos}}
        )

        for video in videos:
            video_id = video["id"]

            guardar(
                f"stream/series/{video_id}.json",
                {"streams": streams.get(video_id, [])}
            )

    manifest = leer(ROOT / "manifest.json", {})

    if not manifest:
        raise RuntimeError("Falta manifest.json")

    guardar("manifest.json", manifest)
    (PUBLIC / ".nojekyll").touch()

    print("Animes:", len(metas))
    print(
        "Episodios:",
        sum(len(x) for x in episodios.values())
    )
    print(
        "Streams vigentes:",
        sum(len(x) for x in streams.values())
    )
    print("Catalogo generado correctamente")


if __name__ == "__main__":
    generar()
