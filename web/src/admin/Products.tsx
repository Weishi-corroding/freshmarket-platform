import {useEffect,useState} from 'react';
import {Pencil,Plus,RefreshCw,Trash2} from 'lucide-react';
import {api,json,money} from '../api';
import {Empty,Failure,Loading,Modal,Pager,useLoad} from '../components';
import {SearchHighlight} from '../SearchHighlight';
import {useStore} from '../store';
import type {Category,Page,Product} from '../types';
import {AdminSearch,ConfirmAction,PageTitle} from './shared';

const payload=(product:Product)=>Object.fromEntries(['category_id','name','subtitle','description','price','original_price','image','unit','origin','storage','tag','active'].map(key=>[key,product[key as keyof Product]]));
export function Products({stockOnly}:{stockOnly:boolean}) {
  const {staffUser:user,notify}=useStore();
  const [page,setPage]=useState(1),[q,setQ]=useState(''),[category,setCategory]=useState(''),[active,setActive]=useState('');
  const [editing,setEditing]=useState<Product|null|undefined>(),[detail,setDetail]=useState<Product>(),[removing,setRemoving]=useState<Product>(),[stock,setStock]=useState<Product>(),[busy,setBusy]=useState(false);
  const products=useLoad(()=>api<Page<Product>>('/admin/products?'+new URLSearchParams({page:String(page),pageSize:'12',q,category,active})),[page,q,category,active]);
  useEffect(()=>{if(!products.loading&&products.data)setPage(value=>Math.min(value,Math.max(1,Math.ceil(products.data!.total/12))));},[products.loading,products.data?.total]);
  const categories=useLoad(()=>api<Category[]>('/categories'));
  const latest=async(product:Product,action:'edit'|'detail'|'stock')=>{try{const value=await api<Product>('/admin/products/'+product.id);if(action==='edit')setEditing(value);else if(action==='stock')setStock(value);else setDetail(value);}catch(e:any){notify(e.message,true);}};
  return <>
    <PageTitle title={stockOnly?'库存管理':'商品管理'} text={stockOnly?'登记入库和损耗，库存变动保留审计记录。':'维护商品资料和上下架状态，管理员可删除错误商品。'}>{!stockOnly&&user?.capabilities.includes('products')&&<button className="button" disabled={!categories.data?.length} onClick={()=>setEditing(null)}><Plus size={17}/>新增商品</button>}</PageTitle>
    {categories.error&&<Failure error={categories.error} retry={categories.reload}/>}
    <section className="panel table-panel"><div className="table-toolbar">
      <AdminSearch label="搜索商品管理" placeholder="搜索商品名称或产地" onSearch={value=>{setQ(value);setPage(1);}}/>
      <select aria-label="筛选商品分类" value={category} onChange={e=>{setCategory(e.target.value);setPage(1);}}><option value="">全部分类</option>{categories.data?.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
      <select aria-label="筛选商品状态" value={active} onChange={e=>{setActive(e.target.value);setPage(1);}}><option value="">全部状态</option><option value="1">已上架</option><option value="0">已下架</option></select>
      <button className="icon-button" aria-label="刷新商品" onClick={products.reload}><RefreshCw size={17}/></button>
    </div>{products.loading?<Loading/>:products.error?<Failure error={products.error} retry={products.reload}/>:<>
      <p className="table-summary">共 {products.data?.total || 0} 款商品</p>
      <div className="table-scroll"><table><thead><tr><th>商品信息</th><th>分类</th><th>售价</th><th>可售库存</th><th>销量</th><th>状态</th><th>操作</th></tr></thead><tbody>{products.data?.items.map(product=><tr key={product.id}>
        <td><div className="table-product"><img src={product.image} alt=""/><span><strong><SearchHighlight text={product.name} query={q}/></strong><small>{product.unit}</small></span></div></td>
        <td>{categories.data?.find(c=>c.id===product.category_id)?.name}</td><td><strong>{money(product.price)}</strong></td><td><span className={product.stock<20?'stock-warning':''}>{product.stock} 件</span></td><td>{product.sales}</td><td><span className={'pill '+(!product.active?'gray':'')}>{product.active?'已上架':'已下架'}</span></td>
        <td><div className="table-actions"><button className="text-button" onClick={()=>latest(product,'detail')}>详情</button>
          {!stockOnly&&user?.capabilities.includes('products')&&<><button className="text-button" onClick={()=>latest(product,'edit')}><Pencil size={14}/>编辑</button><button className="text-button" disabled={busy} onClick={async()=>{setBusy(true);try{await api('/admin/products/'+product.id,{method:'PUT',body:json({...payload(product),active:product.active?0:1})});products.reload();notify(product.active?'商品已下架':'商品已上架');}catch(e:any){notify(e.message,true);}finally{setBusy(false);}}}>{product.active?'下架':'上架'}</button></>}
          {user?.capabilities.includes('stock')&&<button className="text-button" onClick={()=>latest(product,'stock')}>调库存</button>}
          {!stockOnly&&user?.capabilities.includes('products.delete')&&<button className="text-button danger" onClick={()=>setRemoving(product)}><Trash2 size={14}/>删除</button>}
        </div></td>
      </tr>)}</tbody></table></div>{!products.data?.items.length&&<Empty title="没有匹配的商品"/>}<Pager page={page} total={products.data?.total || 0} size={12} onPage={setPage}/>
    </>}</section>
    {editing!==undefined&&<ProductEditor product={editing || undefined} categories={categories.data || []} onClose={()=>setEditing(undefined)} onSaved={()=>{products.reload();notify('商品已保存');}}/>}
    {detail&&<Modal title="商品详情" wide onClose={()=>setDetail(undefined)}><div className="admin-product-detail"><img src={detail.image} alt={detail.name}/><div><h3>{detail.name}</h3><p>{detail.subtitle}</p><strong>{money(detail.price)}</strong><p className="muted">{detail.unit} · {detail.origin}</p><p className="muted">{detail.storage} · {detail.active?'已上架':'已下架'}</p><p>可售库存 {detail.stock} 件 · 销量 {detail.sales}</p></div></div><p className="muted">{detail.description}</p></Modal>}
    {stock&&<StockEditor product={stock} onClose={()=>setStock(undefined)} onSaved={()=>{products.reload();notify('库存调整已记录');}}/>}
    {removing&&<ConfirmAction title="删除商品" onClose={()=>setRemoving(undefined)} onConfirm={async()=>{await api('/admin/products/'+removing.id,{method:'DELETE'});products.reload();notify('商品已删除');}}><p>确认删除 <strong>{removing.name}</strong>？</p><p>商品将从商城、后台商品列表和购物车移除，历史订单与售后记录保留。只需暂停售卖时可选择下架。</p></ConfirmAction>}
  </>;
}
function StockEditor({product,onClose,onSaved}:{product:Product;onClose:()=>void;onSaved:()=>void}) {
  const [delta,setDelta]=useState('10'),[reason,setReason]=useState('采购入库'),[busy,setBusy]=useState(false),[error,setError]=useState('');
  return <Modal title="调整商品库存" onClose={()=>{if(!busy)onClose();}}><form className="form-stack" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{await api('/admin/products/'+product.id+'/stock',{method:'POST',body:json({delta:Number(delta),reason:reason.trim()})});onSaved();onClose();}catch(e:any){setError(e.message);}finally{setBusy(false);}}}>
    <p><strong>{product.name}</strong> · 当前可售库存 {product.stock} 件</p><label>调整数量<input required type="number" min={-100000} max={100000} step={1} value={delta} onChange={e=>setDelta(e.target.value)}/></label><small className="muted">入库填写正数，损耗填写负数。调整后库存不能小于0。</small><label>调整原因<input required maxLength={200} value={reason} onChange={e=>setReason(e.target.value)}/></label>{error&&<p className="form-error" role="alert">{error}</p>}<button className="button" disabled={busy || Number(delta)===0 || !reason.trim()}>{busy?'处理中…':'确认调整'}</button>
  </form></Modal>;
}
function ProductEditor({product,categories,onClose,onSaved}:{product?:Product;categories:Category[];onClose:()=>void;onSaved:()=>void}) {
  const initial=product?payload(product):{name:'',subtitle:'',description:'',category_id:categories[0]?.id || 'fruit',price:1990,original_price:2590,image:'/images/apple.jpg',unit:'500g / 盒',origin:'',storage:'0–4°C 冷藏',tag:'今日鲜到',active:1};
  const [form,setForm]=useState<any>(initial),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const set=(key:string,value:any)=>setForm((v:any)=>({...v,[key]:value}));
  const images=['strawberry','pineapple','avocado','cherry','blueberry','apple','salmon','shrimp','fish','steak','eggs','pork','chicken','broccoli','tomato','cucumber','carrot','milk','yogurt','croissant','dumplings','pasta','salad','banana','grape','scallop','clam','crab','oyster','squid','ribs','chicken-breast','lamb','beef-shank','spinach','bok-choy','potato','shiitake','toast','bagel','cheddar','butter','egg-tart','jiaozi','baozi','tangyuan','scallion-pancake','zongzi'].map(value=>'/images/'+value+'.jpg');
  if(!images.includes(form.image))images.push(form.image);
  return <Modal title={product?'编辑商品':'新增商品'} wide onClose={()=>{if(!busy)onClose();}}><form className="form-stack" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{await api('/admin/products'+(product?'/'+product.id:''),{method:product?'PUT':'POST',body:json(form)});onSaved();onClose();}catch(e:any){setError(e.message);}finally{setBusy(false);}}}>
    <div className="form-grid"><label>商品名称<input required maxLength={80} value={form.name} onChange={e=>set('name',e.target.value)}/></label><label>商品分类<select value={form.category_id} onChange={e=>set('category_id',e.target.value)}>{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label>商品售价（元）<input required type="number" min="0.01" max="100000" step="0.01" value={form.price/100} onChange={e=>set('price',Math.round(Number(e.target.value)*100))}/></label><label>参考原价（元）<input required type="number" min="0.01" max="100000" step="0.01" value={form.original_price/100} onChange={e=>set('original_price',Math.round(Number(e.target.value)*100))}/></label>
      <label>规格<input required maxLength={80} value={form.unit} onChange={e=>set('unit',e.target.value)}/></label><label>产地<input required maxLength={80} value={form.origin} onChange={e=>set('origin',e.target.value)}/></label><label>储存方式<input required maxLength={100} value={form.storage} onChange={e=>set('storage',e.target.value)}/></label><label>商品标签<input required maxLength={30} value={form.tag} onChange={e=>set('tag',e.target.value)}/></label></div>
    <label>简短介绍<input required maxLength={120} value={form.subtitle} onChange={e=>set('subtitle',e.target.value)}/></label><label>商品描述<textarea required maxLength={3000} value={form.description} onChange={e=>set('description',e.target.value)}/></label>
    <label>食材示意图<select value={form.image} onChange={e=>set('image',e.target.value)}>{images.map(value=><option key={value} value={value}>{value.replace('/images/','').replace('.jpg','')}</option>)}</select></label><label className="checkbox-label"><input type="checkbox" checked={!!form.active} onChange={e=>set('active',e.target.checked?1:0)}/>上架销售</label>
    {!product&&<p className="info-box">新商品初始库存为0，请在库存管理中登记采购入库。</p>}{error&&<p className="form-error" role="alert">{error}</p>}<button className="button" disabled={busy}>{busy?'保存中…':'保存商品'}</button>
  </form></Modal>;
}
