// Agenda deportiva (Fútbol Libre) como addon estático: catálogo con los eventos de hoy y, para cada uno,
// los enlaces de video (HLS) ya resueltos. Se publica en site/deportes/ y se actualiza cada hora.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SALIDA = path.join(RAIZ, 'site', 'deportes');
const API = 'https://api.wqxag.com/diaries.json';
const SITIO = 'https://futbollibretvplay.org';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
const diag = { inicio: new Date().toISOString(), eventos: 0, opciones: 0, resueltas: 0, errores: [], pruebas: [] };
const nota = (t) => { if (diag.pruebas.length < 30) diag.pruebas.push(t); };

async function pedir(url, headers = {}) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'es-MX,es;q=0.9', ...headers }, signal: AbortSignal.timeout(20000) });
    return { status: r.status, texto: await r.text() };
  } catch (e) { return { status: 0, texto: '', error: (e.cause && e.cause.code) || e.message }; }
}

// Una opción de la agenda: /embed/eventos.html?r=<base64 de https://tvf90.com/X.php?stream=Y>
const decodificar = (ruta) => {
  const r = (String(ruta).match(/[?&]r=([^&]+)/) || [])[1];
  if (!r) return '';
  try { return Buffer.from(decodeURIComponent(r), 'base64').toString('utf8').trim(); } catch (e) { return ''; }
};

const cache = new Map();
async function resolver(urlEnvoltorio) {
  if (cache.has(urlEnvoltorio)) return cache.get(urlEnvoltorio);
  const trabajo = (async () => {
    const env = await pedir(urlEnvoltorio, { Referer: `${SITIO}/`, Accept: 'text/html,*/*', 'Sec-Fetch-Dest': 'iframe', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'cross-site' });
    nota(`envoltorio ${env.status}${env.error ? ' ' + env.error : ''} ${urlEnvoltorio.replace(/^https?:\/\//, '')}`);
    const marco = (env.texto.match(/<iframe[^>]*id=["']player-frame["'][^>]*>/i) || env.texto.match(/<iframe[^>]*>/i) || [''])[0];
    const src = (marco.match(/src=["']([^"']+)["']/i) || [])[1];
    if (!src) return '';
    const interno = new URL(src, urlEnvoltorio).href;
    const r = await pedir(interno, { Referer: urlEnvoltorio, Accept: 'text/html,application/xhtml+xml,*/*', 'Sec-Fetch-Dest': 'iframe', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'same-origin' });
    nota(`interno ${r.status}${r.error ? ' ' + r.error : ''} ${interno.replace(/^https?:\/\//, '')} ${r.status === 200 && !/m3u8/.test(r.texto) ? '(sin m3u8: ' + r.texto.slice(0, 60).replace(/\s+/g, ' ') + ')' : ''}`);
    const m = r.texto.match(/["']src["']\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i);
    return m ? m[1].replace(/\\\//g, '/') : '';
  })();
  cache.set(urlEnvoltorio, trabajo);
  return trabajo;
}

const limpiar = (t) => String(t || '').replace(/\s+/g, ' ').trim();
// diary_hour viene en hora de Perú (UTC-5); México (centro) = UTC-6
const instante = (fecha, hora) => new Date(`${fecha}T${hora}-05:00`);
const hhmm = (d) => new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Mexico_City' }).format(d);

async function main() {
  fs.rmSync(SALIDA, { recursive: true, force: true });
  for (const d of ['catalog/movie', 'meta/movie', 'stream/movie']) fs.mkdirSync(path.join(SALIDA, d), { recursive: true });
  const w = (r, o) => fs.writeFileSync(path.join(SALIDA, r), JSON.stringify(o));

  const a = await pedir(API, { Accept: 'application/json', Referer: `${SITIO}/`, Origin: SITIO });
  nota(`agenda ${a.status}${a.error ? ' ' + a.error : ''}`);
  let datos = null;
  try { datos = JSON.parse(a.texto); } catch (e) { /* nada */ }
  const eventos = (datos && datos.data) || [];
  diag.eventos = eventos.length;

  const metas = [];
  for (const ev of eventos) {
    const at = ev.attributes || {};
    const cuando = instante(at.date_diary, at.diary_hour);
    if (isNaN(cuando)) continue;
    const id = `dep_${ev.id}`;
    const pais = (((at.country || {}).data || {}).attributes) || {};
    const flag = pais.image && pais.image.data && pais.image.data.attributes && pais.image.data.attributes.url;
    const titulo = limpiar(at.diary_description).replace(/\s*:\s*/, ': ');
    const opciones = ((at.embeds || {}).data || []).map((e) => ({ nombre: limpiar(e.attributes.embed_name), url: decodificar(e.attributes.embed_iframe) })).filter((e) => e.url);
    diag.opciones += opciones.length;
    const streams = [];
    for (const o of opciones) {
      const m3u8 = await resolver(o.url);
      if (!m3u8) continue;
      diag.resueltas++;
      streams.push({ name: `Deportes (${o.nombre})`, title: `${titulo}\n${o.nombre} · en vivo`, url: m3u8, behaviorHints: { notWebReady: true, proxyHeaders: { request: { Referer: 'https://tvf90.com/', Origin: 'https://tvf90.com', 'User-Agent': UA } } } });
    }
    const meta = { id, type: 'movie', name: `${hhmm(cuando)} ${titulo}`, poster: flag ? `${SITIO}${flag}` : undefined, posterShape: 'square', background: flag ? `${SITIO}${flag}` : undefined,
      description: `${titulo}\n${pais.name || ''}\nHora de México: ${hhmm(cuando)}\nCanales: ${opciones.map((o) => o.nombre).join(', ') || 'sin canales'}`, releaseInfo: at.date_diary, _t: cuando.getTime() };
    metas.push(meta);
    w(`meta/movie/${id}.json`, { meta: { ...meta, _t: undefined } });
    w(`stream/movie/${id}.json`, { streams });
  }
  metas.sort((x, y) => x._t - y._t);
  w('catalog/movie/dep-hoy.json', { metas: metas.map((m) => ({ ...m, _t: undefined })) });
  w('manifest.json', { id: 'com.yahir9.deportes', version: '1.0.0', name: 'Deportes en vivo', description: 'Agenda deportiva del día con enlaces en vivo',
    resources: ['catalog', 'meta', 'stream'], types: ['movie'], idPrefixes: ['dep_'], catalogs: [{ type: 'movie', id: 'dep-hoy', name: 'Deportes - Hoy' }], behaviorHints: { configurable: false } });
  diag.fin = new Date().toISOString();
  fs.writeFileSync(path.join(SALIDA, 'diagnostico.json'), JSON.stringify(diag, null, 2));
  console.log(JSON.stringify(diag, null, 2));
  if (!eventos.length) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
