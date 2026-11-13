// Abre JKAnime con un navegador real para pasar la verificación de Cloudflare y guarda las cookies.
import fs from 'node:fs';
import { chromium } from 'playwright';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
const navegador = await chromium.launch({ headless: false, args: ['--disable-blink-features=AutomationControlled'] });
const ctx = await navegador.newContext({ userAgent: UA, locale: 'es-MX', viewport: { width: 1280, height: 800 } });
const pag = await ctx.newPage();
let ok = false;
try {
  await pag.goto('https://jkanime.net/directorio?estado=emision&p=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
  for (let i = 0; i < 30; i++) {
    const html = await pag.content();
    if (/var animes/.test(html)) { ok = true; break; }
    await pag.waitForTimeout(2000);
  }
  console.log(ok ? 'Verificación superada' : 'No se superó la verificación. Título: ' + (await pag.title()));
} catch (e) { console.log('Error: ' + e.message); }
const cookies = (await ctx.cookies()).filter((c) => /jkanime/.test(c.domain)).map((c) => `${c.name}=${c.value}`).join('; ');
fs.writeFileSync('cookies.txt', cookies);
console.log('Cookies guardadas: ' + (cookies ? cookies.split(';').length : 0));
await navegador.close();
