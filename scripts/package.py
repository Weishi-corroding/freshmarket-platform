from pathlib import Path
import zipfile,hashlib,json
root=Path(__file__).resolve().parents[1]
dest=root/'deliverables'
dest.mkdir(exist_ok=True)
output=dest/'FreshMarket-source-and-deliverables.zip'
required=['鲜境_需求文档.docx','鲜境_设计文档.docx','鲜境_测试报告.docx','鲜境_实验报告.docx','鲜境_项目汇报.pptx','鲜境_系统演示.webm','video-manifest.json']
for name in required:
    if not (dest/name).is_file():raise FileNotFoundError('Missing delivery artifact: '+name)
excluded={'node_modules','.tools','.runtime','.git','test-results','playwright-report','backups','dist','__pycache__'}
with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
    for path in sorted(root.rglob('*')):
        if not path.is_file():continue
        rel=path.relative_to(root)
        if any(part in excluded for part in rel.parts):continue
        if path==output or path.suffix=='.zip' or path.name.startswith(('~$','book-page-','.runtime-')) or (path.name.startswith('.env') and path.name!='.env.example') or path.name=='textbook.txt' or path.suffix in {'.sqlite','.tsbuildinfo'}:continue
        if len(rel.parts)==1 and path.suffix in {'.pdf','.docx'}:continue
        if path.name in {'SHA256SUMS.json','package-validation.json'}:continue
        archive.write(path,'FreshMarket/'+rel.as_posix())
digest=hashlib.sha256(output.read_bytes()).hexdigest()
(dest/'SHA256SUMS.json').write_text(json.dumps({'archive':output.name,'sha256':digest,'bytes':output.stat().st_size},indent=2),'utf-8')
with zipfile.ZipFile(output) as archive:
    assert archive.testzip() is None
    assert any(n.endswith('/database/schema.sql') for n in archive.namelist())
    assert 'FreshMarket/.env.example' in archive.namelist()
    for name in required:assert 'FreshMarket/deliverables/'+name in archive.namelist()
    assert not any('/.env.docker' in n or '/node_modules/' in n for n in archive.namelist())
    print('Verified archive:',len(archive.namelist()),'files;',output.stat().st_size,'bytes')
