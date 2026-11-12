#!/usr/bin/env python3
"""Diagnóstico no intrusivo de páginas públicas de SoloLatino.
No ejecuta JavaScript, no intenta acceder a contenido protegido y no sigue reproductores externos.
"""
import json, os, re, sys, time
from collections import Counter
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse, urljoin
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

BASE = 'https://sololatino.net'
URLS = [BASE + '/animes', BASE + '/serie/black-clover', BASE + '/serie/black-clover/temporada-1/episodio-1']
OUT = Path('reports/sololatino')
HEADERS = {'User-Agent': 'NuvioAnimeCatalogDiagnostic/1.0 (authorized integration)', 'Accept': 'text/html,application/xhtml+xml'}

class Scanner(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tags = Counter(); self.links = []; self.scripts=[]; self.iframes=[]; self.media=[]
        self.current_script = None; self.script_blocks=[]; self.title=''; self.in_title=False
        self.metas=[]
    def handle_starttag(self, tag, attrs):
        self.tags[tag]+=1
        d=dict(attrs)
        if tag=='title': self.in_title=True
        if tag=='a' and d.get('href'): self.links.append(d['href'])
        if tag=='iframe' and d.get('src'): self.iframes.append(d['src'])
        if tag=='script':
            if d.get('src'): self.scripts.append(d['src'])
            else: self.current_script=[]
        if tag in ('video','source') and d.get('src'): self.media.append(d['src'])
        if tag=='meta' and d.get('name','').lower() in ('description','csrf-token'):
            self.metas.append(d.get('name'))
    def handle_endtag(self, tag):
        if tag=='title': self.in_title=False
        if tag=='script' and self.current_script is not None:
            self.script_blocks.append(''.join(self.current_script)); self.current_script=None
    def handle_data(self, data):
        if self.in_title: self.title += data
        if self.current_script is not None: self.current_script.append(data)

def safe_url(url, page):
    """Conserva host y ruta sin tokens/query ni credenciales."""
    full=urljoin(page,url)
    p=urlparse(full)
    if p.scheme not in ('http','https'): return None
    return p.scheme+'://'+(p.hostname or '')+p.path

def fetch(url):
    req=Request(url,headers=HEADERS)
    with urlopen(req,timeout=25) as r:
        ct=r.headers.get('Content-Type','')
        if 'text/html' not in ct and 'application/xhtml' not in ct:
            raise ValueError('Respuesta no HTML: '+ct)
        body=r.read(2_000_000)
        charset=r.headers.get_content_charset() or 'utf-8'
        return r.status, body.decode(charset,errors='replace')

def inspect(url):
    record={'page':url, 'ok':False}
    try:
        status,html=fetch(url)
        scan=Scanner(); scan.feed(html)
        links=[safe_url(x,url) for x in scan.links]
        links=list(dict.fromkeys(x for x in links if x))
        episode_pattern=r'/serie/[^/]+/temporada-\d+/episodio-\d+'
        series_pattern=r'/serie/[^/]+/?$'
        markers={
            'var_servers':bool(re.search(r'\bvar\s+servers\s*=',html)),
            'encoded_remote':bool(re.search(r'\bremote\s*:',html)),
            'iframe_tag':bool(scan.iframes),
            'video_tag':bool(scan.tags['video']),
            'source_tag':bool(scan.tags['source']),
            'm3u8_reference':bool(re.search(r'\.m3u8(?:[?"\'\s]|$)',html,re.I)),
            'mp4_reference':bool(re.search(r'\.mp4(?:[?"\'\s]|$)',html,re.I)),
            'hls_term':bool(re.search(r'\b(?:Hls\.js|application/vnd\.apple\.mpegurl|mpegurl)\b',html,re.I)),
            'server_selector_text':bool(re.search(r'(?:Servidor\s*\d|Principal)',html,re.I)),
        }
        record.update(ok=True,http_status=status,title=scan.title.strip(),html_bytes=len(html.encode('utf-8')),
            counts={'links':len(scan.links),'scripts_external':len(scan.scripts),'scripts_inline':len(scan.script_blocks),'iframes':len(scan.iframes),'videos':scan.tags['video'],'sources':scan.tags['source']},
            markers=markers,
            series_links=[x for x in links if re.search(series_pattern,x)][:20],
            episode_links=[x for x in links if re.search(episode_pattern,x)][:20],
            external_script_hosts=sorted({urlparse(urljoin(url,x)).hostname for x in scan.scripts if urlparse(urljoin(url,x)).hostname}),
            iframe_hosts=sorted({urlparse(urljoin(url,x)).hostname for x in scan.iframes if urlparse(urljoin(url,x)).hostname}),
            media_direct=[safe_url(x,url) for x in scan.media][:10])
    except (HTTPError, URLError, ValueError, TimeoutError) as exc:
        record['error']=f'{type(exc).__name__}: {getattr(exc,"code",str(exc))}'[:250]
    return record

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    urls=URLS
    extra=os.environ.get('SOLOLATINO_TEST_URL','').strip()
    if extra:
        if urlparse(extra).hostname not in ('sololatino.net','www.sololatino.net'):
            raise SystemExit('SOLOLATINO_TEST_URL debe pertenecer a sololatino.net')
        urls.append(extra)
    results=[]
    for i,url in enumerate(dict.fromkeys(urls)):
        results.append(inspect(url))
        if i<len(urls)-1: time.sleep(2)
    report={'generated_at_utc':datetime.now(timezone.utc).isoformat(),'scope':'HTML público; sin ejecución JS ni acceso a reproductores externos','results':results}
    (OUT/'diagnostic.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    lines=['# Diagnóstico SoloLatino', '',f'Generado: {report["generated_at_utc"]}', '', '> Sin ejecución JavaScript ni validación de reproducción. No supone acceso a contenido VIP.', '']
    for r in results:
        lines += [f'## {r["page"]}', '',f'Estado: {"OK" if r["ok"] else "ERROR"}', '']
        if not r['ok']:
            lines += [f'Error: `{r.get("error","desconocido")}`','']; continue
        lines += [f'Título: {r["title"]}', '', '### Indicadores','']
        for key,val in r['markers'].items(): lines.append(f'- {key}: {"sí" if val else "no"}')
        lines += ['',f'Enlaces de series detectados (muestra): {len(r["series_links"])}',f'Enlaces de episodios detectados (muestra): {len(r["episode_links"])}',
                  f'Scripts externos: {r["counts"]["scripts_external"]}',f'Iframes: {r["counts"]["iframes"]}', '']
        if r['iframe_hosts']: lines += ['Dominios de iframe (sin rutas ni tokens): '+', '.join(r['iframe_hosts']),'']
    (OUT/'diagnostic.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
    print('\n'.join(lines))
    if not any(r['ok'] for r in results): sys.exit(1)

if __name__=='__main__': main()
