"""Build the enterprise Word deliverables (SRS / SDD / test report) from docs/*.md.

Mermaid blocks are replaced by PNGs pre-rendered into docs/diagrams/<DIAGRAM_DIR>/ (manifest.json maps "<stem>#<index>" to a file).
Usage: python3 scripts/generate-enterprise-docs.py [requirements design test-report]
"""
from pathlib import Path
import json,re,sys
from docx import Document
from docx.enum.section import WD_ORIENT,WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH,WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm,Pt,RGBColor
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
DOCS=ROOT/'docs';OUT=ROOT/'deliverables';OUT.mkdir(exist_ok=True)
DIAGRAMS=DOCS/'diagrams'/'2026-10-18'
MANIFEST=json.loads((DIAGRAMS/'manifest.json').read_text('utf-8')) if (DIAGRAMS/'manifest.json').exists() else {}
TEAL,DARK,MUTED,HEAD_BG,CODE_BG='087F83','174950','68868D','DCEFEF','F3F6F7'
CJK,LATIN,MONO='Microsoft YaHei','Segoe UI','Consolas'
SPECS={
    'requirements':('鲜境_需求文档','需求规格说明书','Software Requirements Specification','FM-SRS-001'),
    'design':('鲜境_设计文档','系统设计说明书','Software Design Description','FM-SDD-001'),
    'test-report':('鲜境_测试报告','测试报告','Software Test Report','FM-STR-001'),
}
META={'版本':'2.0','日期':'2026-10-18','状态':'正式稿','适用版本':'main @ bb1bde2'}

def fonts(run,size=None,bold=None,color=None,mono=False,italic=None):
    run.font.name=MONO if mono else LATIN
    rpr=run._element.get_or_add_rPr();rf=rpr.find(qn('w:rFonts'))
    if rf is None:rf=OxmlElement('w:rFonts');rpr.append(rf)
    rf.set(qn('w:eastAsia'),CJK);rf.set(qn('w:ascii'),MONO if mono else LATIN);rf.set(qn('w:hAnsi'),MONO if mono else LATIN)
    if size:run.font.size=Pt(size)
    if bold is not None:run.bold=bold
    if italic is not None:run.italic=italic
    if color:run.font.color.rgb=RGBColor.from_string(color)
    return run

def shade(el,fill):
    pr=el.get_or_add_tcPr() if el.tag==qn('w:tc') else el.get_or_add_pPr()
    shd=OxmlElement('w:shd');shd.set(qn('w:val'),'clear');shd.set(qn('w:color'),'auto');shd.set(qn('w:fill'),fill);pr.append(shd)

def field(paragraph,instr,placeholder=''):
    run=paragraph.add_run();b=OxmlElement('w:fldChar');b.set(qn('w:fldCharType'),'begin');b.set(qn('w:dirty'),'true');run._r.append(b)
    run=paragraph.add_run();t=OxmlElement('w:instrText');t.set(qn('xml:space'),'preserve');t.text=instr;run._r.append(t)
    run=paragraph.add_run();s=OxmlElement('w:fldChar');s.set(qn('w:fldCharType'),'separate');run._r.append(s)
    fonts(paragraph.add_run(placeholder),9,color=MUTED)
    run=paragraph.add_run();e=OxmlElement('w:fldChar');e.set(qn('w:fldCharType'),'end');run._r.append(e)

INLINE=re.compile(r'(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))')
def inline(paragraph,text,size=None,bold=False,color=None):
    text=text.replace('<br>','\n').replace('<br/>','\n')
    for part in INLINE.split(text):
        if not part:continue
        if part.startswith('**') and part.endswith('**'):fonts(paragraph.add_run(part[2:-2]),size,True,color)
        elif part.startswith('`') and part.endswith('`'):fonts(paragraph.add_run(part[1:-1]),(size or 10.5)-1,bold,'8A3B12',mono=True)
        elif part.startswith('['):
            m=re.match(r'\[([^\]]+)\]\(([^)]+)\)',part);fonts(paragraph.add_run(m[1]),size,bold,color)
            if not m[2].startswith('#'):fonts(paragraph.add_run(f'（{m[2]}）'),(size or 10.5)-1.5,False,MUTED)
        else:fonts(paragraph.add_run(part),size,bold,color)

def set_cell_margins(table):
    tblPr=table._tbl.tblPr;mar=OxmlElement('w:tblCellMar')
    for side,v in (('top',50),('bottom',50),('left',90),('right',90)):
        el=OxmlElement(f'w:{side}');el.set(qn('w:w'),str(v));el.set(qn('w:type'),'dxa');mar.append(el)
    tblPr.append(mar)

def borders(table):
    tblPr=table._tbl.tblPr;b=OxmlElement('w:tblBorders')
    for side in ('top','left','bottom','right','insideH','insideV'):
        el=OxmlElement(f'w:{side}');el.set(qn('w:val'),'single');el.set(qn('w:sz'),'4');el.set(qn('w:color'),'B7CDD1');b.append(el)
    tblPr.append(b)

class Builder:
    def __init__(self,stem):
        self.stem=stem;self.file,self.title,self.en,self.code=SPECS[stem]
        self.doc=Document();self.figure=0;self.table_no=0;self.mermaid=0;self.last_heading=''
        self.setup();self.cover();self.toc()
    def setup(self):
        d=self.doc;sec=d.sections[0];sec.page_height,sec.page_width=Cm(29.7),Cm(21)
        sec.top_margin=sec.bottom_margin=Cm(2.2);sec.left_margin=sec.right_margin=Cm(2.2)
        st=d.styles['Normal'];st.font.name=LATIN;st.font.size=Pt(10.5)
        st.element.get_or_add_rPr().get_or_add_rFonts().set(qn('w:eastAsia'),CJK)
        st.paragraph_format.line_spacing=1.25;st.paragraph_format.space_after=Pt(4)
        for name,size,before in (('Heading 1',16,18),('Heading 2',13,12),('Heading 3',11.5,9)):
            h=d.styles[name];h.font.name=LATIN;h.font.size=Pt(size);h.font.bold=True;h.font.color.rgb=RGBColor.from_string(TEAL if name!='Heading 3' else DARK)
            h.element.get_or_add_rPr().get_or_add_rFonts().set(qn('w:eastAsia'),CJK)
            h.paragraph_format.space_before=Pt(before);h.paragraph_format.space_after=Pt(6);h.paragraph_format.keep_with_next=True
        sec.different_first_page_header_footer=True
        self.header_footer(sec)
    def header_footer(self,sec):
        sec.header.is_linked_to_previous=sec.footer.is_linked_to_previous=False
        hp=sec.header.paragraphs[0];hp.text='';fonts(hp.add_run(f'鲜境 FreshMarket  |  {self.title}  |  {self.code} V{META["版本"]}'),8.5,color=MUTED)
        pPr=hp._p.get_or_add_pPr();bdr=OxmlElement('w:pBdr');bt=OxmlElement('w:bottom')
        for k,v in (('val','single'),('sz','4'),('space','1'),('color','B7CDD1')):bt.set(qn('w:'+k),v)
        bdr.append(bt);pPr.append(bdr)
        fp=sec.footer.paragraphs[0];fp.text='';fp.alignment=WD_ALIGN_PARAGRAPH.CENTER
        fonts(fp.add_run('第 '),8.5,color=MUTED);field(fp,'PAGE','1');fonts(fp.add_run(' 页 / 共 '),8.5,color=MUTED);field(fp,'NUMPAGES','1');fonts(fp.add_run(' 页'),8.5,color=MUTED)
    def cover(self):
        d=self.doc
        p=d.add_paragraph();p.paragraph_format.space_before=Cm(3);fonts(p.add_run('鲜境 FreshMarket 生鲜电商平台'),14,True,MUTED)
        p=d.add_paragraph();p.paragraph_format.space_before=Pt(18);fonts(p.add_run(self.title),30,True,DARK)
        p=d.add_paragraph();fonts(p.add_run(self.en),13,False,TEAL)
        p=d.add_paragraph();p.paragraph_format.space_before=Cm(3)
        t=d.add_table(rows=0,cols=2);t.alignment=WD_TABLE_ALIGNMENT.LEFT;borders(t);set_cell_margins(t)
        for k,v in [('文档编号',self.code),('文档版本',META['版本']),('编制日期',META['日期']),('文档状态',META['状态']),('适用版本',META['适用版本']),('密级','内部')]:
            c=t.add_row().cells;c[0].width=Cm(4);c[1].width=Cm(9);shade(c[0]._tc,HEAD_BG)
            fonts(c[0].paragraphs[0].add_run(k),10,True,DARK);fonts(c[1].paragraphs[0].add_run(v),10)
        p=d.add_paragraph();p.paragraph_format.space_before=Cm(4);fonts(p.add_run('本文件依据当前源代码、脚本与 2026-10-18 实际执行结果编制。'),9,color=MUTED)
        p.add_run().add_break(WD_BREAK.PAGE)
    def toc(self):
        d=self.doc;p=d.add_paragraph();fonts(p.add_run('目  录'),16,True,TEAL)
        field(d.add_paragraph(),'TOC \\o "1-3" \\h \\z \\u','（打开文档后右键“更新域”生成目录）')
        d.add_paragraph().add_run().add_break(WD_BREAK.PAGE)
    def caption(self,text):
        p=self.doc.add_paragraph();p.alignment=WD_ALIGN_PARAGRAPH.CENTER;p.paragraph_format.space_after=Pt(10)
        self.figure+=1;fonts(p.add_run(f'图 {self.figure}  {text}'),9,False,MUTED)
    def section(self,landscape):
        sec=self.doc.add_section(WD_SECTION.NEW_PAGE)
        w,h=Cm(29.7),Cm(21)
        sec.orientation=WD_ORIENT.LANDSCAPE if landscape else WD_ORIENT.PORTRAIT
        sec.page_width,sec.page_height=(w,h) if landscape else (h,w)
        sec.different_first_page_header_footer=False;self.header_footer(sec);return sec
    def image(self,path,caption):
        w,h=Image.open(path).size;wide=w/h>=1.45 and w>=3000
        if wide:self.section(True)
        sec=self.doc.sections[-1];maxw=(sec.page_width-sec.left_margin-sec.right_margin)/914400*2.54
        maxh=(sec.page_height-sec.top_margin-sec.bottom_margin)/914400*2.54-2.2
        css_w=w/2/96*2.54  # rendered at device scale 2 → natural size in cm
        width=min(maxw,css_w*1.0,maxh*w/h)
        p=self.doc.add_paragraph();p.alignment=WD_ALIGN_PARAGRAPH.CENTER;p.paragraph_format.keep_with_next=True
        p.add_run().add_picture(str(path),width=Cm(width))
        self.caption(caption)
        if wide:self.section(False)
    def table(self,rows):
        cols=max(len(r) for r in rows);t=self.doc.add_table(rows=0,cols=cols);t.alignment=WD_TABLE_ALIGNMENT.CENTER
        borders(t);set_cell_margins(t);size=8.5 if cols>=6 else 9 if cols>=4 else 9.5
        for i,row in enumerate(rows):
            cells=t.add_row().cells
            for j in range(cols):
                c=cells[j];c.paragraphs[0].paragraph_format.space_after=Pt(0);c.paragraphs[0].paragraph_format.line_spacing=1.1
                inline(c.paragraphs[0],row[j] if j<len(row) else '',size,bold=(i==0),color=DARK if i==0 else None)
                if i==0:shade(c._tc,HEAD_BG)
            trPr=t.rows[i]._tr.get_or_add_trPr()
            el=OxmlElement('w:tblHeader' if i==0 else 'w:cantSplit');trPr.append(el)
        self.doc.add_paragraph().paragraph_format.space_after=Pt(2)
    def code_block(self,lines):
        for k,line in enumerate(lines):
            p=self.doc.add_paragraph();shade(p._p,CODE_BG);pf=p.paragraph_format
            pf.space_after=Pt(0) if k<len(lines)-1 else Pt(8);pf.space_before=Pt(0);pf.line_spacing=1.0;pf.left_indent=Cm(.3)
            fonts(p.add_run(line or ' '),8.5,mono=True)
    def render(self,text):
        lines=text.splitlines();i=0
        while i<len(lines):
            raw=lines[i];s=raw.strip();i+=1
            if not s:continue
            if s.startswith('```'):
                lang=s[3:].strip();block=[]
                while i<len(lines) and not lines[i].strip().startswith('```'):block.append(lines[i]);i+=1
                i+=1
                if lang=='mermaid':
                    key=f'{self.stem}#{self.mermaid}';self.mermaid+=1
                    if key not in MANIFEST:raise SystemExit(f'missing rendered diagram {key}; run the mermaid renderer first')
                    self.image(DIAGRAMS/MANIFEST[key],self.last_heading)
                else:self.code_block(block)
                continue
            if s.startswith('|'):
                rows=[]
                while True:
                    cells=[c.strip() for c in re.split(r'(?<!\\)\|',s.strip().strip('|'))]
                    cells=[c.replace('\\|','|') for c in cells]
                    if not all(re.fullmatch(r':?-{2,}:?',c) for c in cells if c) or not any(cells):rows.append(cells)
                    if i>=len(lines) or not lines[i].strip().startswith('|'):break
                    s=lines[i].strip();i+=1
                self.table(rows);continue
            m=re.match(r'!\[([^\]]*)\]\(([^)]+)\)',s)
            if m:
                self.image((DOCS/m[2]).resolve(),m[1] or self.last_heading);continue
            m=re.match(r'(#{1,4})\s+(.+)',s)
            if m:
                level=len(m[1])
                if level==1:continue
                self.last_heading=re.sub(r'^[\d.]+\s*','',m[2]).replace('`','').replace('**','')
                self.doc.add_heading(m[2].replace('`','').replace('**',''),level-1);continue
            if re.match(r'[-*] ',s):p=self.doc.add_paragraph(style='List Bullet');inline(p,s[2:]);continue
            if re.match(r'\d+\. ',s):p=self.doc.add_paragraph(style='List Number');inline(p,re.sub(r'^\d+\. ','',s));continue
            if s.startswith('>'):
                p=self.doc.add_paragraph();p.paragraph_format.left_indent=Cm(.6);shade(p._p,CODE_BG);inline(p,s.lstrip('> '),color=DARK);continue
            para=[s]
            while i<len(lines) and lines[i].strip() and not re.match(r'(```|\||#|[-*] |\d+\. |>|!\[)',lines[i].strip()):para.append(lines[i].strip());i+=1
            p=self.doc.add_paragraph();p.paragraph_format.first_line_indent=Pt(0);inline(p,''.join(para))
    def save(self):
        cp=self.doc.core_properties;cp.title=f'鲜境 FreshMarket {self.title}';cp.subject=self.code;cp.author='鲜境 FreshMarket 项目组';cp.keywords='FreshMarket'
        settings=self.doc.settings.element;upd=OxmlElement('w:updateFields');upd.set(qn('w:val'),'true');settings.append(upd)
        path=OUT/f'{self.file}.docx';self.doc.save(path);return path

if __name__=='__main__':
    for stem in (sys.argv[1:] or list(SPECS)):
        b=Builder(stem);b.render((DOCS/f'{stem}.md').read_text('utf-8'));print(b.save(),f'figures={b.figure}')
