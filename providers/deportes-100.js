/*
 * Deportes en vivo — proveedor para Nuvio
 * Nuvio llama getStreams(id, tipo) con el id del partido ("dep_12345", del addon "Deportes en vivo").
 * Se busca el partido en la agenda, y cada canal se resuelve EN TU EQUIPO (el token del video queda atado a tu IP).
 */
const VERSION = '1.0.0';
const API = (typeof process !== 'undefined' && process.env && process.env.DEPORTES_API) || 'https://api.wqxag.com/diaries.json';
const SITIO = 'https://futbollibretvplay.org';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
const PRESUPUESTO = 30000;
let inicio = Date.now();
let motivo = '';
const restante = () => PRESUPUESTO - (Date.now() - inicio);

function conLimite(promesa, ms, valor) {
  const trabajo = Promise.resolve(promesa).catch(() => valor);
  if (typeof setTimeout !== 'function') return trabajo;
  let id;
  const reloj = new Promise((r) => { id = setTimeout(() => r(valor), ms); });
  return Promise.race([trabajo, reloj]).then((v) => { clearTimeout(id); return v; });
}

// Usa el fetch nativo de Nuvio si existe (respeta cabeceras como Sec-Fetch-*); si no, el fetch normal
async function traer(url, o) {
  if (typeof __native_fetch !== 'function') return fetch(url, o);
  const cab = {};
  for (const k of Object.keys(o.headers || {})) cab[k] = String(o.headers[k]);
  const crudo = await __native_fetch(url, 'GET', JSON.stringify(cab), 'none', '', true);
  const d = JSON.parse(crudo);
  return { ok: !!d.ok, status: d.status, text: () => Promise.resolve(d.body || '') };
}

async function pedir(url, headers) {
  const limite = Math.min(15000, restante());
  if (limite <= 0) return { status: 0, texto: '' };
  const r = await conLimite(traer(url, { headers: Object.assign({ 'User-Agent': UA, 'Accept-Language': 'es-MX,es-419;q=0.9,es;q=0.8' }, headers || {}) }).catch(() => null), limite, null);
  if (!r) return { status: 0, texto: '' };
  return { status: r.status, texto: (await conLimite(r.text(), 10000, '')) || '' };
}

function atobSeguro(t) {
  try { return atob(String(t || '').replace(/\s+/g, '')); } catch (e) {
    try { return Buffer.from(String(t || ''), 'base64').toString('utf8'); } catch (e2) { return ''; }
  }
}

const decodificar = (ruta) => {
  const r = (String(ruta).match(/[?&]r=([^&]+)/) || [])[1];
  if (!r) return '';
  let b = r;
  try { b = decodeURIComponent(r); } catch (e) { /* tal cual */ }
  return atobSeguro(b).trim();
};

const CHROME = {
  'sec-ch-ua': '"Not-A.Brand";v="99", "Google Chrome";v="137", "Chromium";v="137"', 'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': '"Windows"',
  'Upgrade-Insecure-Requests': '1', Priority: 'u=0, i'
};
const ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';

async function resolver(envoltorio) {
  const env = await pedir(envoltorio, Object.assign({}, CHROME, { Referer: `${SITIO}/embed/eventos.html`, Accept: ACCEPT, 'Sec-Fetch-Dest': 'iframe', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'cross-site' }));
  const marco = (env.texto.match(/<iframe[^>]*id=["']player-frame["'][^>]*>/i) || env.texto.match(/<iframe[^>]*>/i) || [''])[0];
  const src = (marco.match(/src=["']([^"']+)["']/i) || [])[1];
  if (!src) { motivo = `La página del canal respondió ${env.status} y no trae reproductor`; return ''; }
  const base = envoltorio.replace(/^(https?:\/\/[^/]+).*$/, '$1');
  const interno = /^https?:/i.test(src) ? src : base + (src.startsWith('/') ? '' : '/') + src;
  const r = await pedir(interno, Object.assign({}, CHROME, { Referer: envoltorio, Accept: ACCEPT, 'Sec-Fetch-Dest': 'iframe', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'same-origin' }));
  const m = r.texto.match(/["']src["']\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i);
  if (!m) { motivo = `El reproductor respondió ${r.status}: ${r.texto.slice(0, 60).replace(/\s+/g, ' ')}`; return ''; }
  return m[1].replace(/\\\//g, '/');
}

async function getStreams(id, tipo) {
  try {
    const n = (String(id || '').match(/^dep_(\d+)$/) || [])[1];
    if (!n) return [];
    const a = await pedir(API, { Accept: 'application/json', Referer: `${SITIO}/`, Origin: SITIO });
    let datos = null;
    try { datos = JSON.parse(a.texto); } catch (e) { /* nada */ }
    if (!datos) { motivo = `No se pudo leer la agenda (respuesta ${a.status})`; return []; }
    const ev = ((datos && datos.data) || []).find((e) => String(e.id) === n);
    if (!ev) { motivo = 'Ese partido ya no está en la agenda'; return []; }
    const at = ev.attributes || {};
    const titulo = String(at.diary_description || '').replace(/\s+/g, ' ').trim();
    const opciones = ((at.embeds || {}).data || []).map((e) => ({ nombre: String(e.attributes.embed_name || '').trim(), url: decodificar(e.attributes.embed_iframe) })).filter((e) => e.url);
    if (!opciones.length) { motivo = 'El partido no tiene canales todavía'; return []; }
    const grupos = await Promise.all(opciones.map((o) => conLimite(resolver(o.url).then((m3u8) => (m3u8 ? { o, m3u8 } : null)), Math.max(1000, restante() - 2000), null)));
    const salida = [];
    const vistos = new Set();
    for (const g of grupos) {
      if (!g || vistos.has(g.m3u8)) continue;
      vistos.add(g.m3u8);
      salida.push({ name: `Deportes (${g.o.nombre}) · En vivo`, title: titulo, url: g.m3u8, quality: '1080p', provider: 'Deportes', headers: { Referer: 'https://tvf90.com/', Origin: 'https://tvf90.com', 'User-Agent': UA } });
    }
    return salida;
  } catch (e) {
    motivo = `Error: ${e && e.message}`;
    return [];
  }
}

module.exports = {
  getStreams: (id, tipo, t, e) => {
    inicio = Date.now();
    motivo = '';
    if (!/^dep_\d+$/.test(String(id || '').trim())) return Promise.resolve([]);
    return conLimite(getStreams(String(id).trim(), tipo, t, e), PRESUPUESTO + 3000, null).then((s) => {
      if (s && s.length) return s;
      const por = motivo || 'Sin respuesta a tiempo';
      return [{ name: `Deportes v${VERSION}: ${por.slice(0, 60)}`, title: por, url: 'https://futbollibretvplay.org/', quality: por.slice(0, 90), language: por.slice(60, 160) || 'Diagnóstico', provider: 'Deportes' }];
    });
  }
};
