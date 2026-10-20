import {useState} from 'react';
import {Pencil,Plus,RefreshCw} from 'lucide-react';
import {api,date,json,money,couponRule,couponScope} from '../api';
import {Empty,Failure,Loading,Modal,Pager,useLoad} from '../components';
import {useStore} from '../store';
import type {Category,Coupon,Page,Product,Seckill} from '../types';
import {AdminSearch,PageTitle} from './shared';

// datetime-local 与毫秒时间戳互转（按浏览器本地时区）
const local=(ms:number)=>new Date(Number(ms)-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);
const stamp=(value:string)=>new Date(value).getTime();
const fen=(yuan:string)=>Math.round(Number(yuan)*100);
const window_=(start:number,end:number,now=Date.now())=>Number(end)<=now?'已结束':Number(start)>now?'未开始':'进行中';
export function Promotions(){
  const[tab,setTab]=useState<'coupons'|'seckill'>('coupons');
  return <><PageTitle title="营销活动" text="维护优惠券与限时秒杀。已被领取的优惠券、已有成交的秒杀会锁定优惠规则，只能调整名称、数量、时间与启停。"/>
    <div className="account-tabs" role="tablist">{([['coupons','优惠券'],['seckill','限时秒杀']] as const).map(([id,label])=><button key={id} role="tab" aria-selected={tab===id} onClick={()=>setTab(id)}>{label}</button>)}</div>
    {tab==='coupons'?<Coupons/>:<Seckills/>}</>;
}
function Coupons(){
  const[page,setPage]=useState(1),[q,setQ]=useState(''),[editing,setEditing]=useState<Coupon|null>();
  const data=useLoad(()=>api<Page<Coupon>>('/admin/coupons?'+new URLSearchParams({page:String(page),pageSize:'15',q})),[page,q]),categories=useLoad(()=>api<Category[]>('/categories'));
  return <section className="panel table-panel"><div className="table-toolbar"><AdminSearch label="搜索优惠券" placeholder="搜索优惠券名称" onSearch={value=>{setQ(value);setPage(1);}}/><button className="icon-button" aria-label="刷新优惠券" onClick={data.reload}><RefreshCw size={17}/></button><button className="button small" disabled={!categories.data} onClick={()=>setEditing(null)}><Plus size={16}/>新建优惠券</button></div>
    {data.loading?<Loading/>:data.error?<Failure error={data.error} retry={data.reload}/>:<><p className="table-summary">共 {data.data?.total || 0} 张优惠券</p><div className="table-scroll"><table><thead><tr><th>优惠券</th><th>规则</th><th>领取 / 总量</th><th>已使用</th><th>有效期</th><th>状态</th><th>操作</th></tr></thead><tbody>{data.data?.items.map(c=><tr key={c.id}><td><strong>{c.name}</strong><small className="block">{couponScope(c)}</small></td><td>{couponRule(c)}</td><td>{c.issued} / {c.total}</td><td>{c.used}</td><td className="wrap-cell">{date(c.valid_from)}<small className="block">至 {date(c.valid_to)}</small></td><td><span className="pill">{c.active?window_(c.valid_from,c.valid_to):'已停用'}</span></td><td><button className="text-button" onClick={()=>setEditing(c)}><Pencil size={14}/>编辑</button></td></tr>)}</tbody></table></div>{!data.data?.items.length&&<Empty title="还没有优惠券"/>}<Pager page={page} total={data.data?.total || 0} size={15} onPage={setPage}/></>}
    {editing!==undefined&&categories.data&&<CouponEditor coupon={editing} categories={categories.data} onClose={()=>setEditing(undefined)} onSaved={data.reload}/>}
  </section>;
}
function CouponEditor({coupon,categories,onClose,onSaved}:{coupon:Coupon|null;categories:Category[];onClose:()=>void;onSaved:()=>void}){
  const{notify}=useStore(),now=Date.now(),locked=!!coupon && coupon.issued>0;
  const[form,setForm]=useState({name:coupon?.name || '',kind:coupon?.kind || 'amount',threshold:String((coupon?.threshold ?? 9900)/100),value:coupon?(coupon.kind==='amount'?String(coupon.value/100):String(coupon.value)):'10',max_discount:String((coupon?.max_discount || 0)/100),category_id:coupon?.category_id || '',total:String(coupon?.total ?? 100),valid_from:local(coupon?.valid_from ?? now),valid_to:local(coupon?.valid_to ?? now+30*86400000),active:coupon?.active ?? 1});
  const[busy,setBusy]=useState(false),[error,setError]=useState(''),set=(key:string,value:any)=>setForm(f=>({...f,[key]:value}));
  return <Modal title={coupon?'编辑优惠券':'新建优惠券'} wide onClose={()=>{if(!busy)onClose();}}><form className="form-stack" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{await api('/admin/coupons'+(coupon?'/'+coupon.id:''),{method:coupon?'PUT':'POST',body:json({name:form.name.trim(),kind:form.kind,threshold:fen(form.threshold),value:form.kind==='amount'?fen(form.value):Number(form.value),max_discount:form.kind==='percent'?fen(form.max_discount):0,category_id:form.category_id,total:Number(form.total),valid_from:stamp(form.valid_from),valid_to:stamp(form.valid_to),active:form.active})});notify('优惠券已保存');onSaved();onClose();}catch(e:any){setError(e.message);}finally{setBusy(false);}}}>
    {locked&&<p className="info-box">已有 {coupon!.issued} 位会员领取，优惠规则与开始时间已锁定。</p>}
    <div className="form-grid"><label>优惠券名称<input required maxLength={40} value={form.name} onChange={e=>set('name',e.target.value)} placeholder="如：新人满99减15"/></label>
      <label>优惠类型<select disabled={locked} value={form.kind} onChange={e=>set('kind',e.target.value)}><option value="amount">满减券</option><option value="percent">折扣券</option></select></label>
      <label>使用门槛（元，0为无门槛）<input required disabled={locked} type="number" min="0" step="0.01" value={form.threshold} onChange={e=>set('threshold',e.target.value)}/></label>
      <label>{form.kind==='amount'?'减免金额（元）':'折扣（10–99，90即9折）'}<input required disabled={locked} type="number" min={form.kind==='amount'?'0.01':'10'} max={form.kind==='amount'?undefined:'99'} step={form.kind==='amount'?'0.01':'1'} value={form.value} onChange={e=>set('value',e.target.value)}/></label>
      {form.kind==='percent'&&<label>最高优惠（元，0为不封顶）<input required disabled={locked} type="number" min="0" step="0.01" value={form.max_discount} onChange={e=>set('max_discount',e.target.value)}/></label>}
      <label>适用范围<select disabled={locked} value={form.category_id} onChange={e=>set('category_id',e.target.value)}><option value="">全场通用</option>{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label>发放总量<input required type="number" min={Math.max(1,coupon?.issued || 0)} step="1" value={form.total} onChange={e=>set('total',e.target.value)}/></label>
      <label>开始时间<input required disabled={locked} type="datetime-local" value={form.valid_from} onChange={e=>set('valid_from',e.target.value)}/></label>
      <label>结束时间<input required type="datetime-local" value={form.valid_to} onChange={e=>set('valid_to',e.target.value)}/></label></div>
    <label className="checkbox-label"><input type="checkbox" checked={!!form.active} onChange={e=>set('active',e.target.checked?1:0)}/>启用（停用后不再发放，已领取的券仍可在有效期内使用）</label>
    {error&&<p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>取消</button><button className="button" disabled={busy}>{busy?'保存中…':'保存优惠券'}</button></div>
  </form></Modal>;
}
function Seckills(){
  const[page,setPage]=useState(1),[editing,setEditing]=useState<Seckill|null>();
  const data=useLoad(()=>api<Page<Seckill>>('/admin/seckill?'+new URLSearchParams({page:String(page),pageSize:'15'})),[page]),products=useLoad(()=>api<Page<Product>>('/admin/products?pageSize=100&active=1'));
  return <section className="panel table-panel"><div className="table-toolbar"><span className="muted">秒杀名额与商品库存同时扣减，每人每场限购1件，未付款5分钟自动取消并释放名额。</span><button className="icon-button" aria-label="刷新秒杀活动" onClick={data.reload}><RefreshCw size={17}/></button><button className="button small" disabled={!products.data} onClick={()=>setEditing(null)}><Plus size={16}/>新建秒杀</button></div>
    {data.loading?<Loading/>:data.error?<Failure error={data.error} retry={data.reload}/>:<><p className="table-summary">共 {data.data?.total || 0} 场秒杀</p><div className="table-scroll"><table><thead><tr><th>活动商品</th><th>秒杀价 / 售价</th><th>已售 / 名额</th><th>活动时间</th><th>状态</th><th>操作</th></tr></thead><tbody>{data.data?.items.map(s=><tr key={s.id}><td><div className="table-product"><img src={s.image} alt=""/><span><strong>{s.title}</strong><small>{s.product_name} · 商品库存 {s.product_stock}</small></span></div></td><td>{money(s.price)}<small className="block"><del>{money(s.original_price || 0)}</del></small></td><td>{s.sold} / {s.stock}</td><td className="wrap-cell">{date(s.start_at)}<small className="block">至 {date(s.end_at)}</small></td><td><span className="pill">{s.active?window_(s.start_at,s.end_at):'已停用'}</span></td><td><button className="text-button" onClick={()=>setEditing(s)}><Pencil size={14}/>编辑</button></td></tr>)}</tbody></table></div>{!data.data?.items.length&&<Empty title="还没有秒杀活动"/>}<Pager page={page} total={data.data?.total || 0} size={15} onPage={setPage}/></>}
    {editing!==undefined&&products.data&&<SeckillEditor activity={editing} products={products.data.items} onClose={()=>setEditing(undefined)} onSaved={data.reload}/>}
  </section>;
}
function SeckillEditor({activity,products,onClose,onSaved}:{activity:Seckill|null;products:Product[];onClose:()=>void;onSaved:()=>void}){
  const{notify}=useStore(),now=Date.now(),locked=!!activity && activity.sold>0;
  const[form,setForm]=useState({product_id:activity?.product_id || products[0]?.id || '',title:activity?.title || '',price:activity?String(activity.price/100):'',stock:String(activity?.stock ?? 20),start_at:local(activity?.start_at ?? now),end_at:local(activity?.end_at ?? now+2*3600000),active:activity?.active ?? 1});
  const[busy,setBusy]=useState(false),[error,setError]=useState(''),set=(key:string,value:any)=>setForm(f=>({...f,[key]:value})),product=products.find(p=>p.id===form.product_id);
  return <Modal title={activity?'编辑秒杀活动':'新建秒杀活动'} wide onClose={()=>{if(!busy)onClose();}}><form className="form-stack" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{await api('/admin/seckill'+(activity?'/'+activity.id:''),{method:activity?'PUT':'POST',body:json({product_id:form.product_id,title:form.title.trim(),price:fen(form.price),stock:Number(form.stock),start_at:stamp(form.start_at),end_at:stamp(form.end_at),active:form.active})});notify('秒杀活动已保存');onSaved();onClose();}catch(e:any){setError(e.message);}finally{setBusy(false);}}}>
    {locked&&<p className="info-box">已售出 {activity!.sold} 件，商品与秒杀价已锁定，名额不能少于已售数量。</p>}
    <div className="form-grid"><label>秒杀商品<select disabled={locked} value={form.product_id} onChange={e=>set('product_id',e.target.value)}>{activity&&!products.some(p=>p.id===activity.product_id)&&<option value={activity.product_id}>{activity.product_name}</option>}{products.map(p=><option key={p.id} value={p.id}>{p.name}（{money(p.price)}，库存{p.stock}）</option>)}</select></label>
      <label>活动标题<input required maxLength={40} value={form.title} onChange={e=>set('title',e.target.value)} placeholder="如：车厘子限时秒杀"/></label>
      <label>秒杀价（元{product?`，需低于 ${money(product.price)}`:''}）<input required disabled={locked} type="number" min="0.01" step="0.01" value={form.price} onChange={e=>set('price',e.target.value)}/></label>
      <label>秒杀名额<input required type="number" min={Math.max(1,activity?.sold || 0)} max="100000" step="1" value={form.stock} onChange={e=>set('stock',e.target.value)}/></label>
      <label>开始时间<input required type="datetime-local" value={form.start_at} onChange={e=>set('start_at',e.target.value)}/></label>
      <label>结束时间<input required type="datetime-local" value={form.end_at} onChange={e=>set('end_at',e.target.value)}/></label></div>
    <label className="checkbox-label"><input type="checkbox" checked={!!form.active} onChange={e=>set('active',e.target.checked?1:0)}/>启用活动</label>
    {error&&<p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>取消</button><button className="button" disabled={busy || !form.product_id}>{busy?'保存中…':'保存秒杀'}</button></div>
  </form></Modal>;
}
