// Pegar en la consola del navegador estando en https://jkanime.net : descarga jkanime-datos.json con el catálogo y los episodios.
(async () => {
  const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
  const leer = (h) => { const i = h.indexOf('var animes'); const s = h.indexOf('{', i); let e = h.indexOf('};', s); for (let n = 0; n < 8 && e > 0; n++) { try { return JSON.parse(h.slice(s, e + 1)); } catch (x) { e = h.indexOf('};', e + 1); } } return null; };
  const directorio = []; let ultima = 1;
  for (let p = 1; p <= ultima; p++) {
    const d = leer(await (await fetch(`/directorio?estado=emision&p=${p}`)).text());
    if (!d) break; ultima = d.last_page || 1;
    for (const a of d.data) directorio.push({ title: a.title, synopsis: a.synopsis, image: a.image, slug: a.slug, type: a.type, tipo: a.tipo, url: a.url });
    console.log(`Directorio ${p}/${ultima}`); await pausa(500);
  }
  const episodios = {};
  for (const [i, a] of directorio.entries()) {
    if (/pel[ií]cula|movie/i.test(`${a.tipo} ${a.type}`)) continue;
    try {
      const h = await (await fetch(`/${a.slug}/`)).text();
      const id = ((h.match(/<[^>]+id=["']guardar-anime["'][^>]*>/i) || [''])[0].match(/data-anime=["'](\d+)/) || [])[1];
      const tk = (h.match(/name=["']csrf-token["'][^>]*content=["']([^"']+)/i) || h.match(/content=["']([^"']+)["'][^>]*name=["']csrf-token/i) || [])[1];
      const lista = [];
      for (let p = 1; p <= 40 && id && tk; p++) {
        const r = await fetch(`/ajax/episodes/${id}/${p}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-TOKEN': tk }, body: `_token=${encodeURIComponent(tk)}` });
        const j = await r.json().catch(() => null);
        if (!j || !j.data || !j.data.length) break;
        for (const e of j.data) if (!lista.some((x) => x.numero === +e.number)) lista.push({ numero: +e.number, fecha: e.timestamp || '', imagen: e.image || '' });
        if (lista.length >= (+j.total || 0)) break;
        await pausa(400);
      }
      episodios[a.slug] = lista.sort((x, y) => x.numero - y.numero);
      console.log(`${i + 1}/${directorio.length} ${a.slug}: ${lista.length} episodios`);
    } catch (e) { console.log('Falló ' + a.slug, e); }
    await pausa(600);
  }
  const blob = new Blob([JSON.stringify({ generado: new Date().toISOString(), directorio, episodios })], { type: 'application/json' });
  const enlace = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'jkanime-datos.json' });
  document.body.appendChild(enlace); enlace.click();
  console.log('LISTO: se descargó jkanime-datos.json');
})();
