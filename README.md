# Nuvio Anime — solo GitHub

Addon estático con protocolo tipo Stremio, construido con Python y publicado mediante GitHub Actions + Pages. Cada 12 horas (UTC) vuelve a consultar las fuentes autorizadas.

## Instalación

1. Copia TODOS los archivos de este paquete respetando las carpetas a la rama `main`.
2. En **Settings → Pages → Build and deployment**, configura **GitHub Actions**.
3. Ve a **Actions → Actualizar anime y publicar → Run workflow**.
4. Prueba `https://Yahir9.github.io/nuvio-anime/manifest.json` en el navegador.
5. Instala la URL del manifiesto en Nuvio si tu versión admite addons de protocolo Stremio desde GitHub Pages.

## Fuentes

`sources.json` tiene inicialmente `{"sources": []}`. El catálogo quedará vacío hasta añadir fuentes reales y autorizadas. Admite listas M3U con `group-title="Anime"` y `tvg-id="slug:episodio"`, y feeds JSON con el esquema siguiente:

```json
{
  "animes": [{
    "id": "serie-a",
    "name": "Serie A",
    "description": "Descripción",
    "episodes": [{
      "season": 1,
      "episode": 1,
      "streams": [{"name": "HLS", "url": "https://ejemplo-autorizado.com/video.m3u8"}]
    }]
  }]
}
```

Configura las URLs **públicas autorizadas** en `sources.json`:

```json
{
  "sources": [
    {"type": "json", "url": "https://ejemplo-autorizado.com/catalogo.json"},
    {"type": "m3u", "url": "https://ejemplo-autorizado.com/lista.m3u"}
  ]
}
```

Una página HTML no es directamente una fuente de video. Si dispones de acceso oficial a una API o a un feed autorizado, podemos agregar posteriormente un adaptador específico. Las fuentes con tokens de corta duración requieren actualización antes de su caducidad, o un servicio dinámico fuera de GitHub Pages.

## Limitaciones

- El cron se interpreta en UTC (00:17 y 12:17 UTC): en Guadalajara equivale normalmente a 18:17 y 06:17 del día correspondiente; GitHub puede retrasar ejecuciones.
- GitHub Pages publica archivos estáticos, no reproduce páginas HTML ni ejecuta búsquedas dinámicas.
- Solo acepta feeds públicos HTTPS; no coloques tokens privados en `sources.json`.
- Si fallan todas las fuentes y hay catálogo previamente generado en el repositorio, se conserva. Con despliegue exclusivamente mediante Pages, para conservarlo entre runs hay que guardar el resultado generado en una rama o recuperar el despliegue anterior; este proyecto **no garantiza aún esa persistencia**.
- El soporte de rutas de streams, URLs y CORS depende del cliente Nuvio.
