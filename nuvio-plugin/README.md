# JKAnime para Nuvio

Proveedor de Nuvio que busca anime en jkanime.net y devuelve enlaces de video directos.

## Configuración

1. Abre `nuvio-plugin/providers/jkanime.js` y cambia `PON_AQUI_TU_API_KEY_DE_TMDB` por tu API key gratuita de TMDB
   (https://www.themoviedb.org/settings/api).
2. En Nuvio, agrega el repositorio con la URL de `nuvio-plugin/manifest.json`:

```
https://raw.githubusercontent.com/Yahir9/-nuvio-anime/main/nuvio-plugin/manifest.json
```

## Archivos

- `nuvio-plugin/manifest.json`: registro del proveedor
- `nuvio-plugin/providers/jkanime.js`: el plugin (sin dependencias externas)
