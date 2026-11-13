"use strict";
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
/*
 * Deportes en vivo — proveedor para Nuvio
 * Nuvio llama getStreams(id, tipo) con el id del partido ("dep_12345", del addon "Deportes en vivo").
 * Se busca el partido en la agenda, y cada canal se resuelve EN TU EQUIPO (el token del video queda atado a tu IP).
 */
var VERSION = '1.3.0';
var API = (typeof process !== 'undefined' && process.env && process.env.DEPORTES_API) || 'https://api.wqxag.com/diaries.json';
var SITIO = 'https://futbollibretvplay.org';
var PAGES = (typeof process !== 'undefined' && process.env && process.env.DEPORTES_PAGES) || 'https://yahir9.github.io/-nuvio-anime';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
var PRESUPUESTO = 30000;
var inicio = Date.now();
var motivo = '';
var restante = function () { return PRESUPUESTO - (Date.now() - inicio); };
function conLimite(promesa, ms, valor) {
    var trabajo = Promise.resolve(promesa).catch(function () { return valor; });
    if (typeof setTimeout !== 'function')
        return trabajo;
    var id;
    var reloj = new Promise(function (r) { id = setTimeout(function () { return r(valor); }, ms); });
    return Promise.race([trabajo, reloj]).then(function (v) { clearTimeout(id); return v; });
}
// Usa el fetch nativo de Nuvio si existe (respeta cabeceras como Sec-Fetch-*); si no, el fetch normal
function traer(url, o) {
    return __awaiter(this, void 0, void 0, function () {
        var cab, _a, _b, k, crudo, d;
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
                    return [4 /*yield*/, __native_fetch(url, 'GET', JSON.stringify(cab), 'none', '', true)];
                case 1:
                    crudo = _d.sent();
                    d = JSON.parse(crudo);
                    return [2 /*return*/, { ok: !!d.ok, status: d.status, text: function () { return Promise.resolve(d.body || ''); } }];
            }
        });
    });
}
function pedir(url, headers) {
    return __awaiter(this, void 0, void 0, function () {
        var limite, r;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    limite = Math.min(15000, restante());
                    if (limite <= 0)
                        return [2 /*return*/, { status: 0, texto: '' }];
                    return [4 /*yield*/, conLimite(traer(url, { headers: Object.assign({ 'User-Agent': UA, 'Accept-Language': 'es-MX,es-419;q=0.9,es;q=0.8' }, headers || {}) }).catch(function () { return null; }), limite, null)];
                case 1:
                    r = _b.sent();
                    if (!r)
                        return [2 /*return*/, { status: 0, texto: '' }];
                    _a = { status: r.status };
                    return [4 /*yield*/, conLimite(r.text(), 10000, '')];
                case 2: return [2 /*return*/, (_a.texto = (_b.sent()) || '', _a)];
            }
        });
    });
}
function atobSeguro(t) {
    try {
        return atob(String(t || '').replace(/\s+/g, ''));
    }
    catch (e) {
        try {
            return Buffer.from(String(t || ''), 'base64').toString('utf8');
        }
        catch (e2) {
            return '';
        }
    }
}
var decodificar = function (ruta) {
    var r = (String(ruta).match(/[?&]r=([^&]+)/) || [])[1];
    if (!r)
        return '';
    var b = r;
    try {
        b = decodeURIComponent(r);
    }
    catch (e) { /* tal cual */ }
    return atobSeguro(b).trim();
};
var CHROME = {
    'sec-ch-ua': '"Not-A.Brand";v="99", "Google Chrome";v="137", "Chromium";v="137"', 'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': '"Windows"',
    'Upgrade-Insecure-Requests': '1', Priority: 'u=0, i'
};
var ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';
function resolver(envoltorio) {
    return __awaiter(this, void 0, void 0, function () {
        var env, marco, src, base, interno, r, m;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, pedir(envoltorio, Object.assign({}, CHROME, { Referer: "".concat(SITIO, "/embed/eventos.html"), Accept: ACCEPT, 'Sec-Fetch-Dest': 'iframe', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'cross-site' }))];
                case 1:
                    env = _a.sent();
                    marco = (env.texto.match(/<iframe[^>]*id=["']player-frame["'][^>]*>/i) || env.texto.match(/<iframe[^>]*>/i) || [''])[0];
                    src = (marco.match(/src=["']([^"']+)["']/i) || [])[1];
                    if (!src) {
                        motivo = "La p\u00E1gina del canal respondi\u00F3 ".concat(env.status, " y no trae reproductor");
                        return [2 /*return*/, ''];
                    }
                    base = envoltorio.replace(/^(https?:\/\/[^/]+).*$/, '$1');
                    interno = /^https?:/i.test(src) ? src : base + (src.startsWith('/') ? '' : '/') + src;
                    return [4 /*yield*/, pedir(interno, Object.assign({}, CHROME, { Referer: envoltorio, Accept: ACCEPT, 'Sec-Fetch-Dest': 'iframe', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'same-origin' }))];
                case 2:
                    r = _a.sent();
                    m = r.texto.match(/["']src["']\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i);
                    if (!m) {
                        motivo = "El reproductor respondi\u00F3 ".concat(r.status, ": ").concat(r.texto.slice(0, 60).replace(/\s+/g, ' '));
                        return [2 /*return*/, ''];
                    }
                    return [2 /*return*/, m[1].replace(/\\\//g, '/')];
            }
        });
    });
}
// Nuvio TV solo ejecuta plugins con ids de películas reales: el addon usa "casillas" (ids reales) y mapa.json dice a qué partido corresponde cada una.
function desdeMapa(id) {
    return __awaiter(this, void 0, void 0, function () {
        var r, m;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!/^(tt\d{7}|\d{1,9})$/.test(id))
                        return [2 /*return*/, ''];
                    return [4 /*yield*/, pedir("".concat(PAGES, "/deportes/mapa.json"), { Accept: 'application/json' })];
                case 1:
                    r = _a.sent();
                    m = null;
                    try {
                        m = JSON.parse(r.texto);
                    }
                    catch (e) { /* nada */ }
                    return [2 /*return*/, m && m[id] ? String(m[id]) : ''];
            }
        });
    });
}
function getStreams(id, tipo) {
    return __awaiter(this, void 0, void 0, function () {
        var n_1, clave, m3u8, a, datos, ev, at, titulo, opciones, grupos, salida, vistos, grupos_1, grupos_1_1, g, e_2;
        var e_3, _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _b.trys.push([0, 7, , 8]);
                    n_1 = (String(id || '').match(/^dep_(\d+)$/) || [])[1];
                    if (!!n_1) return [3 /*break*/, 2];
                    return [4 /*yield*/, desdeMapa(String(id || '').trim())];
                case 1:
                    n_1 = _b.sent();
                    if (!n_1)
                        return [2 /*return*/, []];
                    _b.label = 2;
                case 2:
                    if (!/^canal:/.test(n_1)) return [3 /*break*/, 4];
                    clave = n_1.slice(6);
                    return [4 /*yield*/, resolver("https://tvf90.com/online/canal.php?stream=".concat(encodeURIComponent(clave)))];
                case 3:
                    m3u8 = _b.sent();
                    if (!m3u8)
                        return [2 /*return*/, []];
                    return [2 /*return*/, [{ name: "Canal ".concat(clave.toUpperCase(), " \u00B7 En vivo"), title: "Canal ".concat(clave), url: m3u8, quality: '1080p', provider: 'Deportes', headers: { Referer: 'https://tvf90.com/', Origin: 'https://tvf90.com', 'User-Agent': UA } }]];
                case 4: return [4 /*yield*/, pedir(API, { Accept: 'application/json', Referer: "".concat(SITIO, "/"), Origin: SITIO })];
                case 5:
                    a = _b.sent();
                    datos = null;
                    try {
                        datos = JSON.parse(a.texto);
                    }
                    catch (e) { /* nada */ }
                    if (!datos) {
                        motivo = "No se pudo leer la agenda (respuesta ".concat(a.status, ")");
                        return [2 /*return*/, []];
                    }
                    ev = ((datos && datos.data) || []).find(function (e) { return String(e.id) === n_1; });
                    if (!ev) {
                        motivo = 'Ese partido ya no está en la agenda';
                        return [2 /*return*/, []];
                    }
                    at = ev.attributes || {};
                    titulo = String(at.diary_description || '').replace(/\s+/g, ' ').trim();
                    opciones = ((at.embeds || {}).data || []).map(function (e) { return ({ nombre: String(e.attributes.embed_name || '').trim(), url: decodificar(e.attributes.embed_iframe) }); }).filter(function (e) { return e.url; });
                    if (!opciones.length) {
                        motivo = 'El partido no tiene canales todavía';
                        return [2 /*return*/, []];
                    }
                    return [4 /*yield*/, Promise.all(opciones.map(function (o) { return conLimite(resolver(o.url).then(function (m3u8) { return (m3u8 ? { o: o, m3u8: m3u8 } : null); }), Math.max(1000, restante() - 2000), null); }))];
                case 6:
                    grupos = _b.sent();
                    salida = [];
                    vistos = new Set();
                    try {
                        for (grupos_1 = __values(grupos), grupos_1_1 = grupos_1.next(); !grupos_1_1.done; grupos_1_1 = grupos_1.next()) {
                            g = grupos_1_1.value;
                            if (!g || vistos.has(g.m3u8))
                                continue;
                            vistos.add(g.m3u8);
                            salida.push({ name: "Deportes (".concat(g.o.nombre, ") \u00B7 En vivo"), title: titulo, url: g.m3u8, quality: '1080p', provider: 'Deportes', headers: { Referer: 'https://tvf90.com/', Origin: 'https://tvf90.com', 'User-Agent': UA } });
                        }
                    }
                    catch (e_3_1) { e_3 = { error: e_3_1 }; }
                    finally {
                        try {
                            if (grupos_1_1 && !grupos_1_1.done && (_a = grupos_1.return)) _a.call(grupos_1);
                        }
                        finally { if (e_3) throw e_3.error; }
                    }
                    return [2 /*return*/, salida];
                case 7:
                    e_2 = _b.sent();
                    motivo = "Error: ".concat(e_2 && e_2.message);
                    return [2 /*return*/, []];
                case 8: return [2 /*return*/];
            }
        });
    });
}
module.exports = {
    getStreams: function (id, tipo, t, e) {
        inicio = Date.now();
        motivo = '';
        var sid = String(id || '').trim();
        var esDep = /^dep_\d+$/.test(sid);
        if (!esDep && !/^(tt\d{7}|\d{1,9})$/.test(sid))
            return Promise.resolve([]);
        return conLimite(getStreams(String(id).trim(), tipo, t, e), PRESUPUESTO + 3000, null).then(function (s) {
            if (s && s.length)
                return s;
            if (!motivo && !esDep)
                return [];
            var por = motivo || 'Sin respuesta a tiempo';
            return [{ name: "Deportes v".concat(VERSION, ": ").concat(por.slice(0, 60)), title: por, url: 'https://futbollibretvplay.org/', quality: por.slice(0, 90), language: por.slice(60, 160) || 'Diagnóstico', provider: 'Deportes' }];
        });
    }
};
