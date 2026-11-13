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
  const consultas = [...new Set([a.title, sinTemporada(a.title)].filter(Boolean))];
  for (const c of consultas) {
    const r = await tmdb(`search/${tipo}`, { query: c });
    const lista = (r && r.results) || [];
    const anime = lista.filter((x) => (x.genre_ids || []).includes(16));
    const exacto = anime.find((x) => [x.name, x.title, x.original_name, x.original_title].some((n) => norm(n) === norm(c)));
    const elegido = exacto || anime[0];
    if (elegido) return { tipo, id: elegido.id, nombre: elegido.name || elegido.title };
  }
  return null;
}

async function main() {
  if (!KEY) throw new Error('Falta la API key de TMDB');
  fs.rmSync(SALIDA, { recursive: true, force: true });
  fs.mkdirSync(path.join(SALIDA, 'catalog', 'series'), { recursive: true });
  fs.mkdirSync(path.join(SALIDA, 'catalog', 'movie'), { recursive: true });
  const series = [], pelis = [], vistos = new Set();
  for (const a of datos.directorio) {
    diag.jkanime++;
    const esPelicula = /pel[ií]cula|movie/i.test(`${a.tipo || ''} ${a.type || ''}`);
    const h = await buscar(a, esPelicula);
    if (!h) { diag.sinCoincidencia.push(a.title); continue; }
    const llave = `${h.tipo}${h.id}`;
    if (vistos.has(llave)) { diag.repetidos++; continue; }
    vistos.add(llave);
    const ext = await tmdb(`${h.tipo}/${h.id}/external_ids`);
    const imdb = ext && ext.imdb_id;
    if (!imdb) { diag.sinCoincidencia.push(`${a.title} (sin IMDb)`); continue; }
    const meta = { id: imdb, type: esPelicula ? 'movie' : 'series', name: h.nombre, poster: a.image, posterShape: 'poster', description: String(a.synopsis || '').replace(/\s+/g, ' ').trim() };
    (esPelicula ? pelis : series).push(meta);
    diag.relaciones.push(`${a.title} -> ${h.nombre} (${imdb})`);
    await dormir(120);
  }
  diag.series = series.length; diag.peliculas = pelis.length;
  const catalogos = [];
  const w = (r, o) => fs.writeFileSync(path.join(SALIDA, r), JSON.stringify(o));
  if (series.length) { w('catalog/series/jk-emision.json', { metas: series }); catalogos.push({ type: 'series', id: 'jk-emision', name: 'JKAnime - En emisión' }); }
  if (pelis.length) { w('catalog/movie/jk-peliculas.json', { metas: pelis }); catalogos.push({ type: 'movie', id: 'jk-peliculas', name: 'JKAnime - Películas' }); }
  w('manifest.json', { id: 'com.yahir9.jkanime.catalogo', version: '2.0.0', name: 'JKAnime', description: 'Catálogo de anime de JKAnime; las fuentes las pone el plugin JKAnime',
    resources: ['catalog'], types: ['series', 'movie'], idPrefixes: ['tt'], catalogs: catalogos, behaviorHints: { configurable: false } });
  diag.fin = new Date().toISOString();
  fs.writeFileSync(path.join(SALIDA, 'diagnostico.json'), JSON.stringify(diag, null, 2));
  fs.writeFileSync(path.join(SALIDA, 'index.html'), '<!doctype html><meta charset="utf-8"><title>JKAnime</title><p>Addon de catálogo. <a href="manifest.json">manifest.json</a> · <a href="diagnostico.json">diagnostico.json</a>');
  console.log(JSON.stringify({ ...diag, relaciones: diag.relaciones.length }, null, 2));
  if (!catalogos.length) { console.log('Catálogo vacío'); process.exitCode = 1; }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
