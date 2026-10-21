"""列出 docs/*.md 中尚无渲染图片的 mermaid 块（键见 generate-enterprise-docs.py）。"""
from pathlib import Path
import hashlib,json,re
ROOT=Path(__file__).resolve().parents[1];M=json.loads((ROOT/'docs/diagrams/mermaid-manifest.json').read_text('utf-8'))
for stem in ('requirements','design','test-report'):
    for i,b in enumerate(re.findall(r'```mermaid\n(.*?)```',(ROOT/f'docs/{stem}.md').read_text('utf-8'),re.S)):
        k=hashlib.sha256(b.strip().encode('utf-8')).hexdigest()[:16];print(stem,i,k,M.get(k,'MISSING'),b.strip().splitlines()[0])
