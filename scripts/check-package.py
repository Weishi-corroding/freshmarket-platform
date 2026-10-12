from pathlib import Path
import zipfile,json,hashlib
ROOT=Path(__file__).resolve().parents[1]
out=ROOT/'deliverables';file=out/'FreshMarket-source-and-deliverables.zip'
manifest=json.loads((out/'SHA256SUMS.json').read_text('utf-8'))
assert hashlib.sha256(file.read_bytes()).hexdigest()==manifest['sha256']
private={}
config=ROOT/'.env.docker'
if config.exists():
    for line in config.read_text('utf-8-sig').splitlines():
        if '=' in line:
            key,value=line.split('=',1)
            if key in {'JWT_SECRET','DB_PASSWORD','MQ_PASSWORD','GRAFANA_PASSWORD','DEMO_PASSWORD'}:private[key]=value.encode()
with zipfile.ZipFile(file) as archive:
    assert archive.testzip() is None
    names=archive.namelist()
    expected=['package.json','package-lock.json','.env.example','compose.yaml','database/schema.sql','database/seed.sql','README.md','.github/workflows/ci.yml','docs/evidence/video-validation.json','deliverables/鲜境_系统演示.webm']
    for name in expected:assert 'FreshMarket/'+name in names,name
    for name in names:
        assert name.startswith('FreshMarket/') and '..' not in Path(name).parts
        assert all(p not in {'node_modules','.tools','.runtime','.git','dist','backups'} for p in Path(name).parts),name
        assert not Path(name).name.startswith('.env') or Path(name).name=='.env.example',name
        content=archive.read(name)
        for key,value in private.items():assert value not in content,'Private key found in '+name+' / '+key
    result={'archive':file.name,'files':len(names),'bytes':file.stat().st_size,'sha256Matches':True,'zipIntegrity':True,'allRequiredMaterials':True,'privateEnvironmentValuesAbsent':True,'dependencyAndRuntimeDirectoriesAbsent':True}
(out/'package-validation.json').write_text(json.dumps(result,indent=2),'utf-8')
print('Verified final archive:',result['files'],'files;',round(result['bytes']/1024/1024,2),'MiB; secrets excluded; SHA256 matches.')
