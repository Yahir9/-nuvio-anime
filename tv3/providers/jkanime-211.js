"use strict";
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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __values = (this && this.__values) || function(o) {
    var s = typeof Symbol === "function" && Symbol.iterator, m = s && o[s], i = 0;
    if (m) return m.call(o);
    if (o && typeof o.length === "number") return {
        next: function () {
            if (o && i >= o.length) o = void 0;
            return { value: o && o[i++], done: !o };
        }
    };
    throw new TypeError(s ? "Object is not iterable." : "Symbol.iterator is not defined.");
};
var __read = (this && this.__read) || function (o, n) {
    var m = typeof Symbol === "function" && o[Symbol.iterator];
    if (!m) return o;
    var i = m.call(o), r, ar = [], e;
    try {
        while ((n === void 0 || n-- > 0) && !(r = i.next()).done) ar.push(r.value);
    }
    catch (error) { e = { error: error }; }
    finally {
        try {
            if (r && !r.done && (m = i["return"])) m.call(i);
        }
        finally { if (e) throw e.error; }
    }
    return ar;
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
// Clave gratuita de https://www.themoviedb.org/settings/api  (también se acepta la variable de entorno TMDB_KEY)
var TMDB_KEY = (typeof process !== 'undefined' && process.env && process.env.TMDB_KEY) || 'f07a533e16343c03aa94504941a905fc';
var BASE = 'https://jkanime.net';
var FUENTE = 'JKAnime';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
// Código `lang` de cada servidor en JKAnime -> etiqueta de audio.
// (jkanime.js solo distingue 1 = subtitulado y 3 = latino; el 2 es una suposición, ajústalo si hace falta)
var IDIOMAS = { 1: 'Subtitulado', 2: 'Castellano', 3: 'Latino' };
var PESO_AUDIO = { Latino: 3, Castellano: 2, Subtitulado: 1 };
var HAY_RELOJ = typeof setTimeout === 'function';
var PRESUPUESTO = 40000; // ms máximos por llamada a getStreams
var inicio = Date.now();
var motivo = ''; // por qué no hubo resultados (se muestra como fuente de diagnóstico)
var DIAGNOSTICO = true;
var restante = function () { return PRESUPUESTO - (Date.now() - inicio); };
/* ------------------------------------------------------------------ red */
function conLimite(promesa, ms, valor) {
    var trabajo = Promise.resolve(promesa).catch(function () { return valor; });
    if (!HAY_RELOJ)
        return trabajo;
    var id;
    var reloj = new Promise(function (r) {
        id = setTimeout(function () { return r(valor); }, ms);
    });
    return Promise.race([trabajo, reloj]).then(function (v) {
        clearTimeout(id);
        return v;
    });
}
// Usa el fetch nativo de Nuvio si existe; si no, el fetch normal.
function traer(url, o) {
    return __awaiter(this, void 0, void 0, function () {
        var cab, _a, _b, k, cuerpo, crudo, d, h;
        var e_1, _c;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    if (typeof __native_fetch !== 'function')
                        return [2 /*return*/, fetch(url, o)];
                    cab = {};
                    try {
                        for (_a = __values(Object.keys(o.headers || {})), _b = _a.next(); !_b.done; _b = _a.next()) {
                            k = _b.value;
                            cab[k] = String(o.headers[k]);
                        }
                    }
                    catch (e_1_1) { e_1 = { error: e_1_1 }; }
                    finally {
                        try {
                            if (_b && !_b.done && (_c = _a.return)) _c.call(_a);
                        }
                        finally { if (e_1) throw e_1.error; }
                    }
                    cuerpo = o.body === undefined || o.body === null ? null : String(o.body);
                    return [4 /*yield*/, __native_fetch(url, String(o.method || 'GET').toUpperCase(), JSON.stringify(cab), cuerpo === null ? 'none' : 'text', cuerpo || '', o.redirect !== 'manual')];
                case 1:
                    crudo = _d.sent();
                    d = JSON.parse(crudo);
                    h = d.headers || {};
                    return [2 /*return*/, {
                            ok: !!d.ok,
                            status: d.status,
                            url: d.url || url,
                            headers: { get: function (n) { return h[String(n).toLowerCase()] || null; } },
                            text: function () { return Promise.resolve(d.body || ''); },
                            json: function () {
                                try {
                                    return Promise.resolve(JSON.parse(d.body));
                                }
                                catch (e) {
                                    return Promise.resolve(null);
                                }
                            }
                        }];
            }
        });
    });
}
function pedir(url, opciones) {
    return __awaiter(this, void 0, void 0, function () {
        var o, limite;
        return __generator(this, function (_a) {
            o = Object.assign({}, opciones || {});
            limite = Math.min(o.limite || 15000, restante());
            delete o.limite;
            if (limite <= 0)
                return [2 /*return*/, null];
            o.headers = Object.assign({
                'User-Agent': UA,
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8'
            }, o.headers || {});
            return [2 /*return*/, conLimite(traer(url, o).catch(function () { return null; }), limite, null)];
        });
    });
}
function texto(url, opciones) {
    return __awaiter(this, void 0, void 0, function () {
        var r;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, pedir(url, opciones)];
                case 1:
                    r = _a.sent();
                    if (!r || !r.ok)
                        return [2 /*return*/, ''];
                    return [4 /*yield*/, conLimite(r.text(), 10000, '')];
                case 2: return [2 /*return*/, (_a.sent()) || ''];
            }
        });
    });
}
function json(url, opciones) {
    return __awaiter(this, void 0, void 0, function () {
        var t;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, texto(url, opciones)];
                case 1:
                    t = _a.sent();
                    try {
                        return [2 /*return*/, t ? JSON.parse(t) : null];
                    }
                    catch (e) {
                        return [2 /*return*/, null];
                    }
                    return [2 /*return*/];
            }
        });
    });
}
/* ------------------------------------------------------------ utilidades */
var ENTIDADES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
function entidades(t) {
    return String(t || '')
        .replace(/&#x([0-9a-f]+);/gi, function (_, h) { return String.fromCharCode(parseInt(h, 16)); })
        .replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(parseInt(d, 10)); })
        .replace(/&(amp|quot|apos|lt|gt|nbsp);/g, function (_, n) { return ENTIDADES[n]; });
}
function limpiarHtml(t) {
    return entidades(String(t || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}
function normalizar(t) {
    return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/['\u2019\u2018`\u00b4]/g, '').replace(/&/g, ' y ').replace(/[^a-z0-9]+/g, ' ').trim();
}
function origen(url) {
    var m = String(url || '').match(/^(https?:\/\/[^/?#]+)/i);
    return m ? m[1] : '';
}
function dominio(url) {
    var m = String(url || '').match(/^(?:https?:)?\/\/([^/?#:]+)/i);
    return m ? m[1].toLowerCase() : '';
}
function absoluta(url, base) {
    if (!url)
        return '';
    var u = entidades(String(url).trim().replace(/\\\//g, '/'));
    if (/^https?:\/\//i.test(u))
        return u;
    if (u.startsWith('//'))
        return "https:".concat(u);
    if (u.startsWith('/'))
        return origen(base) + u;
    return String(base || '').replace(/[?#].*$/, '').replace(/[^/]*$/, '') + u;
}
function atobSeguro(t) {
    try {
        return atob(String(t || '').replace(/\s+/g, ''));
    }
    catch (e) {
        return '';
    }
}
var VACIAS = new Set(['the', 'and', 'of', 'a', 'el', 'la', 'los', 'las', 'de', 'del', 'y', 'en', 'un', 'una']);
// 0..1: qué tan parecidos son dos títulos
function parecido(a, b) {
    var e_2, _a;
    var x = normalizar(a);
    var y = normalizar(b);
    if (!x || !y)
        return 0;
    if (x === y)
        return 1;
    var _b = __read(x.length <= y.length ? [x, y] : [y, x], 2), corto = _b[0], largo = _b[1];
    var contiene = " ".concat(largo, " ").includes(" ".concat(corto, " ")) ? 0.6 + (0.4 * corto.length) / largo.length : 0;
    var px = new Set(x.split(' ').filter(function (p) { return !VACIAS.has(p); }));
    var py = new Set(y.split(' ').filter(function (p) { return !VACIAS.has(p); }));
    var comunes = 0;
    try {
        for (var px_1 = __values(px), px_1_1 = px_1.next(); !px_1_1.done; px_1_1 = px_1.next()) {
            var p = px_1_1.value;
            if (py.has(p))
                comunes++;
        }
    }
    catch (e_2_1) { e_2 = { error: e_2_1 }; }
    finally {
        try {
            if (px_1_1 && !px_1_1.done && (_a = px_1.return)) _a.call(px_1);
        }
        finally { if (e_2) throw e_2.error; }
    }
    var palabras = px.size && py.size ? comunes / Math.max(px.size, py.size) : 0;
    return Math.max(contiene, palabras);
}
// Número de temporada que sugiere un título ("2nd Season", "Season 3", "II", "... 2"). 0 = ninguno.
function marcaTemporada(titulo) {
    var n = normalizar(titulo);
    var m = n.match(/\b(?:season|temporada)\s+(\d{1,2})\b/) || n.match(/\b(\d{1,2})(?:st|nd|rd|th)\s+season\b/);
    if (m)
        return parseInt(m[1], 10);
    if (/\biii$/.test(n))
        return 3;
    if (/\bii$/.test(n))
        return 2;
    if (/\biv$/.test(n))
        return 4;
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
    var salida = [];
    var patron = /eval\(function\(p,a,c,k,e,[a-z]\)\{[\s\S]*?\}\s*\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:[^'\\]|\\.)*)'\.split\('\|'\)/g;
    var digitos = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    var m;
    var _loop_1 = function () {
        var base = parseInt(m[2], 10);
        var palabras = m[4].split('|');
        var indice = function (t) {
            var e_3, _a;
            var n = 0;
            try {
                for (var t_1 = (e_3 = void 0, __values(t)), t_1_1 = t_1.next(); !t_1_1.done; t_1_1 = t_1.next()) {
                    var ch = t_1_1.value;
                    var v = digitos.indexOf(ch);
                    if (v < 0 || v >= base)
                        return -1;
                    n = n * base + v;
                }
            }
            catch (e_3_1) { e_3 = { error: e_3_1 }; }
            finally {
                try {
                    if (t_1_1 && !t_1_1.done && (_a = t_1.return)) _a.call(t_1);
                }
                finally { if (e_3) throw e_3.error; }
            }
            return n;
        };
        salida.push(m[1].replace(/\\'/g, "'").replace(/\b\w+\b/g, function (t) {
            var i = indice(t);
            return i >= 0 && i < palabras.length && palabras[i] ? palabras[i] : t;
        }));
    };
    while ((m = patron.exec(String(html || '')))) {
        _loop_1();
    }
    return salida.join('\n');
}
function buscarVideo(t, base) {
    var e_4, _a;
    var fuentes = [
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
    try {
        for (var fuentes_1 = __values(fuentes), fuentes_1_1 = fuentes_1.next(); !fuentes_1_1.done; fuentes_1_1 = fuentes_1.next()) {
            var f = fuentes_1_1.value;
            var m = String(t || '').match(f);
            if (m)
                return absoluta(m[1], base);
        }
    }
    catch (e_4_1) { e_4 = { error: e_4_1 }; }
    finally {
        try {
            if (fuentes_1_1 && !fuentes_1_1.done && (_a = fuentes_1.return)) _a.call(fuentes_1);
        }
        finally { if (e_4) throw e_4.error; }
    }
    return '';
}
function enlace(url, headers, calidad) {
    if (!url || !/^https?:\/\//i.test(url))
        return [];
    return [{ url: url, headers: headers || {}, calidad: calidad || '' }];
}
function etiquetaAltura(alto) {
    var h = parseInt(alto, 10) || 0;
    if (!h)
        return '';
    if (h >= 2000)
        return '4K';
    if (h >= 1400)
        return '1440p';
    if (h >= 1000)
        return '1080p';
    if (h >= 700)
        return '720p';
    if (h >= 470)
        return '480p';
    if (h >= 350)
        return '360p';
    return "".concat(h, "p");
}
function calidadTexto(t) {
    var s = String(t || '');
    if (/2160|4k|uhd/i.test(s))
        return '4K';
    var m = s.match(/(1440|1080|720|480|360|240)\s*p?/i);
    return m ? "".concat(m[1], "p") : '';
}
function calidadHls(url, headers) {
    return __awaiter(this, void 0, void 0, function () {
        var t, alto, patron, m;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!/m3u8/i.test(url) || restante() < 8000)
                        return [2 /*return*/, ''];
                    return [4 /*yield*/, texto(url, { headers: headers, limite: 5000 })];
                case 1:
                    t = _a.sent();
                    alto = 0;
                    patron = /RESOLUTION=\d+x(\d+)/gi;
                    while ((m = patron.exec(t)))
                        alto = Math.max(alto, parseInt(m[1], 10));
                    return [2 /*return*/, etiquetaAltura(alto)];
            }
        });
    });
}
/* ----------------------------------------------------------------- TMDB */
function datosTmdb(tmdbId, tipo) {
    return __awaiter(this, void 0, void 0, function () {
        var id, f, r, ruta, _a, es, en, a, b, alternos, latino, vistos, titulos;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    if (!TMDB_KEY || /^PON_AQUI/.test(TMDB_KEY)) {
                        console.log("[".concat(FUENTE, "] Falta la API key de TMDB (constante TMDB_KEY)"));
                        return [2 /*return*/, null];
                    }
                    id = String(tmdbId || '').trim();
                    if (!/^tt\d+$/.test(id)) return [3 /*break*/, 2];
                    return [4 /*yield*/, json("https://api.themoviedb.org/3/find/".concat(id, "?api_key=").concat(TMDB_KEY, "&external_source=imdb_id"))];
                case 1:
                    f = _b.sent();
                    r = f && (tipo === 'movie' ? f.movie_results : f.tv_results);
                    if (!r || !r[0])
                        return [2 /*return*/, null];
                    id = String(r[0].id);
                    _b.label = 2;
                case 2:
                    ruta = "https://api.themoviedb.org/3/".concat(tipo, "/").concat(id, "?api_key=").concat(TMDB_KEY);
                    return [4 /*yield*/, Promise.all([
                            json("".concat(ruta, "&language=es-MX&append_to_response=alternative_titles")),
                            json("".concat(ruta, "&language=en-US"))
                        ])];
                case 3:
                    _a = __read.apply(void 0, [_b.sent(), 2]), es = _a[0], en = _a[1];
                    if (!es && !en)
                        return [2 /*return*/, null];
                    a = es || {};
                    b = en || {};
                    alternos = ((a.alternative_titles && (a.alternative_titles.results || a.alternative_titles.titles)) || [])
                        .slice()
                        .sort(function (x, y) { return (y.iso_3166_1 === 'JP') - (x.iso_3166_1 === 'JP'); })
                        .map(function (x) { return x.title; });
                    latino = function (t) { return !!t && /^[\x20-\x7e\u00c0-\u024f]+$/.test(t); };
                    vistos = new Set();
                    titulos = __spreadArray([a.title || a.name, b.title || b.name, a.original_title || a.original_name], __read(alternos), false).filter(function (t) { return latino(t) && !vistos.has(normalizar(t)) && vistos.add(normalizar(t)); })
                        .slice(0, 5);
                    return [2 /*return*/, {
                            titulos: titulos,
                            titulo: a.title || a.name || b.title || b.name || titulos[0] || '',
                            anio: String(a.release_date || a.first_air_date || b.release_date || b.first_air_date || '').slice(0, 4),
                            temporadas: (a.seasons || b.seasons || []).map(function (x) { return ({ numero: Number(x.season_number), episodios: Number(x.episode_count) || 0 }); })
                        }];
            }
        });
    });
}
// Episodios de las temporadas anteriores (para convertir S2E3 en el episodio absoluto cuando JKAnime no separa temporadas)
function episodiosPrevios(datos, temporada) {
    return datos.temporadas.filter(function (t) { return t.numero >= 1 && t.numero < temporada; }).reduce(function (s, t) { return s + t.episodios; }, 0);
}
/* ------------------------------------------------------------- JKAnime */
function buscarJk(consulta) {
    return __awaiter(this, void 0, void 0, function () {
        var html, salida, _a, _b, trozo, href, titulo, tipo, slug;
        var e_5, _c;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0: return [4 /*yield*/, texto("".concat(BASE, "/buscar/").concat(encodeURIComponent(consulta)))];
                case 1:
                    html = _d.sent();
                    salida = [];
                    try {
                        for (_a = __values(html.split(/<div[^>]*class="[^"]*\banime__item\b[^"]*"/i).slice(1)), _b = _a.next(); !_b.done; _b = _a.next()) {
                            trozo = _b.value;
                            href = (trozo.match(/<a[^>]+href="([^"]+)"/i) || [])[1];
                            titulo = limpiarHtml((trozo.match(/<h5[^>]*>([\s\S]*?)<\/h5>/i) || [])[1]);
                            tipo = limpiarHtml((trozo.match(/<li[^>]*class="[^"]*\banime\b[^"]*"[^>]*>([\s\S]*?)<\/li>/i) || [])[1]);
                            slug = href ? absoluta(href, BASE).replace(/^https?:\/\/[^/]+\//, '').split(/[/?#]/)[0] : '';
                            if (slug && titulo)
                                salida.push({ slug: slug, titulo: titulo, tipo: tipo });
                        }
                    }
                    catch (e_5_1) { e_5 = { error: e_5_1 }; }
                    finally {
                        try {
                            if (_b && !_b.done && (_c = _a.return)) _c.call(_a);
                        }
                        finally { if (e_5) throw e_5.error; }
                    }
                    return [2 /*return*/, salida];
            }
        });
    });
}
function consultas(titulos, temporada) {
    var e_6, _a;
    var lista = [];
    try {
        for (var _b = __values(titulos.slice(0, 3)), _c = _b.next(); !_c.done; _c = _b.next()) {
            var t = _c.value;
            lista.push(t);
            if (temporada > 1)
                lista.push("".concat(t, " season ").concat(temporada));
        }
    }
    catch (e_6_1) { e_6 = { error: e_6_1 }; }
    finally {
        try {
            if (_c && !_c.done && (_a = _b.return)) _a.call(_b);
        }
        finally { if (e_6) throw e_6.error; }
    }
    return lista.slice(0, 6);
}
// Elige la entrada de JKAnime que mejor coincide. `absoluto` = hay que usar numeración corrida (no hay entrada propia para esa temporada).
function elegir(candidatos, titulos, temporada, esPelicula) {
    var e_7, _a;
    var mejor = null;
    var puntos = 0;
    var _loop_2 = function (c) {
        var marca = marcaTemporada(c.titulo);
        var esFilm = /pel[ií]cula|movie/i.test(c.tipo || '');
        var base = sinMarca(c.titulo);
        var s = Math.max.apply(Math, __spreadArray([0], __read(titulos.map(function (t) { return parecido(base, sinMarca(t)); })), false));
        if (esPelicula) {
            if (esFilm)
                s += 0.1;
        }
        else {
            if (esFilm)
                s -= 0.3;
            if (temporada > 1)
                s += marca === temporada ? 0.3 : marca > 1 ? -0.5 : 0;
            else if (marca > 1)
                s -= 0.4;
        }
        if (s > puntos) {
            puntos = s;
            mejor = c;
        }
    };
    try {
        for (var candidatos_1 = __values(candidatos), candidatos_1_1 = candidatos_1.next(); !candidatos_1_1.done; candidatos_1_1 = candidatos_1.next()) {
            var c = candidatos_1_1.value;
            _loop_2(c);
        }
    }
    catch (e_7_1) { e_7 = { error: e_7_1 }; }
    finally {
        try {
            if (candidatos_1_1 && !candidatos_1_1.done && (_a = candidatos_1.return)) _a.call(candidatos_1);
        }
        finally { if (e_7) throw e_7.error; }
    }
    if (!mejor || puntos < 0.8)
        return null;
    return { c: mejor, absoluto: !esPelicula && temporada > 1 && marcaTemporada(mejor.titulo) !== temporada };
}
function leerServidores(html) {
    var e_8, _a;
    var m = String(html || '').match(/var servers\s*=\s*(\[[\s\S]*?\]);/);
    if (!m)
        return [];
    var lista = [];
    try {
        lista = JSON.parse(m[1]);
    }
    catch (e) {
        return [];
    }
    var salida = [];
    try {
        for (var lista_1 = __values(lista), lista_1_1 = lista_1.next(); !lista_1_1.done; lista_1_1 = lista_1.next()) {
            var s = lista_1_1.value;
            var url = s && s.remote ? atobSeguro(s.remote) : '';
            if (!/^https?:\/\//i.test(url) && s && /^https?:\/\//i.test(s.remote || ''))
                url = s.remote;
            url = url.replace('mega.nz/embed#!', 'mega.nz/embed/').trim();
            if (!/^https?:\/\//i.test(url))
                continue;
            var nombre = String(s.server || dominio(url)).trim();
            salida.push({ nombre: nombre.charAt(0).toUpperCase() + nombre.slice(1), url: url, audio: IDIOMAS[s.lang] || '' });
        }
    }
    catch (e_8_1) { e_8 = { error: e_8_1 }; }
    finally {
        try {
            if (lista_1_1 && !lista_1_1.done && (_a = lista_1.return)) _a.call(lista_1);
        }
        finally { if (e_8) throw e_8.error; }
    }
    return salida;
}
function servidoresDe(slug, numero, esPelicula) {
    return __awaiter(this, void 0, void 0, function () {
        var rutas, rutas_1, rutas_1_1, ruta, servidores, _a, e_9_1;
        var e_9, _b;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    rutas = esPelicula ? ["".concat(BASE, "/").concat(slug, "/pelicula"), "".concat(BASE, "/").concat(slug, "/1")] : ["".concat(BASE, "/").concat(slug, "/").concat(numero)];
                    _c.label = 1;
                case 1:
                    _c.trys.push([1, 6, 7, 8]);
                    rutas_1 = __values(rutas), rutas_1_1 = rutas_1.next();
                    _c.label = 2;
                case 2:
                    if (!!rutas_1_1.done) return [3 /*break*/, 5];
                    ruta = rutas_1_1.value;
                    _a = leerServidores;
                    return [4 /*yield*/, texto(ruta, { headers: { Referer: "".concat(BASE, "/").concat(slug, "/") } })];
                case 3:
                    servidores = _a.apply(void 0, [_c.sent()]);
                    if (servidores.length)
                        return [2 /*return*/, { servidores: servidores, pagina: ruta }];
                    _c.label = 4;
                case 4:
                    rutas_1_1 = rutas_1.next();
                    return [3 /*break*/, 2];
                case 5: return [3 /*break*/, 8];
                case 6:
                    e_9_1 = _c.sent();
                    e_9 = { error: e_9_1 };
                    return [3 /*break*/, 8];
                case 7:
                    try {
                        if (rutas_1_1 && !rutas_1_1.done && (_b = rutas_1.return)) _b.call(rutas_1);
                    }
                    finally { if (e_9) throw e_9.error; }
                    return [7 /*endfinally*/];
                case 8: return [2 /*return*/, { servidores: [], pagina: '' }];
            }
        });
    });
}
/* ------------------------------------------------------------ resolvers */
// Cada resolver recibe la URL del embed y devuelve [{ url, headers, calidad }]
function empaquetado(url, referer, siguiendo) {
    return __awaiter(this, void 0, void 0, function () {
        var propio, html, video, marco;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    propio = "".concat(origen(url), "/");
                    return [4 /*yield*/, texto(url, { headers: { Referer: referer || propio } })];
                case 1:
                    html = _a.sent();
                    if (!html)
                        return [2 /*return*/, []];
                    video = buscarVideo("".concat(desempacar(html), "\n").concat(html), url);
                    if (video)
                        return [2 /*return*/, enlace(video, { Referer: propio, Origin: origen(url), 'User-Agent': UA })];
                    marco = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
                    if (marco && !siguiendo)
                        return [2 /*return*/, empaquetado(absoluta(marco[1], url), url, true)];
                    return [2 /*return*/, []];
            }
        });
    });
}
function mixdrop(url, referer) {
    return __awaiter(this, void 0, void 0, function () {
        var embed, html, m;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    embed = url.replace('/f/', '/e/');
                    return [4 /*yield*/, texto(embed, { headers: { Referer: referer || embed } })];
                case 1:
                    html = _a.sent();
                    m = "".concat(desempacar(html), "\n").concat(html).match(/MDCore\.wurl\s*=\s*["']([^"']+)["']/);
                    return [2 /*return*/, enlace(m && absoluta(m[1], embed), { Referer: "".concat(origen(embed), "/"), 'User-Agent': UA })];
            }
        });
    });
}
function streamtape(url) {
    return __awaiter(this, void 0, void 0, function () {
        var html, m, resto, _a, _b, n;
        var e_10, _c;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0: return [4 /*yield*/, texto(url.replace('/v/', '/e/'))];
                case 1:
                    html = _d.sent();
                    m = html.match(/getElementById\(['"](?:robotlink|ideoooolink|botlink)['"]\)\.innerHTML\s*=\s*['"]([^'"]+)['"]\s*\+\s*\(?['"]([^'"]+)['"]\)?((?:\.substring\(\d+\))*)/);
                    if (!m)
                        return [2 /*return*/, []];
                    resto = m[2];
                    try {
                        for (_a = __values(m[3].match(/\d+/g) || []), _b = _a.next(); !_b.done; _b = _a.next()) {
                            n = _b.value;
                            resto = resto.substring(parseInt(n, 10));
                        }
                    }
                    catch (e_10_1) { e_10 = { error: e_10_1 }; }
                    finally {
                        try {
                            if (_b && !_b.done && (_c = _a.return)) _c.call(_a);
                        }
                        finally { if (e_10) throw e_10.error; }
                    }
                    return [2 /*return*/, enlace("https:".concat(m[1]).concat(resto, "&stream=1").replace('https:https:', 'https:'), { Referer: 'https://streamtape.com/', 'User-Agent': UA })];
            }
        });
    });
}
function dood(url, referer) {
    return __awaiter(this, void 0, void 0, function () {
        var embed, html, m, base, prefijo, letras, azar, i;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    embed = url.replace(/\/(d|f|download)\//, '/e/');
                    return [4 /*yield*/, texto(embed, { headers: { Referer: referer || embed } })];
                case 1:
                    html = _a.sent();
                    m = html.match(/\/pass_md5\/[\w-]+\/([\w-]+)/);
                    if (!m)
                        return [2 /*return*/, []];
                    base = origen(embed);
                    return [4 /*yield*/, texto(base + m[0], { headers: { Referer: embed } })];
                case 2:
                    prefijo = (_a.sent()).trim();
                    if (!/^https?:/.test(prefijo))
                        return [2 /*return*/, []];
                    letras = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
                    azar = '';
                    for (i = 0; i < 10; i++)
                        azar += letras[Math.floor(Math.random() * letras.length)];
                    return [2 /*return*/, enlace("".concat(prefijo).concat(azar, "?token=").concat(m[1], "&expiry=").concat(Date.now()), { Referer: "".concat(base, "/"), 'User-Agent': UA })];
            }
        });
    });
}
function okru(url) {
    return __awaiter(this, void 0, void 0, function () {
        var id, html, m, vars, meta, orden_1, videos, cab;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    id = (url.match(/(?:videoembed|video)\/(\d+)/) || [])[1];
                    if (!id)
                        return [2 /*return*/, []];
                    return [4 /*yield*/, texto("https://ok.ru/videoembed/".concat(id))];
                case 1:
                    html = _a.sent();
                    m = html.match(/data-options=(["'])([\s\S]+?)\1/);
                    if (!m)
                        return [2 /*return*/, []];
                    try {
                        vars = (JSON.parse(entidades(m[2])).flashvars) || {};
                        meta = typeof vars.metadata === 'string' ? JSON.parse(vars.metadata) : vars.metadata;
                        if (!meta)
                            return [2 /*return*/, []];
                        orden_1 = { ultra: 2160, quad: 1440, full: 1080, hd: 720, sd: 480, low: 360, lowest: 240, mobile: 144 };
                        videos = (meta.videos || []).filter(function (v) { return v.url && orden_1[v.name]; }).sort(function (x, y) { return orden_1[y.name] - orden_1[x.name]; });
                        cab = { Referer: 'https://ok.ru/', 'User-Agent': UA };
                        if (videos.length)
                            return [2 /*return*/, enlace(videos[0].url, cab, etiquetaAltura(orden_1[videos[0].name]))];
                        return [2 /*return*/, enlace(meta.hlsManifestUrl || meta.ondemandHls, cab)];
                    }
                    catch (e) {
                        return [2 /*return*/, []];
                    }
                    return [2 /*return*/];
            }
        });
    });
}
function mp4upload(url, referer) {
    return __awaiter(this, void 0, void 0, function () {
        var embed, html, video;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    embed = /embed-/.test(url) ? url : url.replace(/mp4upload\.com\/(?!embed-)/, 'mp4upload.com/embed-');
                    return [4 /*yield*/, texto(embed, { headers: { Referer: referer || 'https://www.mp4upload.com/' } })];
                case 1:
                    html = _a.sent();
                    video = buscarVideo("".concat(desempacar(html), "\n").concat(html), embed);
                    return [2 /*return*/, enlace(video, { Referer: 'https://www.mp4upload.com/', 'User-Agent': UA })];
            }
        });
    });
}
function uqload(url, referer) {
    return __awaiter(this, void 0, void 0, function () {
        var embed, html, m;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    embed = /embed-/.test(url) ? url : url.replace(/\.(?:com|co|io|net|ws|to|cx|bz)\/(?!embed-)/, function (s) { return "".concat(s, "embed-"); });
                    return [4 /*yield*/, texto(embed, { headers: { Referer: referer || embed } })];
                case 1:
                    html = _a.sent();
                    m = html.match(/sources\s*:\s*\[\s*["']([^"']+)["']/);
                    return [2 /*return*/, enlace(m && m[1], { Referer: "".concat(origen(embed), "/"), 'User-Agent': UA })];
            }
        });
    });
}
// Último recurso: busca un video en el HTML, o sigue un <iframe> (máx. 2 niveles)
function generico(url, referer, nivel) {
    return __awaiter(this, void 0, void 0, function () {
        var html, video, marco;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, texto(url, { headers: { Referer: referer || "".concat(origen(url), "/") } })];
                case 1:
                    html = _a.sent();
                    if (!html)
                        return [2 /*return*/, []];
                    video = buscarVideo("".concat(desempacar(html), "\n").concat(html), url) ||
                        (html.match(/<meta[^>]+property=["']og:video(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i) || [])[1];
                    if (video)
                        return [2 /*return*/, enlace(absoluta(video, url), { Referer: "".concat(origen(url), "/"), 'User-Agent': UA })];
                    marco = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
                    if (marco && (nivel || 0) < 2)
                        return [2 /*return*/, resolver(absoluta(marco[1], url), url, (nivel || 0) + 1)];
                    return [2 /*return*/, []];
            }
        });
    });
}
var RESOLVEDORES = [
    [/streamwish|hlswish|vibuxer|hglink|swdyu|cybervynx|dumbalag|streamhg|filelions|vidhide|dintezuvio|minochinos|mivalyo|ryderjet|dhtpre|lulustream|luluvdo|upstream|fastream|earnvids|filemoon|moonplayer|bysezejataos/i, empaquetado],
    [/mixdrop|mxdrop|m1xdrop/i, mixdrop],
    [/streamtape|strtape|stape/i, streamtape],
    [/dood|d0000d|ds2play|dsvplay|myvidplay|do7go/i, dood],
    [/ok\.ru|odnoklassniki/i, okru],
    [/mp4upload/i, mp4upload],
    [/uqload/i, uqload]
];
function resolver(url, referer, nivel) {
    return __awaiter(this, void 0, void 0, function () {
        var n, u, par, salida, e_11;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    n = nivel || 0;
                    if (!url || n > 2)
                        return [2 /*return*/, []];
                    u = absoluta(url, referer || BASE);
                    if (/mega\.(?:nz|io)/i.test(u))
                        return [2 /*return*/, []]; // Mega no entrega un stream directo
                    if (/\.(?:m3u8|mp4)(?:[?#]|$)/i.test(u))
                        return [2 /*return*/, enlace(u, { Referer: "".concat(BASE, "/"), 'User-Agent': UA })];
                    par = RESOLVEDORES.find(function (_a) {
                        var _b = __read(_a, 1), patron = _b[0];
                        return patron.test(dominio(u));
                    });
                    salida = [];
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 6, , 7]);
                    if (!par) return [3 /*break*/, 3];
                    return [4 /*yield*/, par[1](u, referer)];
                case 2:
                    salida = _a.sent();
                    _a.label = 3;
                case 3:
                    if (!!salida.length) return [3 /*break*/, 5];
                    return [4 /*yield*/, generico(u, referer, n)];
                case 4:
                    salida = _a.sent();
                    _a.label = 5;
                case 5: return [3 /*break*/, 7];
                case 6:
                    e_11 = _a.sent();
                    salida = [];
                    return [3 /*break*/, 7];
                case 7: return [2 /*return*/, salida];
            }
        });
    });
}
/* ------------------------------------------------------------- salida */
// Servidores que no reproducen en Nuvio (confirmado en pruebas): se omiten
var NO_FUNCIONAN = /streamtape|strtape|stape|mediafire/i;
function armar(servidores, titulo, pagina) {
    return __awaiter(this, void 0, void 0, function () {
        var grupos, vistos, tarjetas, _a, _b, s, t, alto;
        var e_12, _c;
        var _this = this;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    servidores = servidores.filter(function (s) { return !NO_FUNCIONAN.test("".concat(s.nombre, " ").concat(dominio(s.url))); });
                    return [4 /*yield*/, Promise.all(servidores.map(function (s) {
                            return conLimite(resolver(s.url, pagina || "".concat(BASE, "/")).then(function (lista) { return __awaiter(_this, void 0, void 0, function () {
                                var lista_2, lista_2_1, l, _a, e_13_1;
                                var e_13, _b;
                                return __generator(this, function (_c) {
                                    switch (_c.label) {
                                        case 0:
                                            _c.trys.push([0, 5, 6, 7]);
                                            lista_2 = __values(lista), lista_2_1 = lista_2.next();
                                            _c.label = 1;
                                        case 1:
                                            if (!!lista_2_1.done) return [3 /*break*/, 4];
                                            l = lista_2_1.value;
                                            if (!!l.calidad) return [3 /*break*/, 3];
                                            _a = l;
                                            return [4 /*yield*/, calidadHls(l.url, l.headers)];
                                        case 2:
                                            _a.calidad = (_c.sent()) || calidadTexto(l.url);
                                            _c.label = 3;
                                        case 3:
                                            lista_2_1 = lista_2.next();
                                            return [3 /*break*/, 1];
                                        case 4: return [3 /*break*/, 7];
                                        case 5:
                                            e_13_1 = _c.sent();
                                            e_13 = { error: e_13_1 };
                                            return [3 /*break*/, 7];
                                        case 6:
                                            try {
                                                if (lista_2_1 && !lista_2_1.done && (_b = lista_2.return)) _b.call(lista_2);
                                            }
                                            finally { if (e_13) throw e_13.error; }
                                            return [7 /*endfinally*/];
                                        case 7: return [2 /*return*/, lista.map(function (l) { return Object.assign({}, l, { servidor: s.nombre, audio: s.audio }); })];
                                    }
                                });
                            }); }), Math.max(1000, restante() - 3000), []);
                        }))];
                case 1:
                    grupos = _d.sent();
                    vistos = new Set();
                    tarjetas = [];
                    try {
                        for (_a = __values([].concat.apply([], __spreadArray([], __read(grupos), false))), _b = _a.next(); !_b.done; _b = _a.next()) {
                            s = _b.value;
                            if (!s.url || vistos.has(s.url))
                                continue;
                            vistos.add(s.url);
                            t = { name: "".concat(FUENTE, " (").concat(s.servidor, ")"), title: titulo, url: s.url, quality: "Calidad: ".concat(s.calidad || 'Auto'), provider: FUENTE };
                            if (s.audio)
                                t.language = "Audio: ".concat(s.audio);
                            if (s.headers && Object.keys(s.headers).length)
                                t.headers = s.headers;
                            alto = s.calidad === '4K' ? 2160 : parseInt(s.calidad, 10) || 0;
                            tarjetas.push({ orden: (PESO_AUDIO[s.audio] || 0) * 10000 + alto, t: t });
                        }
                    }
                    catch (e_12_1) { e_12 = { error: e_12_1 }; }
                    finally {
                        try {
                            if (_b && !_b.done && (_c = _a.return)) _c.call(_a);
                        }
                        finally { if (e_12) throw e_12.error; }
                    }
                    return [2 /*return*/, tarjetas.sort(function (a, b) { return b.orden - a.orden; }).map(function (x) { return x.t; })];
            }
        });
    });
}
function getStreams(tmdbId, mediaType, season, episode) {
    return __awaiter(this, void 0, void 0, function () {
        var tipo, esPelicula, datos, temporada, ep, hallado, vistos, _a, _b, consulta, _c, _d, c, e_14_1, e_15_1, numero, _e, servidores, pagina, titulo, salida, e_16;
        var e_15, _f, e_14, _g;
        return __generator(this, function (_h) {
            switch (_h.label) {
                case 0:
                    _h.trys.push([0, 19, , 20]);
                    tipo = mediaType === 'movie' ? 'movie' : 'tv';
                    esPelicula = tipo === 'movie';
                    return [4 /*yield*/, datosTmdb(tmdbId, tipo)];
                case 1:
                    datos = _h.sent();
                    if (!datos || !datos.titulos.length) {
                        motivo = 'No se pudieron leer los títulos en TMDB (revisa la API key)';
                        return [2 /*return*/, []];
                    }
                    temporada = Number(season) || 1;
                    ep = Number(episode) || 1;
                    hallado = null;
                    vistos = new Map();
                    _h.label = 2;
                case 2:
                    _h.trys.push([2, 14, 15, 16]);
                    _a = __values(consultas(datos.titulos, temporada)), _b = _a.next();
                    _h.label = 3;
                case 3:
                    if (!!_b.done) return [3 /*break*/, 13];
                    consulta = _b.value;
                    if (restante() < 12000)
                        return [3 /*break*/, 13];
                    _h.label = 4;
                case 4:
                    _h.trys.push([4, 9, 10, 11]);
                    e_14 = void 0;
                    return [4 /*yield*/, buscarJk(consulta)];
                case 5:
                    _c = (__values.apply(void 0, [_h.sent()])), _d = _c.next();
                    _h.label = 6;
                case 6:
                    if (!!_d.done) return [3 /*break*/, 8];
                    c = _d.value;
                    vistos.set(c.slug, c);
                    _h.label = 7;
                case 7:
                    _d = _c.next();
                    return [3 /*break*/, 6];
                case 8: return [3 /*break*/, 11];
                case 9:
                    e_14_1 = _h.sent();
                    e_14 = { error: e_14_1 };
                    return [3 /*break*/, 11];
                case 10:
                    try {
                        if (_d && !_d.done && (_g = _c.return)) _g.call(_c);
                    }
                    finally { if (e_14) throw e_14.error; }
                    return [7 /*endfinally*/];
                case 11:
                    hallado = elegir(__spreadArray([], __read(vistos.values()), false), datos.titulos, temporada, esPelicula);
                    if (hallado)
                        return [3 /*break*/, 13];
                    _h.label = 12;
                case 12:
                    _b = _a.next();
                    return [3 /*break*/, 3];
                case 13: return [3 /*break*/, 16];
                case 14:
                    e_15_1 = _h.sent();
                    e_15 = { error: e_15_1 };
                    return [3 /*break*/, 16];
                case 15:
                    try {
                        if (_b && !_b.done && (_f = _a.return)) _f.call(_a);
                    }
                    finally { if (e_15) throw e_15.error; }
                    return [7 /*endfinally*/];
                case 16:
                    if (!hallado) {
                        motivo = "JKAnime no devolvi\u00F3 coincidencias para: ".concat(datos.titulos.slice(0, 3).join(' | '), " (").concat(vistos.size, " resultados vistos").concat(vistos.size ? ': ' + __spreadArray([], __read(vistos.values()), false).slice(0, 3).map(function (c) { return c.titulo; }).join(' | ') : ', 0 = el sitio bloqueó o cambió', ")");
                        return [2 /*return*/, []];
                    }
                    numero = hallado.absoluto ? episodiosPrevios(datos, temporada) + ep : ep;
                    return [4 /*yield*/, servidoresDe(hallado.c.slug, numero, esPelicula)];
                case 17:
                    _e = _h.sent(), servidores = _e.servidores, pagina = _e.pagina;
                    if (!servidores.length) {
                        motivo = "Encontr\u00E9 ".concat(hallado.c.slug, " pero el episodio ").concat(numero, " no tiene servidores");
                        return [2 /*return*/, []];
                    }
                    titulo = esPelicula ? (datos.anio ? "".concat(datos.titulo, " (").concat(datos.anio, ")") : datos.titulo) : "".concat(datos.titulo, " - T").concat(temporada, " E").concat(ep);
                    return [4 /*yield*/, armar(servidores, titulo, pagina)];
                case 18:
                    salida = _h.sent();
                    if (!salida.length)
                        motivo = "Servidores encontrados (".concat(servidores.map(function (x) { return x.nombre; }).join(', '), ") pero ninguno dio un video directo");
                    return [2 /*return*/, salida];
                case 19:
                    e_16 = _h.sent();
                    console.log("[".concat(FUENTE, "] ").concat(e_16 && e_16.message));
                    return [2 /*return*/, []];
                case 20: return [2 /*return*/];
            }
        });
    });
}
function limitar(fn) {
    return function () {
        var argumentos = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            argumentos[_i] = arguments[_i];
        }
        inicio = Date.now();
        motivo = '';
        // Solo ID de TMDB (123) o de IMDb (tt123): lo demás (p. ej. partidos "dep_…" del addon de deportes) no es de este plugin
        if (!/^(\d+|tt\d+)$/.test(String(argumentos[0] || '').trim()))
            return Promise.resolve([]);
        return conLimite(fn.apply(void 0, __spreadArray([], __read(argumentos), false)), PRESUPUESTO + 5000, null).then(function (salida) {
            if (salida && salida.length)
                return salida;
            if (!DIAGNOSTICO)
                return [];
            var por = motivo || 'Sin respuesta a tiempo (tardó más de 40 s o la red falló)';
            // Nuvio no siempre muestra todos los campos: el motivo va repartido en nombre, título, calidad e idioma
            return [{ name: "JKAnime v2.1.1: ".concat(por.slice(0, 60)), title: por, url: 'https://jkanime.net/', quality: por.slice(0, 90), language: por.slice(60, 160) || 'Diagnóstico', provider: FUENTE }];
        });
    };
}
module.exports = {
    getStreams: limitar(getStreams),
    // Usado por scripts/build_jkanime.mjs (el generador del catálogo); Nuvio solo usa getStreams
    interno: { buscarJk: buscarJk, servidoresDe: servidoresDe, armar: armar, reiniciar: function () { inicio = Date.now(); } }
};
