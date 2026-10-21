// 渲染 docs/{requirements,design,test-report}.md 中尚无图片的 mermaid 块，写入 docs/diagrams/<日期>/ 并登记到 mermaid-manifest.json
// 需要 mermaid 浏览器包：MERMAID_JS=<path/to/mermaid.min.js> node scripts/render-mermaid.mjs（默认 .runtime/mermaid/node_modules/mermaid/dist/mermaid.min.js）
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
const manifestPath='docs/diagrams/mermaid-manifest.json',manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
const now=new Date(),day=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`,dir=`docs/diagrams/${day}`;
const script=readFileSync(process.env.MERMAID_JS||'.runtime/mermaid/node_modules/mermaid/dist/mermaid.min.js','utf8');
const pending=[];
for(const stem of ['requirements','design','test-report']){
  const text=readFileSync(`docs/${stem}.md`,'utf8').replace(/\r\n/g,'\n');let index=0;
  for(const match of text.matchAll(/```mermaid\n([\s\S]*?)```/g)){
    const source=match[1].trim(),key=createHash('sha256').update(source).digest('hex').slice(0,16);index++;
    if(!manifest[key]&&!pending.some(p=>p.key===key))pending.push({key,source,file:`${stem}-${String(index).padStart(2,'0')}-${key.slice(0,6)}.png`});
  }
}
if(!pending.length){console.log('All mermaid blocks already rendered.');process.exit(0);}
mkdirSync(dir,{recursive:true});
// 与 2026-10-18 已有图片相同的浅色配色
const config={startOnLoad:false,theme:'base',securityLevel:'strict',fontFamily:'Microsoft YaHei, sans-serif',themeVariables:{primaryColor:'#E6F4F4',primaryBorderColor:'#087F83',primaryTextColor:'#112233',lineColor:'#5A7D84',secondaryColor:'#FFF4E6',tertiaryColor:'#F8FCFC',fontSize:'15px'}};
const browser=await chromium.launch({timeout:30000,channel:process.platform==='win32'?'msedge':undefined});
try{
  const page=await browser.newPage({deviceScaleFactor:2,viewport:{width:1400,height:1000}});page.setDefaultTimeout(30000);page.on('console',m=>m.type()==='error'&&console.error('browser:',m.text()));
  await page.setContent('<!doctype html><html><body style="margin:0;background:#fff"><div id="out" style="display:inline-block;padding:16px"></div></body></html>');
  await page.addScriptTag({content:script});
  await page.evaluate(c=>window.mermaid.initialize(c),config);
  for(const item of pending){
    await page.evaluate(async source=>{const {svg}=await window.mermaid.render('d'+Date.now(),source);const out=document.getElementById('out');out.innerHTML=svg;const el=out.querySelector('svg'),width=parseFloat(el.style.maxWidth);if(width){el.removeAttribute('width');el.style.width=width+'px';}},item.source);
    await page.locator('#out').screenshot({path:`${dir}/${item.file}`});
    manifest[item.key]=`${day}/${item.file}`;console.log('rendered',item.key,`${dir}/${item.file}`);
  }
}finally{await browser.close();}
writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
