#!/usr/bin/env python3
"""Static Nuvio/Stremio catalog from permitted HTML + authorized streams.
No access-control bypass, no extraction of player secrets.
"""
import json, os, re, sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlparse, parse_qs
import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
BASE = 'https://jkanime.net'
PAGES = 'https://yahir9.github.io/-nuvio-anime/'
MEDIA = ('.m3u8', '.mp4', '.mpd', '.mkv')
BLOCK = {'directorio','horario','estrenos','top','buscar','comunidad','registro','login','perfil','noticias','generos','app','faq','solicitudes','contacto','anime','search'}
SESSION = requests.Session()
SESSION.headers.update({'User-Agent':'NuvioAnimeCatalog/1.0 (metadata only)', 'Accept':'text/html,application/json'})


def safe_url(url, video=False):
    if not isinstance(url, str): return False
    u = urlparse(url)
    h = (u.hostname or '').lower()
    if u.scheme != 'https' or not h or u.username or u.password: return False
    if h in ('localhost','127.0.0.1','::1') or h.endswith(('.local','.internal')): return False
    return not video or u.path.lower().endswith(MEDIA)


def valid_stream(url):
    if not safe_url(url, True): return False
    expiration = parse_qs(urlparse(url).query).get('e', [])
    if expiration:
        try: return int(expiration[0]) > datetime.now(timezone.utc).timestamp() + 300
        except ValueError: return False
    return True


def get(url, json_mode=False):
    if not safe_url(url): raise ValueError('Invalid HTTPS URL')
    r = SESSION.get(url, timeout=18)
    r.raise_for_status()
    if len(r.content) > 5_000_000: raise ValueError('Response too large')
    return r.json() if json_mode else BeautifulSoup(r.text, 'html.parser')


def slug_from(url):
    p = urlparse(urljoin(BASE, url))
    if p.hostname not in ('jkanime.net','www.jkanime.net'): return None
    parts = [s for s in p.path.split('/') if s]
    if len(parts) != 1: return None
    slug = parts[0].lower()
    return slug if re.fullmatch(r'[a-z0-9][a-z0-9-]*', slug) and slug not in BLOCK else None


def meta_tag(soup, key):
    x = soup.find('meta', attrs={'property':key}) or soup.find('meta', attrs={'name':key})
    return str(x.get('content','')).strip() if x else ''


def episodes_on_page(soup, slug):
    found = set()
    for a in soup.select('a[href]'):
        p = urlparse(urljoin(BASE,a['href']))
        if p.hostname not in ('jkanime.net','www.jkanime.net'): continue
        match = re.fullmatch(r'/' + re.escape(slug) + r'/([0-9]+)/?', p.path)
        if match: found.add(int(match.group(1)))
    return sorted(n for n in found if n > 0)


def collect():
    slugs = set()
    for url in [BASE+'/',BASE+'/directorio/']:
        try:
            soup = get(url)
            for a in soup.select('a[href]'):
                slug = slug_from(a.get('href',''))
                if slug: slugs.add(slug)
            print('HTML OK:', url, 'candidates:',len(slugs))
        except Exception as e:
            print('WARNING: JKAnime unavailable:',url,type(e).__name__,str(e),file=sys.stderr)
    return sorted(slugs)


def load_old():
    try:
        doc = get(PAGES+'catalog/series/anime.json',True)
        return doc.get('metas',[]) if isinstance(doc,dict) else []
    except Exception:
        path = ROOT/'catalog/series/anime.json'
        try: return json.loads(path.read_text()).get('metas',[])
        except Exception: return []


def save(path, obj):
    p=ROOT/'public'/path
    p.parent.mkdir(parents=True,exist_ok=True)
    p.write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n',encoding='utf8')


def main():
    source_path=ROOT/'sources.json'
    config=json.loads(source_path.read_text(encoding='utf8'))
    sources=config.get('sources',[])
    old=load_old()
    entries={m['id']:dict(m) for m in old if isinstance(m,dict) and m.get('id','').startswith('na:')}
    episodes={}
    discovered=collect()
    # Include known titles when listing pages are blocked.
    for s in sources:
        if s.get('enabled',True) and s.get('id'):
            discovered.append(s['id'])
    for slug in sorted(set(discovered))[:int(os.getenv('MAX_ANIMES','80'))]:
        if not re.fullmatch(r'[a-z0-9-]+',slug): continue
        ident='na:'+slug
        known=entries.get(ident,{'id':ident,'type':'series','name':slug.replace('-',' ').title()})
        try:
            soup=get(f'{BASE}/{slug}/')
            name=meta_tag(soup,'og:title') or (soup.h1.get_text(' ',strip=True) if soup.h1 else '')
            if name: known['name']=re.split(r'\s+[-|]\s+(?:anime|JKAnime)',name,flags=re.I)[0].strip()
            description=meta_tag(soup,'og:description') or meta_tag(soup,'description')
            poster=meta_tag(soup,'og:image')
            if description: known['description']=description
            if safe_url(poster): known['poster']=poster
            found=episodes_on_page(soup,slug)
            if found: episodes.setdefault(ident,set()).update(found)
        except Exception as e:
            print('WARNING: profile unavailable:',slug,type(e).__name__,file=sys.stderr)
        entries[ident]=known
    # Sources add episodes/streams, do not attempt to regenerate signed URLs.
    streams={}
    for s in sources:
        if not s.get('enabled',True) or not s.get('id'): continue
        slug=s['id']; ident='na:'+slug
        entry=entries.setdefault(ident,{'id':ident,'type':'series','name':s.get('name',slug)})
        if s.get('name') and entry['name']==slug.replace('-',' ').title(): entry['name']=s['name']
        if s.get('type')!='direct': continue
        try:
            season=int(s.get('season',1)); ep=int(s.get('episode',1))
            if ep<1 or season<1: continue
            vid=f'{ident}:{season}:{ep}'
            episodes.setdefault(ident,set()).add(ep)
            url=os.getenv(s.get('url_env',''),'') if s.get('url_env') else s.get('url','')
            if valid_stream(url): streams.setdefault(vid,[]).append({'name':'HLS','url':url})
            else: print('WARNING: signed stream absent/expired:',vid)
        except (ValueError,TypeError): continue
    if not entries:
        raise RuntimeError('No prior catalog or accessible metadata. Existing published Pages remains unchanged.')
    metas=sorted(entries.values(), key=lambda x:x.get('name','').casefold())
    for start in range(0,len(metas),100):
        path='catalog/series/anime.json' if start==0 else f'catalog/series/anime/skip={start}.json'
        save(path,{'metas':metas[start:start+100]})
    for item in metas:
        ident=item['id']; slug=ident[3:]
        nums=sorted(episodes.get(ident,set()))
        # Keep old episode list when a profile cannot be accessed.
        old_meta=None
        try: old_meta=get(PAGES+f'meta/series/{ident}.json',True).get('meta')
        except Exception: pass
        prev=old_meta.get('videos',[]) if isinstance(old_meta,dict) else []
        videos={v['id']:v for v in prev if isinstance(v,dict) and v.get('id')}
        for ep in nums:
            vid=f'{ident}:1:{ep}'
            videos.setdefault(vid,{'id':vid,'title':f'Episodio {ep}','season':1,'episode':ep})
        save(f'meta/series/{ident}.json',{'meta':{**item,'videos':list(videos.values())}})
        for vid in videos:
            # Do not copy previously signed URLs: they may now be invalid.
            save(f'stream/series/{vid}.json',{'streams':streams.get(vid,[])})
    print('Animes:',len(metas),'Streams vigentes:',sum(map(len,streams.values())))

if __name__=='__main__': main()
