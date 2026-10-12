from pathlib import Path
import json,subprocess,urllib.parse
root=Path(__file__).resolve().parents[1]
images=root/'web/public/images'
sources=json.loads((images/'sources.json').read_text('utf-8'))
names=[urllib.parse.unquote(x['source'].split('/wiki/File:')[1]) for x in sources if '/wiki/File:' in x['source']]
url='https://commons.wikimedia.org/w/api.php?'+urllib.parse.urlencode({'action':'query','prop':'imageinfo','iiprop':'extmetadata','format':'json','titles':'|'.join('File:'+x for x in names)})
raw=root/'.runtime-license.json'
r=subprocess.run(['curl.exe','--fail','--location','--silent','--show-error','--max-time','40',url,'--output',str(raw)],capture_output=True,text=True)
if r.returncode:raise RuntimeError(r.stderr)
pages=json.loads(raw.read_text('utf-8'))['query']['pages']
credits=[]
for p in pages.values():
    metadata=p.get('imageinfo',[{}])[0].get('extmetadata',{})
    credits.append({'file':p['title'],'source':'https://commons.wikimedia.org/wiki/'+urllib.parse.quote(p['title'].replace(' ','_')),'author':metadata.get('Artist',{}).get('value','See file page'),'license':metadata.get('LicenseShortName',{}).get('value','See file page'),'licenseUrl':metadata.get('LicenseUrl',{}).get('value',''),'attributionRequired':metadata.get('AttributionRequired',{}).get('value',''),'credit':metadata.get('Credit',{}).get('value','')})
(images/'credits.json').write_text(json.dumps(credits,ensure_ascii=False,indent=2),'utf-8')
print('Saved metadata for',len(credits),'Commons images; Unsplash sources retained in sources.json.')
