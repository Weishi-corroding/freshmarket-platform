"""Download verified demo photo sources into the project; keep a source manifest."""
from pathlib import Path
import json, subprocess, concurrent.futures

ROOT=Path(__file__).resolve().parents[1]
DEST=ROOT/'web/public/images'
DEST.mkdir(parents=True,exist_ok=True)
mapping={'Apple':'apple','Avocado':'avocado','Banana':'banana','Blueberry':'blueberry','Broccoli':'broccoli','Carrot':'carrot','Cherry':'cherry','Croissant':'croissant','Cucumber':'cucumber','Milk':'milk','Pasta':'pasta','Pineapple':'pineapple','Pork':'pork','Salad':'salad','Steak':'steak','Tomato':'tomato','Wonton':'dumplings','Yogurt':'yogurt'}
sources=[]
raw=json.loads((ROOT/'.runtime-images.json').read_text('utf-8'))
for page in raw['query']['pages'].values():
    if page['title'] in mapping and page.get('thumbnail'):
        sources.append({'name':mapping[page['title']],'url':page['thumbnail']['source'].split('?')[0], 'source':'https://commons.wikimedia.org/wiki/File:'+page.get('pageimage',''),'license':'See file-specific Wikimedia Commons author/license metadata; retained in sources.json.'})
extra=json.loads((ROOT/'.runtime-extra-images.json').read_text('utf-8'))
for page in extra['query']['pages'].values():
    if page['title']=='Whiteleg shrimp':sources.append({'name':'shrimp','url':page['thumbnail']['source'].split('?')[0],'source':'https://commons.wikimedia.org/wiki/File:'+page.get('pageimage',''),'license':'See Wikimedia file page.'})
for name,photo,page in [
    ('hero','photo-1464965911861-746a04b4bca6','https://unsplash.com/photos/strawberry-lot-FCrgmqqvl-w'),
    ('strawberry','photo-1685130050521-821d122f4915','https://unsplash.com/photos/a-close-up-of-a-bunch-of-strawberries-_NMPU2fZfz4'),
    ('salmon','photo-1599084993091-1cb5c0721cc6','https://unsplash.com/s/photos/salmon-fillet'),
    ('eggs','photo-1552418322-3855ef830d11','https://unsplash.com/photos/six-eggs-on-tray-DCOiZhT-WkI'),
    ('chicken','photo-1604503468506-a8da13d82791','https://unsplash.com/s/photos/chicken-meat'),
]:sources.append({'name':name,'url':f'https://images.unsplash.com/{photo}?auto=format&fit=crop&w=900&q=85&fm=jpg','source':page,'license':'Unsplash License https://unsplash.com/license'})
# The API provides the actual file URL and name; do not derive an image URL from a title.
fish=json.loads((ROOT/'.runtime-fish.json').read_text('utf-8'))
for page in fish['query']['pages'].values():
    if page['title']=='Barramundi':sources.append({'name':'fish','url':page['thumbnail']['source'].split('?')[0],'source':'https://commons.wikimedia.org/wiki/File:'+page['pageimage'],'license':'See Wikimedia file page.'})
def download(item):
    target=DEST/(item['name']+'.jpg')
    if target.exists() and target.stat().st_size>1000:return item['name']+' retained'
    r=subprocess.run(['curl.exe','--fail','--location','--silent','--show-error','--retry','2','--max-time','40',item['url'],'--output',str(target)],capture_output=True,text=True)
    return item['name']+(' OK' if r.returncode==0 else ' FAILED: '+r.stderr.strip())
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
    for line in executor.map(download,sources):print(line)
(DEST/'sources.json').write_text(json.dumps(sources,ensure_ascii=False,indent=2),'utf-8')
