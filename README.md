# JKAnime para Nuvio

Proveedor de Nuvio que busca anime en jkanime.net y devuelve enlaces de video directos.

## Configuración

1. Abre `providers/jkanime.js` y cambia `PON_AQUI_TU_API_KEY_DE_TMDB` por tu API key gratuita de TMDB
   (https://www.themoviedb.org/settings/api).
2. En Nuvio, agrega el repositorio con la URL de `manifest.json`:

```
https://raw.githubusercontent.com/Yahir9/-nuvio-anime/main/manifest.json
```

## Archivos

- `manifest.json`: registro del proveedor
- `providers/jkanime.js`: el plugin (sin dependencias externas)

## Addon de catálogo (solo GitHub)

El flujo `JKAnime addon` (GitHub Actions) genera un catálogo con episodios y fuentes y lo publica en GitHub Pages.
Enlace para Nuvio → Addons: `https://yahir9.github.io/-nuvio-anime/manifest.json`
