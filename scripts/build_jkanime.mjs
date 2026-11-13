// Genera un addon estático (formato Stremio/Nuvio) con el catálogo de JKAnime.
// Lo ejecuta GitHub Actions; el resultado queda en ./site y se publica en GitHub Pages.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..');
const SALIDA = path.join(RAIZ, 'site');
const { interno } = require(path.join(RAIZ, 'providers', 'jkanime.js'));

const BASE = 'https://jkanime.net';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
const MAX_SERIES = Number(process.env.MAX_SERIES || 60);
const EPISODIOS_RESUELTOS = Number(process.env.EPISODIOS_RESUELTOS || 2); // últimos N episodios con enlace directo
const PAUSA = Number(process.env.PAUSA ?? 700); // ms entre peticiones a jkanime.net

const diag = { inicio: new Date().toISOString(), peticiones: [], errores: [], series: 0, peliculas: 0, episodios: 0, streamsDirectos: 0 };
const nota = (m) => { console.log(m); };
const error = (m) => { console.log('ERROR:', m); if (diag.errores.length < 40) diag.errores.push(String(m)); };
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------------- red */
let ultima = 0;
async function http(url, { method = 'GET', headers = {}, body, cookies } = {}) {
  for (let intento = 1; intento <= 3; intento++) {
    const espera = ultima + PAUSA - Date.now();
    if (espera > 0) await dormir(espera);
    ultima = Date.now();
    try {
      const r = await fetch(url, {
        method, body,
        headers: Object.assign({ 'User-Agent': UA, Accept: 'text/html,application/json,*/*', 'Accept-Language': 'es-MX,es;q=0.9', ...(cookies ? { Cookie: cookies } : {}) }, headers),
        signal: AbortSignal.timeout(25000)
      });
      if (diag.peticiones.length < 25) diag.peticiones.push(`${method} ${r.status} ${url.replace(BASE, '')}`);
      if (r.status === 429 || r.status >= 500) { await dormir(2000 * intento); continue; }
      const sc = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [];
      return { status: r.status, ok: r.ok, texto: await r.text(), cookies: sc.map((c) => c.split(';')[0]).join('; ') };
    } catch (e) {
      if (diag.peticiones.length < 25) diag.peticiones.push(`${method} ERROR ${(e.cause && e.cause.code) || e.message} ${url.replace(BASE, '')}`);
      await dormir(1500 * intento);
    }
  }
  return { status: 0, ok: false, texto: '', cookies: '' };
}

/* ----------------------------------------------------------- JKAnime */
function leerAnimes(html) {
  const i = html.indexOf('var animes');
  if (i < 0) return null;
  const ini = html.indexOf('{', i);
  if (ini < 0) return null;
  let fin = html.indexOf('};', ini);
  for (let n = 0; fin > 0 && n < 8; n++) {
    try { return JSON.parse(html.slice(ini, fin + 1)); } catch (e) { fin = html.indexOf('};', fin + 1); }
  }
  return null;
}

async function directorio() {
  const lista = [];
  let ultimaPag = 1;
  for (let p = 1; p <= ultimaPag && lista.length < MAX_SERIES && p <= 10; p++) {
    const r = await http(`${BASE}/directorio?estado=emision&p=${p}`);
    const d = leerAnimes(r.texto);
    if (!d || !Array.isArray(d.data)) { error(`directorio página ${p}: estado ${r.status}, sin "var animes"`); break; }
    ultimaPag = Number(d.last_page) || 1;
    for (const a of d.data) if (a && a.slug && /^[a-z0-9][a-z0-9-]*$/i.test(a.slug)) lista.push(a);
  }
  return lista.slice(0, MAX_SERIES);
}

const etiqueta = (html, re) => { const m = html.match(re); return m ? m[1] : ''; };
const sinTags = (t) => String(t || '').replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();

async function episodiosDe(slug) {
  const pag = await http(`${BASE}/${slug}/`);
  if (!pag.ok) { error(`${slug}: página del anime estado ${pag.status}`); return { episodios: [], fondo: '' }; }
  const html = pag.texto;
  const tag = (html.match(/<[^>]+id=["']guardar-anime["'][^>]*>/i) || [''])[0];
  const id = etiqueta(tag, /data-anime=["'](\d+)["']/i);
  const token = etiqueta(html, /<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/i) || etiqueta(html, /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']csrf-token["']/i);
  const fondo = etiqueta(html, /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  const episodios = [];
  if (id && token) {
    let total = Infinity;
    for (let p = 1; p <= 40 && episodios.length < total; p++) {
      const r = await http(`${BASE}/ajax/episodes/${id}/${p}`, {
        method: 'POST', cookies: pag.cookies,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-TOKEN': token, Referer: `${BASE}/${slug}/`, Origin: BASE },
        body: `_token=${encodeURIComponent(token)}`
      });
      let d = null;
      try { d = JSON.parse(r.texto); } catch (e) { /* nada */ }
      if (!d || !Array.isArray(d.data) || !d.data.length) { if (p === 1) error(`${slug}: ajax episodios estado ${r.status} sin datos`); break; }
      total = Number(d.total) || d.data.length;
      for (const e of d.data) if (e && e.number !== undefined && !episodios.some((x) => x.numero === Number(e.number))) episodios.push({ numero: Number(e.number), fecha: e.timestamp || '', imagen: e.image || '' });
    }
  } else error(`${slug}: sin id (${id || 'no'}) o token (${token ? 'sí' : 'no'})`);
  episodios.sort((a, b) => a.numero - b.numero);
  return { episodios, fondo };
}

/* ------------------------------------------------------------- salida */
const escribir = (ruta, obj) => {
  const f = path.join(SALIDA, ruta);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, typeof obj === 'string' ? obj : JSON.stringify(obj));
};
const abs = (u) => (!u ? '' : /^https?:/i.test(u) ? u : u.startsWith('//') ? `https:${u}` : `${BASE}${u.startsWith('/') ? '' : '/'}${u}`);
const fechaIso = (t, i) => { const d = new Date(String(t).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(t)) ? '' : 'Z')); return isNaN(d) ? new Date(Date.UTC(2000, 0, 1 + i)).toISOString() : d.toISOString(); };

function aStream(s) {
  const o = { name: s.name, title: `${s.title}\n${s.quality || ''} ${s.language || ''}`.trim(), url: s.url };
  const h = {};
  for (const k of Object.keys(s.headers || {})) h[k] = s.headers[k];
  o.behaviorHints = { notWebReady: true };
  if (Object.keys(h).length) o.behaviorHints.proxyHeaders = { request: h };
  return o;
}

async function directos(slug, numero, esPelicula, titulo) {
  try {
    interno.reiniciar();
    const { servidores, pagina } = await interno.servidoresDe(slug, numero, esPelicula);
    if (!servidores.length) return [];
    interno.reiniciar();
    const r = await interno.armar(servidores, titulo, pagina);
    diag.streamsDirectos += r.length;
    return r.map(aStream);
  } catch (e) { error(`${slug} ${numero}: ${e.message}`); return []; }
}

async function main() {
  fs.rmSync(SALIDA, { recursive: true, force: true });
  fs.mkdirSync(SALIDA, { recursive: true });
  const lista = await directorio();
  nota(`Directorio: ${lista.length} títulos`);
  const catSeries = [];
  const catPelis = [];

  for (const a of lista) {
    const slug = a.slug;
    const id = `jk_${slug}`;
    const esPelicula = /pel[ií]cula|movie/i.test(a.tipo || '');
    const tipo = esPelicula ? 'movie' : 'series';
    const poster = abs(a.image) || `https://cdn.jkdesa.com/assets/images/animes/image/${slug}.jpg`;
    const resumen = { id, type: tipo, name: sinTags(a.title), poster, posterShape: 'poster', description: sinTags(a.synopsis) };
    (esPelicula ? catPelis : catSeries).push(resumen);
    const meta = Object.assign({}, resumen, { background: poster, website: `${BASE}/${slug}/`, links: [] });

    if (esPelicula) {
      diag.peliculas++;
      const url = `${BASE}/${slug}/pelicula`;
      const d = await directos(slug, 1, true, resumen.name);
      escribir(`meta/movie/${id}.json`, { meta });
      escribir(`stream/movie/${id}.json`, { streams: [...d, { name: 'JKAnime', title: 'Abrir en JKAnime (navegador)', externalUrl: url }] });
      continue;
    }

    diag.series++;
    const { episodios, fondo } = await episodiosDe(slug);
    if (fondo) meta.background = fondo;
    meta.videos = episodios.map((e, i) => ({
      id: `${id}_${e.numero}`, title: `Episodio ${e.numero}`, season: 1, episode: e.numero,
      released: fechaIso(e.fecha, i), thumbnail: e.imagen ? (/^https?:/.test(e.imagen) ? e.imagen : `https://cdn.jkdesa.com/assets/images/animes/video/image_thumb/${e.imagen}`) : undefined
    }));
    escribir(`meta/series/${id}.json`, { meta });
    const ultimos = new Set(episodios.slice(-EPISODIOS_RESUELTOS).map((e) => e.numero));
    for (const e of episodios) {
      diag.episodios++;
      const web = { name: 'JKAnime', title: 'Abrir en JKAnime (navegador)', externalUrl: `${BASE}/${slug}/${e.numero}` };
      const d = ultimos.has(e.numero) ? await directos(slug, e.numero, false, `${resumen.name} - E${e.numero}`) : [];
      escribir(`stream/series/${id}_${e.numero}.json`, { streams: [...d, web] });
    }
    nota(`${slug}: ${episodios.length} episodios`);
  }

  const catalogos = [];
  if (catSeries.length) { escribir('catalog/series/jk-emision.json', { metas: catSeries }); catalogos.push({ type: 'series', id: 'jk-emision', name: 'JKAnime - En emisión' }); }
  if (catPelis.length) { escribir('catalog/movie/jk-peliculas.json', { metas: catPelis }); catalogos.push({ type: 'movie', id: 'jk-peliculas', name: 'JKAnime - Películas' }); }
  if (!catalogos.length) catalogos.push({ type: 'series', id: 'jk-emision', name: 'JKAnime - En emisión' }), escribir('catalog/series/jk-emision.json', { metas: [] });

  escribir('manifest.json', {
    id: 'com.yahir9.jkanime.catalogo', version: '1.0.0', name: 'JKAnime', description: 'Anime de JKAnime en español: catálogo, episodios y fuentes',
    resources: ['catalog', 'meta', 'stream'], types: ['series', 'movie'], idPrefixes: ['jk_'], catalogs: catalogos,
    behaviorHints: { configurable: false, adult: false }
  });
  diag.fin = new Date().toISOString();
  escribir('diagnostico.json', JSON.stringify(diag, null, 2));
  escribir('index.html', `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>JKAnime addon</title><body style="font-family:sans-serif;max-width:40em;margin:2em auto;padding:0 1em"><h1>JKAnime para Nuvio</h1><p>Series: ${diag.series} · Películas: ${diag.peliculas} · Episodios: ${diag.episodios}</p><p>Agrega este enlace en Nuvio &rarr; Addons: <code>manifest.json</code> de esta misma página.</p><p><a href="manifest.json">manifest.json</a> · <a href="diagnostico.json">diagnostico.json</a></p>`);
  nota(JSON.stringify(diag, null, 2));
  if (!lista.length) { error('Catálogo vacío: JKAnime no respondió desde GitHub'); process.exitCode = 1; }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
