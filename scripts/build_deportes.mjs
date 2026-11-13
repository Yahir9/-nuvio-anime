// Agenda deportiva (Fútbol Libre) como addon estático: catálogo con los eventos de hoy y, para cada uno,
// los enlaces de video (HLS) ya resueltos. Se publica en site/deportes/ y se actualiza cada hora.
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SALIDA = path.join(RAIZ, 'site', 'deportes');
const API = process.env.AGENDA_URL || 'https://api.wqxag.com/diaries.json';
const SITIO = 'https://futbollibretvplay.org';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
const diag = { inicio: new Date().toISOString(), eventos: 0, opciones: 0, resueltas: 0, errores: [], pruebas: [] };
const nota = (t) => { if (diag.pruebas.length < 30) diag.pruebas.push(t); };

// Conexión de bajo nivel: el fetch de Node cambia Sec-Fetch-Mode a "cors" a la fuerza y tvf90.com lo revisa
function pedir(url, headers = {}) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(url); } catch (e) { return resolve({ status: 0, texto: '', cookies: '', error: 'url' }); }
    const modulo = u.protocol === 'http:' ? http : https;
    const cab = { 'User-Agent': UA, 'Accept-Language': 'es-MX,es-419;q=0.9,es;q=0.8', ...headers };
    delete cab['Accept-Encoding'];
    const req = modulo.request(u, { method: 'GET', headers: cab, timeout: 20000 }, (r) => {
      const partes = [];
      r.on('data', (c) => partes.push(c));
      r.on('end', () => resolve({
        status: r.statusCode, texto: Buffer.concat(partes).toString('utf8'),
        cookies: (r.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; '),
        servidor: `${r.headers.server || ''} ${r.headers['cf-ray'] ? 'cf' : ''}`.trim()
      }));
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', (e) => resolve({ status: 0, texto: '', cookies: '', error: e.code || e.message }));
    req.end();
  });
}

// Cabeceras de un Chrome real
const CHROME = {
  'sec-ch-ua': '"Not-A.Brand";v="99", "Google Chrome";v="137", "Chromium";v="137"', 'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': '"Windows"',
  'Upgrade-Insecure-Requests': '1', Priority: 'u=0, i', 'Accept-Encoding': 'gzip, deflate, br'
};

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
    const env = await pedir(urlEnvoltorio, { ...CHROME, Referer: `${SITIO}/embed/eventos.html`, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8', 'Sec-Fetch-Dest': 'iframe', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'cross-site' });
    nota(`envoltorio ${env.status}${env.error ? ' ' + env.error : ''} ${urlEnvoltorio.replace(/^https?:\/\//, '')}`);
    const marco = (env.texto.match(/<iframe[^>]*id=["']player-frame["'][^>]*>/i) || env.texto.match(/<iframe[^>]*>/i) || [''])[0];
    const src = (marco.match(/src=["']([^"']+)["']/i) || [])[1];
    if (!src) return '';
    const interno = new URL(src, urlEnvoltorio).href;
    const r = await pedir(interno, { ...CHROME, ...(env.cookies ? { Cookie: env.cookies } : {}), Referer: urlEnvoltorio, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8', 'Sec-Fetch-Dest': 'iframe', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'same-origin' });
    nota(`interno ${r.status}${r.error ? ' ' + r.error : ''} [${r.servidor}] cookies:${env.cookies ? 'sí' : 'no'} ${interno.replace(/^https?:\/\//, '')} ${!/m3u8/.test(r.texto) ? '(respuesta: ' + r.texto.slice(0, 120).replace(/\s+/g, ' ') + ')' : ''}`);
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

// ¿Ya terminó? No hay hora de fin en la agenda: se calcula por deporte (con margen para tiempos extra)
function duracionHoras(t) {
  const x = String(t).toLowerCase();
  if (/\bnfl\b/.test(x)) return 3.75;
  if (/\bmlb\b|béisbol|beisbol/.test(x)) return 3.5;
  if (/\bnba\b|\bnhl\b|basquet|básquet|baloncesto|hockey|voley|vóley/.test(x)) return 3.25;
  if (/tenis|tennis|wta|atp|roland|wimbledon/.test(x)) return 4.5;
  if (/box|knockout|ufc|mma|lucha|wwe|aew/.test(x)) return 4;
  if (/f1|formula 1|fórmula 1|motogp|nascar|gran premio|carrera/.test(x)) return 3;
  if (/golf/.test(x)) return 6;
  return 2.75; // fútbol y demás
}
const terminado = (inicioMs, titulo, ahora) => ahora > inicioMs + duracionHoras(titulo) * 3600e3;

// Portada con torneo, equipos y hora (ImageMagick). Si no está instalado, devuelve false.
function hacerPortada(archivo, liga, equipos, hora, pais) {
  const limpio = (t) => String(t || '').replace(/[%\\]/g, ' ').replace(/^@+/, '').trim() || ' ';
  const fuente = process.env.FUENTE_PORTADA || 'DejaVu-Sans-Bold';
  const cap = (texto, punto, color, ancho) => ['(', '-background', 'none', '-fill', color, '-font', fuente, '-pointsize', String(punto), '-size', `${ancho}x`, '-gravity', 'center', `caption:${limpio(texto)}`, ')'];
  try {
    execFileSync('convert', [
      '-size', '600x900', 'gradient:#1d3f9a-#070b1c',
      ...cap(liga || 'Deportes', 34, '#9ec1ff', 520), '-gravity', 'north', '-geometry', '+0+110', '-composite',
      ...cap(equipos, equipos.length > 55 ? 44 : 56, '#ffffff', 520), '-gravity', 'center', '-geometry', '+0+10', '-composite',
      ...cap(hora, 110, '#ffd34d', 520), '-gravity', 'south', '-geometry', '+0+150', '-composite',
      ...cap(`HORA DE MÉXICO${pais ? ' · ' + pais.toUpperCase() : ''}`, 24, '#c7d2fe', 520), '-gravity', 'south', '-geometry', '+0+90', '-composite',
      archivo
    ], { stdio: 'pipe', timeout: 30000 });
    return true;
  } catch (e) { diag.errores.push(`portada: ${String(e.message).slice(0, 100)}`); return false; }
}
const BASE_PAGES = process.env.PAGES_BASE || (process.env.GITHUB_REPOSITORY ? `https://${process.env.GITHUB_REPOSITORY.split('/')[0].toLowerCase()}.github.io/${process.env.GITHUB_REPOSITORY.split('/')[1]}` : 'https://yahir9.github.io/-nuvio-anime');

async function main() {
  fs.rmSync(SALIDA, { recursive: true, force: true });
  for (const d of ['catalog/movie', 'meta/movie', 'stream/movie', 'img']) fs.mkdirSync(path.join(SALIDA, d), { recursive: true });
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
    if (terminado(cuando.getTime(), `${at.diary_description}`, Date.now())) { diag.terminados = (diag.terminados || 0) + 1; continue; }
    const id = `dep_${ev.id}`;
    const pais = (((at.country || {}).data || {}).attributes) || {};
    const flag = pais.image && pais.image.data && pais.image.data.attributes && pais.image.data.attributes.url;
    const titulo = limpiar(at.diary_description).replace(/\s*:\s*/, ': ');
    const opciones = ((at.embeds || {}).data || []).map((e) => ({ nombre: limpiar(e.attributes.embed_name), url: decodificar(e.attributes.embed_iframe) })).filter((e) => e.url);
    diag.opciones += opciones.length;
    // "Torneo: A vs B" o "Torneo – A vs B" -> liga y equipos
    const partes = titulo.match(/^(.{2,70}?)\s*(?::|–|—)\s+(.+)$/);
    const liga = partes ? partes[1] : (pais.name || 'Deportes');
    const equipos = partes ? partes[2] : titulo;
    const okPortada = hacerPortada(path.join(SALIDA, 'img', `${id}.png`), liga, equipos, hhmm(cuando), partes ? (pais.name || '') : '');
    const imagen = okPortada ? `${BASE_PAGES}/deportes/img/${id}.png` : (flag ? `${SITIO}${flag}` : undefined);
    if (okPortada) diag.portadas = (diag.portadas || 0) + 1;
    const meta = { id, type: 'movie', name: `${hhmm(cuando)} ${titulo}`, poster: imagen, posterShape: 'poster', background: imagen,
      description: `${titulo}\n${pais.name || ''}\nHora de México: ${hhmm(cuando)}\nCanales: ${opciones.map((o) => o.nombre).join(', ') || 'sin canales'}`, releaseInfo: at.date_diary, _t: cuando.getTime() };
    metas.push(meta);
    w(`meta/movie/${id}.json`, { meta: { ...meta, _t: undefined } });
    w(`stream/movie/${id}.json`, { streams: [] }); // vacío: los enlaces los pone el plugin en el dispositivo
  }
  metas.sort((x, y) => x._t - y._t);
  // Evento fijo de prueba: sirve para comprobar en cualquier momento (aunque no haya partidos) que el plugin corre en tu aparato.
  {
    const okP = hacerPortada(path.join(SALIDA, 'img', 'dep_7.png'), 'PRUEBA', 'Comprobar fuentes', '00:00', 'SIEMPRE DISPONIBLE');
    const m0 = { id: 'dep_7', type: 'movie', name: 'Prueba de fuentes', poster: okP ? `${BASE_PAGES}/deportes/img/dep_7.png` : undefined, posterShape: 'poster',
      description: 'Evento fijo para comprobar que los plugins funcionan en este aparato. Trae un video de prueba para comprobar que la reproducción funciona; los partidos reales salen en la lista de abajo.', releaseInfo: '' };
    metas.unshift({ ...m0, _t: 0 });
    w('meta/movie/dep_7.json', { meta: m0 });
    w('stream/movie/dep_7.json', { streams: [{ name: 'Prueba', title: 'Video de prueba (HLS) para comprobar la reproducción', url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8' }] });
  }
  w('catalog/movie/dep-hoy.json', { metas: metas.map((m) => ({ ...m, _t: undefined })) });
  w('manifest.json', { id: 'com.yahir9.deportes', version: '1.1.0', name: 'Deportes en vivo', description: 'Agenda deportiva del día; los enlaces en vivo los pone el plugin Deportes',
    resources: ['catalog', 'meta', 'stream'], types: ['movie'], idPrefixes: ['dep_'], catalogs: [{ type: 'movie', id: 'dep-hoy', name: 'Deportes - Hoy' }], behaviorHints: { configurable: false } });
  diag.fin = new Date().toISOString();
  fs.writeFileSync(path.join(SALIDA, 'diagnostico.json'), JSON.stringify(diag, null, 2));
  console.log(JSON.stringify(diag, null, 2));
  if (!eventos.length) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
