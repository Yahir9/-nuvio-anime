// Catálogo de JKAnime con ID de IMDb/TMDB: Nuvio muestra el título con su propia ficha
// y el plugin providers/jkanime.js (que corre en tu equipo) pone las fuentes al reproducir.
// Solo usa TMDB desde GitHub (JKAnime bloquea a GitHub); los títulos salen de data/jkanime-datos.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SALIDA = path.join(RAIZ, 'site');
const leer = (f) => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const KEY = process.env.TMDB_KEY || (leer('providers/jkanime.js').match(/\|\|\s*'([0-9a-f]{32})'/) || [])[1];
const datos = JSON.parse(leer('data/jkanime-datos.json'));
const CORR = (() => { try { return JSON.parse(leer('data/correcciones.json')); } catch (e) { return {}; } })();
const diag = { inicio: new Date().toISOString(), jkanime: 0, series: 0, peliculas: 0, sinCoincidencia: [], repetidos: 0, errores: [], relaciones: [] };

const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const sinTemporada = (t) => String(t || '')
  .replace(/\b(?:\d{1,2}(?:st|nd|rd|th)\s+season|season\s+\d{1,2}|temporada\s+\d{1,2}|part\s+\d{1,2}|cour\s+\d{1,2})\b/gi, ' ')
  .replace(/\s+(?:II|III|IV|V|\d)$/i, ' ').replace(/\s+/g, ' ').trim();
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function tmdb(ruta, params = {}) {
  const q = new URLSearchParams({ api_key: KEY, language: 'es-MX', ...params });
  for (let i = 1; i <= 3; i++) {
    try {
      const r = await fetch(`https://api.themoviedb.org/3/${ruta}?${q}`, { signal: AbortSignal.timeout(20000) });
      if (r.status === 429) { await dormir(1500 * i); continue; }
      if (!r.ok) { if (diag.errores.length < 20) diag.errores.push(`TMDB ${r.status} ${ruta}`); return null; }
      return await r.json();
    } catch (e) { await dormir(1000 * i); }
  }
  return null;
}

async function buscar(a, esPelicula) {
  const tipo = esPelicula ? 'movie' : 'tv';
  const alias = ((CORR.alias || {})[a.slug] || '').split('|').map((x) => x.trim()).filter(Boolean);
  const consultas = [...new Set([...alias, a.title, sinTemporada(a.title)].filter(Boolean))];
  for (const c of consultas) {
    const r = await tmdb(`search/${tipo}`, { query: c });
    const lista = (r && r.results) || [];
    const anime = lista.filter((x) => (x.genre_ids || []).includes(16));
    const exacto = anime.find((x) => [x.name, x.title, x.original_name, x.original_title].some((n) => norm(n) === norm(c)));
    const elegido = exacto || anime[0];
    if (elegido) return { tipo, id: elegido.id, nombre: elegido.name || elegido.title, poster: elegido.poster_path ? `https://image.tmdb.org/t/p/w500${elegido.poster_path}` : '', fondo: elegido.backdrop_path ? `https://image.tmdb.org/t/p/w780${elegido.backdrop_path}` : '' };
  }
  return null;
}

async function main() {
  if (!KEY) throw new Error('Falta la API key de TMDB');
  fs.rmSync(SALIDA, { recursive: true, force: true });
  fs.mkdirSync(path.join(SALIDA, 'catalog', 'series'), { recursive: true });
  fs.mkdirSync(path.join(SALIDA, 'catalog', 'movie'), { recursive: true });
  const series = [], pelis = [], otros = [], vistos = new Set();
  for (const a of datos.directorio) {
    diag.jkanime++;
    if ((CORR.excluir || []).includes(a.slug)) { diag.excluidos = (diag.excluidos || 0) + 1; continue; }
    const esPelicula = /pel[ií]cula|movie/i.test(`${a.tipo || ''} ${a.type || ''}`);
    const h = await buscar(a, esPelicula);
    if (!h) { diag.sinCoincidencia.push(a.title); continue; }
    const llave = `${h.tipo}${h.id}`;
    if (vistos.has(llave)) { diag.repetidos++; continue; }
    vistos.add(llave);
    const ext = await tmdb(`${h.tipo}/${h.id}/external_ids`);
    const imdb = ext && ext.imdb_id;
    // Sin código de IMDb: va a una fila aparte con ID de TMDB (tmdb:123); no sé si Nuvio lo abre
    const id = imdb || `tmdb:${h.id}`;
    const meta = { id, type: esPelicula ? 'movie' : 'series', name: h.nombre, poster: h.poster || a.image, background: h.fondo || undefined, posterShape: 'poster', description: String(a.synopsis || '').replace(/\s+/g, ' ').trim() };
    if (!imdb) { otros.push(meta); (diag.sinImdb = diag.sinImdb || []).push(`${a.title} -> tmdb:${h.id}`); continue; }
    (esPelicula ? pelis : series).push(meta);
    diag.relaciones.push(`${a.title} -> ${h.nombre} (${imdb})`);
    if ((CORR.alias || {})[a.slug]) (diag.corregidos = diag.corregidos || []).push(`${a.title} -> ${h.nombre}`);
    await dormir(120);
  }
  diag.series = series.length; diag.peliculas = pelis.length;
  // Catálogos automáticos desde TMDB (se actualizan solos con cada ejecución del flujo)
  const hoy = new Date();
  const dia = (n) => new Date(hoy.getTime() + n * 864e5).toISOString().slice(0, 10);
  const imdbDe = new Map();
  async function listaTmdb(tipo, params, paginas) {
    const metas = [];
    for (let pag = 1; pag <= paginas; pag++) {
      const r = await tmdb(`discover/${tipo}`, { with_genres: '16', with_origin_country: 'JP', include_adult: 'false', page: String(pag), ...params });
      for (const x of (r && r.results) || []) {
        if (!x.poster_path || !(x.overview || '').trim() && !x.vote_count) continue;
        let imdb = imdbDe.get(x.id);
        if (imdb === undefined) { const e = await tmdb(`${tipo}/${x.id}/external_ids`); imdb = (e && e.imdb_id) || ''; imdbDe.set(x.id, imdb); await dormir(100); }
        if (!imdb || metas.some((m) => m.id === imdb)) continue;
        metas.push({ id: imdb, type: tipo === 'tv' ? 'series' : 'movie', name: x.name || x.title, poster: `https://image.tmdb.org/t/p/w500${x.poster_path}`, posterShape: 'poster', description: String(x.overview || '').replace(/\s+/g, ' ').trim() });
      }
    }
    return metas;
  }
  // false = solo la lista de JKAnime (data/jkanime-datos.json); true = agrega filas automáticas de TMDB, que pueden incluir títulos que JKAnime no tiene
  const CATALOGOS_TMDB = false;
  const extra = !CATALOGOS_TMDB ? [] : [
    ['series', 'tmdb-emision', 'Anime - Emitiéndose ahora', await listaTmdb('tv', { 'air_date.gte': dia(-10), 'air_date.lte': dia(7), sort_by: 'popularity.desc' }, 3)],
    ['series', 'tmdb-populares', 'Anime - Populares', await listaTmdb('tv', { sort_by: 'popularity.desc', 'vote_count.gte': '150' }, 3)],
    ['movie', 'tmdb-peliculas', 'Anime - Películas populares', await listaTmdb('movie', { sort_by: 'popularity.desc', 'vote_count.gte': '100' }, 2)]
  ];
  diag.tmdb = Object.fromEntries(extra.map(([, id, , metas]) => [id, metas.length]));

  const catalogos = [];
  const w = (r, o) => fs.writeFileSync(path.join(SALIDA, r), JSON.stringify(o));
  if (series.length) { w('catalog/series/jk-emision.json', { metas: series }); catalogos.push({ type: 'series', id: 'jk-emision', name: 'JKAnime - En emisión' }); }
  if (pelis.length) { w('catalog/movie/jk-peliculas.json', { metas: pelis }); catalogos.push({ type: 'movie', id: 'jk-peliculas', name: 'JKAnime - Películas' }); }
  for (const [tipo, id, nombre, metas] of extra) {
    if (!metas.length) continue;
    fs.mkdirSync(path.join(SALIDA, 'catalog', tipo), { recursive: true });
    w(`catalog/${tipo}/${id}.json`, { metas });
    catalogos.push({ type: tipo, id, name: nombre });
  }
  if (otros.length) {
    const tipos = new Set(otros.map((m) => m.type));
    for (const t of tipos) {
      const metas = otros.filter((m) => m.type === t);
      fs.mkdirSync(path.join(SALIDA, 'catalog', t), { recursive: true });
      w(`catalog/${t}/jk-tmdb-${t}.json`, { metas });
      catalogos.push({ type: t, id: `jk-tmdb-${t}`, name: `JKAnime - Otros (${t === 'movie' ? 'películas' : 'series'})` });
    }
  }
  w('manifest.json', { id: 'com.yahir9.jkanime.catalogo', version: '2.2.0', name: 'JKAnime', description: 'Catálogo de anime de JKAnime; las fuentes las pone el plugin JKAnime',
    resources: ['catalog'], types: ['series', 'movie'], idPrefixes: ['tt', 'tmdb'], catalogs: catalogos, behaviorHints: { configurable: false } });
  diag.fin = new Date().toISOString();
  fs.writeFileSync(path.join(SALIDA, 'diagnostico.json'), JSON.stringify(diag, null, 2));
  fs.writeFileSync(path.join(SALIDA, 'index.html'), '<!doctype html><meta charset="utf-8"><title>JKAnime</title><p>Addon de catálogo. <a href="manifest.json">manifest.json</a> · <a href="diagnostico.json">diagnostico.json</a>');
  console.log(JSON.stringify({ ...diag, relaciones: diag.relaciones.length, sinCoincidencia: diag.sinCoincidencia.length }, null, 2));
  if (!catalogos.length) { console.log('Catálogo vacío'); process.exitCode = 1; }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
