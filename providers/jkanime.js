/*
 * JKAnime — proveedor para Nuvio
 *
 * Nuvio llama a getStreams(tmdbId, mediaType, season, episode) y espera una lista de streams.
 * Flujo:
 *   1. TMDB: con el ID se obtienen los títulos (es, en y alternativos en romaji).
 *   2. JKAnime: se busca en /buscar/{titulo} y se elige la entrada que mejor coincide.
 *   3. Se abre /{slug}/{episodio}, se lee `var servers = [...]` y se decodifica cada `remote` (Base64).
 *   4. Cada embed se resuelve a un enlace de video directo (m3u8 / mp4).
 *
 * Sin dependencias externas (no usa cheerio ni crypto-js).
 */

// Clave gratuita de https://www.themoviedb.org/settings/api  (también se acepta la variable de entorno TMDB_KEY)
const TMDB_KEY = (typeof process !== 'undefined' && process.env && process.env.TMDB_KEY) || 'f07a533e16343c03aa94504941a905fc';

const BASE = 'https://jkanime.net';
const FUENTE = 'JKAnime';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

// Código `lang` de cada servidor en JKAnime -> etiqueta de audio.
// (jkanime.js solo distingue 1 = subtitulado y 3 = latino; el 2 es una suposición, ajústalo si hace falta)
const IDIOMAS = { 1: 'Subtitulado', 2: 'Castellano', 3: 'Latino' };
const PESO_AUDIO = { Latino: 3, Castellano: 2, Subtitulado: 1 };

const HAY_RELOJ = typeof setTimeout === 'function';
const PRESUPUESTO = 40000; // ms máximos por llamada a getStreams
let inicio = Date.now();
const restante = () => PRESUPUESTO - (Date.now() - inicio);

/* ------------------------------------------------------------------ red */

function conLimite(promesa, ms, valor) {
  const trabajo = Promise.resolve(promesa).catch(() => valor);
  if (!HAY_RELOJ) return trabajo;
  let id;
  const reloj = new Promise((r) => {
    id = setTimeout(() => r(valor), ms);
  });
  return Promise.race([trabajo, reloj]).then((v) => {
    clearTimeout(id);
    return v;
  });
}

// Usa el fetch nativo de Nuvio si existe; si no, el fetch normal.
async function traer(url, o) {
  if (typeof __native_fetch !== 'function') return fetch(url, o);
  const cab = {};
  for (const k of Object.keys(o.headers || {})) cab[k] = String(o.headers[k]);
  const cuerpo = o.body === undefined || o.body === null ? null : String(o.body);
  const crudo = await __native_fetch(url, String(o.method || 'GET').toUpperCase(), JSON.stringify(cab), cuerpo === null ? 'none' : 'text', cuerpo || '', o.redirect !== 'manual');
  const d = JSON.parse(crudo);
  const h = d.headers || {};
  return {
    ok: !!d.ok,
    status: d.status,
    url: d.url || url,
    headers: { get: (n) => h[String(n).toLowerCase()] || null },
    text: () => Promise.resolve(d.body || ''),
    json: () => {
      try {
        return Promise.resolve(JSON.parse(d.body));
      } catch (e) {
        return Promise.resolve(null);
      }
    }
  };
}

async function pedir(url, opciones) {
  const o = Object.assign({}, opciones || {});
  const limite = Math.min(o.limite || 15000, restante());
  delete o.limite;
  if (limite <= 0) return null;
  o.headers = Object.assign({
    'User-Agent': UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8'
  }, o.headers || {});
  return conLimite(traer(url, o).catch(() => null), limite, null);
}

async function texto(url, opciones) {
  const r = await pedir(url, opciones);
  if (!r || !r.ok) return '';
  return (await conLimite(r.text(), 10000, '')) || '';
}

async function json(url, opciones) {
  const t = await texto(url, opciones);
  try {
    return t ? JSON.parse(t) : null;
  } catch (e) {
    return null;
  }
}

/* ------------------------------------------------------------ utilidades */

const ENTIDADES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };

function entidades(t) {
  return String(t || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&(amp|quot|apos|lt|gt|nbsp);/g, (_, n) => ENTIDADES[n]);
}

function limpiarHtml(t) {
  return entidades(String(t || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function normalizar(t) {
  return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' y ').replace(/[^a-z0-9]+/g, ' ').trim();
}

function origen(url) {
  const m = String(url || '').match(/^(https?:\/\/[^/?#]+)/i);
  return m ? m[1] : '';
}

function dominio(url) {
  const m = String(url || '').match(/^(?:https?:)?\/\/([^/?#:]+)/i);
  return m ? m[1].toLowerCase() : '';
}

function absoluta(url, base) {
  if (!url) return '';
  const u = entidades(String(url).trim().replace(/\\\//g, '/'));
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('//')) return `https:${u}`;
  if (u.startsWith('/')) return origen(base) + u;
  return String(base || '').replace(/[?#].*$/, '').replace(/[^/]*$/, '') + u;
}

function atobSeguro(t) {
  try {
    return atob(String(t || '').replace(/\s+/g, ''));
  } catch (e) {
    return '';
  }
}

const VACIAS = new Set(['the', 'and', 'of', 'a', 'el', 'la', 'los', 'las', 'de', 'del', 'y', 'en', 'un', 'una']);

// 0..1: qué tan parecidos son dos títulos
function parecido(a, b) {
  const x = normalizar(a);
  const y = normalizar(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const [corto, largo] = x.length <= y.length ? [x, y] : [y, x];
  const contiene = ` ${largo} `.includes(` ${corto} `) ? 0.6 + (0.4 * corto.length) / largo.length : 0;
  const px = new Set(x.split(' ').filter((p) => !VACIAS.has(p)));
  const py = new Set(y.split(' ').filter((p) => !VACIAS.has(p)));
  let comunes = 0;
  for (const p of px) if (py.has(p)) comunes++;
  const palabras = px.size && py.size ? comunes / Math.max(px.size, py.size) : 0;
  return Math.max(contiene, palabras);
}

// Número de temporada que sugiere un título ("2nd Season", "Season 3", "II", "... 2"). 0 = ninguno.
function marcaTemporada(titulo) {
  const n = normalizar(titulo);
  let m = n.match(/\b(?:season|temporada)\s+(\d{1,2})\b/) || n.match(/\b(\d{1,2})(?:st|nd|rd|th)\s+season\b/);
  if (m) return parseInt(m[1], 10);
  if (/\biii$/.test(n)) return 3;
  if (/\bii$/.test(n)) return 2;
  if (/\biv$/.test(n)) return 4;
  m = n.match(/\s(\d)$/);
  return m ? parseInt(m[1], 10) : 0;
}

function sinMarca(titulo) {
  return normalizar(titulo)
    .replace(/\b(?:season|temporada)\s+\d{1,2}\b/g, ' ')
    .replace(/\b\d{1,2}(?:st|nd|rd|th)\s+season\b/g, ' ')
    .replace(/\b(?:iii|ii|iv)$/g, ' ')
    .replace(/\s\d$/, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Descomprime el JavaScript empaquetado tipo eval(function(p,a,c,k,e,d){...}) que usan varios reproductores
function desempacar(html) {
  const salida = [];
  const patron = /eval\(function\(p,a,c,k,e,[a-z]\)\{[\s\S]*?\}\s*\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:[^'\\]|\\.)*)'\.split\('\|'\)/g;
  const digitos = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let m;
  while ((m = patron.exec(String(html || '')))) {
    const base = parseInt(m[2], 10);
    const palabras = m[4].split('|');
    const indice = (t) => {
      let n = 0;
      for (const ch of t) {
        const v = digitos.indexOf(ch);
        if (v < 0 || v >= base) return -1;
        n = n * base + v;
      }
      return n;
    };
    salida.push(m[1].replace(/\\'/g, "'").replace(/\b\w+\b/g, (t) => {
      const i = indice(t);
      return i >= 0 && i < palabras.length && palabras[i] ? palabras[i] : t;
    }));
  }
  return salida.join('\n');
}

function buscarVideo(t, base) {
  const fuentes = [
    /["']?hls[234]["']?\s*:\s*["']([^"']+)["']/i,
    /sources\s*:\s*\[\s*\{\s*(?:src|file)\s*:\s*["']([^"']+)["']/i,
    /file\s*:\s*["']([^"']+\.(?:m3u8|mp4|txt)[^"']*)["']/i,
    /["']file["']\s*:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i,
    /sources\s*:\s*\[\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i,
    /src\s*:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i,
    /<source[^>]+src=["']([^"']+)["']/i,
    /["'](https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)["']/i,
    /["'](https?:\/\/[^"'\s]+\.mp4[^"'\s]*)["']/i
  ];
  for (const f of fuentes) {
    const m = String(t || '').match(f);
    if (m) return absoluta(m[1], base);
  }
  return '';
}

function enlace(url, headers, calidad) {
  if (!url || !/^https?:\/\//i.test(url)) return [];
  return [{ url, headers: headers || {}, calidad: calidad || '' }];
}

function etiquetaAltura(alto) {
  const h = parseInt(alto, 10) || 0;
  if (!h) return '';
  if (h >= 2000) return '4K';
  if (h >= 1400) return '1440p';
  if (h >= 1000) return '1080p';
  if (h >= 700) return '720p';
  if (h >= 470) return '480p';
  if (h >= 350) return '360p';
  return `${h}p`;
}

function calidadTexto(t) {
  const s = String(t || '');
  if (/2160|4k|uhd/i.test(s)) return '4K';
  const m = s.match(/(1440|1080|720|480|360|240)\s*p?/i);
  return m ? `${m[1]}p` : '';
}

async function calidadHls(url, headers) {
  if (!/m3u8/i.test(url) || restante() < 8000) return '';
  const t = await texto(url, { headers, limite: 5000 });
  let alto = 0;
  const patron = /RESOLUTION=\d+x(\d+)/gi;
  let m;
  while ((m = patron.exec(t))) alto = Math.max(alto, parseInt(m[1], 10));
  return etiquetaAltura(alto);
}

/* ----------------------------------------------------------------- TMDB */

async function datosTmdb(tmdbId, tipo) {
  if (!TMDB_KEY || /^PON_AQUI/.test(TMDB_KEY)) {
    console.log(`[${FUENTE}] Falta la API key de TMDB (constante TMDB_KEY)`);
    return null;
  }
  let id = String(tmdbId || '').trim();
  if (/^tt\d+$/.test(id)) {
    const f = await json(`https://api.themoviedb.org/3/find/${id}?api_key=${TMDB_KEY}&external_source=imdb_id`);
    const r = f && (tipo === 'movie' ? f.movie_results : f.tv_results);
    if (!r || !r[0]) return null;
    id = String(r[0].id);
  }
  const ruta = `https://api.themoviedb.org/3/${tipo}/${id}?api_key=${TMDB_KEY}`;
  const [es, en] = await Promise.all([
    json(`${ruta}&language=es-MX&append_to_response=alternative_titles`),
    json(`${ruta}&language=en-US`)
  ]);
  if (!es && !en) return null;
  const a = es || {};
  const b = en || {};
  const alternos = ((a.alternative_titles && (a.alternative_titles.results || a.alternative_titles.titles)) || [])
    .slice()
    .sort((x, y) => (y.iso_3166_1 === 'JP') - (x.iso_3166_1 === 'JP'))
    .map((x) => x.title);
  // Solo títulos en alfabeto latino: el nombre original japonés no sirve para buscar en JKAnime
  const latino = (t) => !!t && /^[\x20-\x7e\u00c0-\u024f]+$/.test(t);
  const vistos = new Set();
  const titulos = [a.title || a.name, b.title || b.name, a.original_title || a.original_name, ...alternos]
    .filter((t) => latino(t) && !vistos.has(normalizar(t)) && vistos.add(normalizar(t)))
    .slice(0, 5);
  return {
    titulos,
    titulo: a.title || a.name || b.title || b.name || titulos[0] || '',
    anio: String(a.release_date || a.first_air_date || b.release_date || b.first_air_date || '').slice(0, 4),
    temporadas: (a.seasons || b.seasons || []).map((x) => ({ numero: Number(x.season_number), episodios: Number(x.episode_count) || 0 }))
  };
}

// Episodios de las temporadas anteriores (para convertir S2E3 en el episodio absoluto cuando JKAnime no separa temporadas)
function episodiosPrevios(datos, temporada) {
  return datos.temporadas.filter((t) => t.numero >= 1 && t.numero < temporada).reduce((s, t) => s + t.episodios, 0);
}

/* ------------------------------------------------------------- JKAnime */

async function buscarJk(consulta) {
  const html = await texto(`${BASE}/buscar/${encodeURIComponent(consulta)}`);
  const salida = [];
  for (const trozo of html.split(/<div[^>]*class="[^"]*\banime__item\b[^"]*"/i).slice(1)) {
    const href = (trozo.match(/<a[^>]+href="([^"]+)"/i) || [])[1];
    const titulo = limpiarHtml((trozo.match(/<h5[^>]*>([\s\S]*?)<\/h5>/i) || [])[1]);
    const tipo = limpiarHtml((trozo.match(/<li[^>]*class="[^"]*\banime\b[^"]*"[^>]*>([\s\S]*?)<\/li>/i) || [])[1]);
    const slug = href ? absoluta(href, BASE).replace(/^https?:\/\/[^/]+\//, '').split(/[/?#]/)[0] : '';
    if (slug && titulo) salida.push({ slug, titulo, tipo });
  }
  return salida;
}

function consultas(titulos, temporada) {
  const lista = [];
  for (const t of titulos.slice(0, 3)) {
    lista.push(t);
    if (temporada > 1) lista.push(`${t} season ${temporada}`);
  }
  return lista.slice(0, 6);
}

// Elige la entrada de JKAnime que mejor coincide. `absoluto` = hay que usar numeración corrida (no hay entrada propia para esa temporada).
function elegir(candidatos, titulos, temporada, esPelicula) {
  let mejor = null;
  let puntos = 0;
  for (const c of candidatos) {
    const marca = marcaTemporada(c.titulo);
    const esFilm = /pel[ií]cula|movie/i.test(c.tipo || '');
    const base = sinMarca(c.titulo);
    let s = Math.max(0, ...titulos.map((t) => parecido(base, sinMarca(t))));
    if (esPelicula) {
      if (esFilm) s += 0.1;
    } else {
      if (esFilm) s -= 0.3;
      if (temporada > 1) s += marca === temporada ? 0.3 : marca > 1 ? -0.5 : 0;
      else if (marca > 1) s -= 0.4;
    }
    if (s > puntos) {
      puntos = s;
      mejor = c;
    }
  }
  if (!mejor || puntos < 0.8) return null;
  return { c: mejor, absoluto: !esPelicula && temporada > 1 && marcaTemporada(mejor.titulo) !== temporada };
}

function leerServidores(html) {
  const m = String(html || '').match(/var servers\s*=\s*(\[[\s\S]*?\]);/);
  if (!m) return [];
  let lista = [];
  try {
    lista = JSON.parse(m[1]);
  } catch (e) {
    return [];
  }
  const salida = [];
  for (const s of lista) {
    let url = s && s.remote ? atobSeguro(s.remote) : '';
    if (!/^https?:\/\//i.test(url) && s && /^https?:\/\//i.test(s.remote || '')) url = s.remote;
    url = url.replace('mega.nz/embed#!', 'mega.nz/embed/').trim();
    if (!/^https?:\/\//i.test(url)) continue;
    const nombre = String(s.server || dominio(url)).trim();
    salida.push({ nombre: nombre.charAt(0).toUpperCase() + nombre.slice(1), url, audio: IDIOMAS[s.lang] || '' });
  }
  return salida;
}

async function servidoresDe(slug, numero, esPelicula) {
  const rutas = esPelicula ? [`${BASE}/${slug}/pelicula`, `${BASE}/${slug}/1`] : [`${BASE}/${slug}/${numero}`];
  for (const ruta of rutas) {
    const servidores = leerServidores(await texto(ruta, { headers: { Referer: `${BASE}/${slug}/` } }));
    if (servidores.length) return { servidores, pagina: ruta };
  }
  return { servidores: [], pagina: '' };
}

/* ------------------------------------------------------------ resolvers */
// Cada resolver recibe la URL del embed y devuelve [{ url, headers, calidad }]

async function empaquetado(url, referer, siguiendo) {
  const propio = `${origen(url)}/`;
  const html = await texto(url, { headers: { Referer: referer || propio } });
  if (!html) return [];
  const video = buscarVideo(`${desempacar(html)}\n${html}`, url);
  if (video) return enlace(video, { Referer: propio, Origin: origen(url), 'User-Agent': UA });
  const marco = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
  if (marco && !siguiendo) return empaquetado(absoluta(marco[1], url), url, true);
  return [];
}

async function mixdrop(url, referer) {
  const embed = url.replace('/f/', '/e/');
  const html = await texto(embed, { headers: { Referer: referer || embed } });
  const m = `${desempacar(html)}\n${html}`.match(/MDCore\.wurl\s*=\s*["']([^"']+)["']/);
  return enlace(m && absoluta(m[1], embed), { Referer: `${origen(embed)}/`, 'User-Agent': UA });
}

async function streamtape(url) {
  const html = await texto(url.replace('/v/', '/e/'));
  const m = html.match(/getElementById\(['"](?:robotlink|ideoooolink|botlink)['"]\)\.innerHTML\s*=\s*['"]([^'"]+)['"]\s*\+\s*\(?['"]([^'"]+)['"]\)?((?:\.substring\(\d+\))*)/);
  if (!m) return [];
  let resto = m[2];
  for (const n of m[3].match(/\d+/g) || []) resto = resto.substring(parseInt(n, 10));
  return enlace(`https:${m[1]}${resto}&stream=1`.replace('https:https:', 'https:'), { Referer: 'https://streamtape.com/', 'User-Agent': UA });
}

async function dood(url, referer) {
  const embed = url.replace(/\/(d|f|download)\//, '/e/');
  const html = await texto(embed, { headers: { Referer: referer || embed } });
  const m = html.match(/\/pass_md5\/[\w-]+\/([\w-]+)/);
  if (!m) return [];
  const base = origen(embed);
  const prefijo = (await texto(base + m[0], { headers: { Referer: embed } })).trim();
  if (!/^https?:/.test(prefijo)) return [];
  const letras = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let azar = '';
  for (let i = 0; i < 10; i++) azar += letras[Math.floor(Math.random() * letras.length)];
  return enlace(`${prefijo}${azar}?token=${m[1]}&expiry=${Date.now()}`, { Referer: `${base}/`, 'User-Agent': UA });
}

async function okru(url) {
  const id = (url.match(/(?:videoembed|video)\/(\d+)/) || [])[1];
  if (!id) return [];
  const html = await texto(`https://ok.ru/videoembed/${id}`);
  const m = html.match(/data-options=(["'])([\s\S]+?)\1/);
  if (!m) return [];
  try {
    const vars = (JSON.parse(entidades(m[2])).flashvars) || {};
    const meta = typeof vars.metadata === 'string' ? JSON.parse(vars.metadata) : vars.metadata;
    if (!meta) return [];
    const orden = { ultra: 2160, quad: 1440, full: 1080, hd: 720, sd: 480, low: 360, lowest: 240, mobile: 144 };
    const videos = (meta.videos || []).filter((v) => v.url && orden[v.name]).sort((x, y) => orden[y.name] - orden[x.name]);
    const cab = { Referer: 'https://ok.ru/', 'User-Agent': UA };
    if (videos.length) return enlace(videos[0].url, cab, etiquetaAltura(orden[videos[0].name]));
    return enlace(meta.hlsManifestUrl || meta.ondemandHls, cab);
  } catch (e) {
    return [];
  }
}

async function mp4upload(url, referer) {
  const embed = /embed-/.test(url) ? url : url.replace(/mp4upload\.com\/(?!embed-)/, 'mp4upload.com/embed-');
  const html = await texto(embed, { headers: { Referer: referer || 'https://www.mp4upload.com/' } });
  const video = buscarVideo(`${desempacar(html)}\n${html}`, embed);
  return enlace(video, { Referer: 'https://www.mp4upload.com/', 'User-Agent': UA });
}

async function uqload(url, referer) {
  const embed = /embed-/.test(url) ? url : url.replace(/\.(?:com|co|io|net|ws|to|cx|bz)\/(?!embed-)/, (s) => `${s}embed-`);
  const html = await texto(embed, { headers: { Referer: referer || embed } });
  const m = html.match(/sources\s*:\s*\[\s*["']([^"']+)["']/);
  return enlace(m && m[1], { Referer: `${origen(embed)}/`, 'User-Agent': UA });
}

// Último recurso: busca un video en el HTML, o sigue un <iframe> (máx. 2 niveles)
async function generico(url, referer, nivel) {
  const html = await texto(url, { headers: { Referer: referer || `${origen(url)}/` } });
  if (!html) return [];
  const video = buscarVideo(`${desempacar(html)}\n${html}`, url) ||
    (html.match(/<meta[^>]+property=["']og:video(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i) || [])[1];
  if (video) return enlace(absoluta(video, url), { Referer: `${origen(url)}/`, 'User-Agent': UA });
  const marco = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
  if (marco && (nivel || 0) < 2) return resolver(absoluta(marco[1], url), url, (nivel || 0) + 1);
  return [];
}

const RESOLVEDORES = [
  [/streamwish|hlswish|vibuxer|hglink|swdyu|cybervynx|dumbalag|streamhg|filelions|vidhide|dintezuvio|minochinos|mivalyo|ryderjet|dhtpre|lulustream|luluvdo|upstream|fastream|earnvids|filemoon|moonplayer|bysezejataos/i, empaquetado],
  [/mixdrop|mxdrop|m1xdrop/i, mixdrop],
  [/streamtape|strtape|stape/i, streamtape],
  [/dood|d0000d|ds2play|dsvplay|myvidplay|do7go/i, dood],
  [/ok\.ru|odnoklassniki/i, okru],
  [/mp4upload/i, mp4upload],
  [/uqload/i, uqload]
];

async function resolver(url, referer, nivel) {
  const n = nivel || 0;
  if (!url || n > 2) return [];
  const u = absoluta(url, referer || BASE);
  if (/mega\.(?:nz|io)/i.test(u)) return []; // Mega no entrega un stream directo
  if (/\.(?:m3u8|mp4)(?:[?#]|$)/i.test(u)) return enlace(u, { Referer: `${BASE}/`, 'User-Agent': UA });
  const par = RESOLVEDORES.find(([patron]) => patron.test(dominio(u)));
  let salida = [];
  try {
    if (par) salida = await par[1](u, referer);
    if (!salida.length) salida = await generico(u, referer, n);
  } catch (e) {
    salida = [];
  }
  return salida;
}

/* ------------------------------------------------------------- salida */

async function armar(servidores, titulo, pagina) {
  const grupos = await Promise.all(servidores.map((s) =>
    conLimite(resolver(s.url, pagina || `${BASE}/`).then(async (lista) => {
      for (const l of lista) if (!l.calidad) l.calidad = (await calidadHls(l.url, l.headers)) || calidadTexto(l.url);
      return lista.map((l) => Object.assign({}, l, { servidor: s.nombre, audio: s.audio }));
    }), Math.max(1000, restante() - 3000), [])
  ));
  const vistos = new Set();
  const tarjetas = [];
  for (const s of [].concat(...grupos)) {
    if (!s.url || vistos.has(s.url)) continue;
    vistos.add(s.url);
    const t = { name: `${FUENTE} (${s.servidor})`, title: titulo, url: s.url, quality: `Calidad: ${s.calidad || 'Auto'}`, provider: FUENTE };
    if (s.audio) t.language = `Audio: ${s.audio}`;
    if (s.headers && Object.keys(s.headers).length) t.headers = s.headers;
    const alto = s.calidad === '4K' ? 2160 : parseInt(s.calidad, 10) || 0;
    tarjetas.push({ orden: (PESO_AUDIO[s.audio] || 0) * 10000 + alto, t });
  }
  return tarjetas.sort((a, b) => b.orden - a.orden).map((x) => x.t);
}

async function getStreams(tmdbId, mediaType, season, episode) {
  try {
    const tipo = mediaType === 'movie' ? 'movie' : 'tv';
    const esPelicula = tipo === 'movie';
    const datos = await datosTmdb(tmdbId, tipo);
    if (!datos || !datos.titulos.length) return [];
    const temporada = Number(season) || 1;
    const ep = Number(episode) || 1;

    let hallado = null;
    const vistos = new Map();
    for (const consulta of consultas(datos.titulos, temporada)) {
      if (restante() < 12000) break;
      for (const c of await buscarJk(consulta)) vistos.set(c.slug, c);
      hallado = elegir([...vistos.values()], datos.titulos, temporada, esPelicula);
      if (hallado) break;
    }
    if (!hallado) return [];

    const numero = hallado.absoluto ? episodiosPrevios(datos, temporada) + ep : ep;
    const { servidores, pagina } = await servidoresDe(hallado.c.slug, numero, esPelicula);
    if (!servidores.length) return [];

    const titulo = esPelicula ? (datos.anio ? `${datos.titulo} (${datos.anio})` : datos.titulo) : `${datos.titulo} - T${temporada} E${ep}`;
    return await armar(servidores, titulo, pagina);
  } catch (e) {
    console.log(`[${FUENTE}] ${e && e.message}`);
    return [];
  }
}

function limitar(fn) {
  return (...argumentos) => {
    inicio = Date.now();
    return conLimite(fn(...argumentos), PRESUPUESTO + 5000, null).then((salida) => salida || []);
  };
}

module.exports = {
  getStreams: limitar(getStreams),
  // Usado por scripts/build_jkanime.mjs (el generador del catálogo); Nuvio solo usa getStreams
  interno: { buscarJk, servidoresDe, armar, reiniciar: () => { inicio = Date.now(); } }
};
