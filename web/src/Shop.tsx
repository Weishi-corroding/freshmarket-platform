import {useState} from 'react';
import {Link,useSearchParams,useParams} from 'react-router-dom';
import {Cherry,Fish,Beef,Carrot,Milk,CookingPot,Grid2X2,Plus,Truck,Clock,ShieldCheck,MapPin,Snowflake,Star,ShoppingCart} from 'lucide-react';
import {api,money} from './api';
import {useStore} from './store';
import {Empty,Failure,Loading,Pager,Quantity,useLoad} from './components';
import {HeroCarousel} from './HeroCarousel';
import {SearchHighlight} from './SearchHighlight';
import {ForYou,Related} from './Recommend';
import {HomePromotions} from './Promotions';
import type {Category,Product,Page} from './types';
const icons:Record<string,any>={fruit:Cherry,seafood:Fish,meat:Beef,vegetable:Carrot,dairy:Milk,ready:CookingPot};
export function Shop(){
  // 会员状态确定后再加载秒杀/领券/推荐，避免游客与会员身份各请求一次
  const{memberLoading}=useStore(),[params,setParams]=useSearchParams(),category=params.get('category') || '',q=params.get('q') || '',sort=params.get('sort') || 'default',page=Number(params.get('page') || 1);
  const categories=useLoad(()=>api<Category[]>('/categories'));
  const products=useLoad(()=>api<Page<Product>>('/products?'+new URLSearchParams({category,q,sort,page:String(page),pageSize:'12'})),[category,q,sort,page]);
  const update=(key:string,value:string)=>{const next=new URLSearchParams(params);if(value)next.set(key,value);else next.delete(key);if(key!=='page')next.delete('page');setParams(next);};
  const filtered=category || q;
  return <main className="container shop"><div className="breadcrumb">首页 <span>/</span> {q?'搜索结果':category?categories.data?.find(c=>c.id===category)?.name || '商品分类':'新鲜好物'}</div>{!filtered&&<><section className="hero-grid"><HeroCarousel/><div className="hero-secondary"><div><span className="eyebrow">OCEAN TO TABLE</span><h2>来自深海的<br/>鲜美礼物</h2><p>严选海味 · 冷链直达</p><Link to="/?category=seafood">逛逛海鲜水产</Link></div><img src="/images/salmon.jpg" alt="冰鲜三文鱼"/></div></section><div className="delivery-strip"><span><Clock size={18}/><b>预约配送</b> 选一个方便的时间</span><span><Truck size={19}/><b>满¥99免配送费</b> 新鲜好物一起买</span><span><ShieldCheck size={18}/><b>安心选购</b> 品质问题售后处理</span></div>{!memberLoading&&<HomePromotions/>}</>}
    <section className="category-section" aria-label="商品分类"><button className={'category '+(!category?'selected':'')} onClick={()=>update('category','')}><span><Grid2X2 size={27}/></span><strong>全部好物</strong></button>{categories.data?.map(c=>{const Icon=icons[c.id] || Grid2X2;return <button key={c.id} className={'category '+(category===c.id?'selected':'')} onClick={()=>update('category',c.id)}><span><Icon size={29}/></span><strong>{c.name}</strong></button>;})}</section>
    <div className="section-heading"><div><span className="eyebrow">DAILY FRESHNESS</span><h2>{q?'“'+q+'” 的搜索结果':category?categories.data?.find(c=>c.id===category)?.name:'今日鲜选'}<small>{products.data?.total || 0} 款新鲜好物</small></h2></div><div className="sorts"><button className={sort==='default'?'active':''} onClick={()=>update('sort','default')}>综合推荐</button><button className={sort==='sales'?'active':''} onClick={()=>update('sort','sales')}>人气优选</button><select aria-label="价格排序" value={sort.startsWith('price')?sort:''} onChange={e=>update('sort',e.target.value || 'default')}><option value="">价格排序</option><option value="priceAsc">价格从低到高</option><option value="priceDesc">价格从高到低</option></select></div></div>
    {products.loading?<Loading/>:products.error?<Failure error={products.error} retry={products.reload}/>:products.data?.items.length?<><div className="product-grid">{products.data.items.map(p=><ProductCard key={p.id} product={p} query={q}/>)}</div><Pager page={page} total={products.data.total} size={12} onPage={n=>{update('page',String(n));window.scrollTo({top:0,behavior:'smooth'});}}/></>:<><Empty title="暂时没有找到这些好物" text="换个关键词，或看看其他分类" action={<button className="button secondary" onClick={()=>setParams({})}>查看全部商品</button>}/>{q&&!memberLoading&&<ForYou title="没找到？看看这些"/>}</>}
    {!filtered&&!memberLoading&&<ForYou/>}
  </main>;
}
function ProductCard({product:p,query}:{product:Product;query:string}){
  const{user,cart,add,setQuantity}=useStore(),[busy,setBusy]=useState(false);
  const item=user?cart.items.find(item=>item.id===p.id):undefined,quantity=item?.quantity || 0;
  const changeQuantity=async(value:number)=>{
    if(busy)return;
    setBusy(true);
    try{if(quantity)await setQuantity(p.id,value);else await add(p.id);}finally{setBusy(false);}
  };
  return <article className="product-card">
    <Link to={'/products/'+p.id} className="product-image"><img src={p.image} alt={p.name} loading="lazy"/><span className={'product-tag '+(p.tag==='人气好物'?'orange':'')}>{p.tag}</span>{p.stock===0&&<span className="sold-out">暂时售罄</span>}</Link>
    <div className="product-content">
      <Link className="product-title" to={'/products/'+p.id}><SearchHighlight text={p.name} query={query}/></Link>
      <p><SearchHighlight text={p.subtitle} query={query}/></p>
      <span className="product-unit">{p.unit} <i>·</i> <SearchHighlight text={p.origin} query={query}/></span>
      <span className={'product-stock '+(p.stock===0?'product-stock-empty':p.stock<20?'product-stock-low':'')}>
        <span>库存 {p.stock} 件</span>
        {p.stock<20&&<span>· {p.stock===0?'暂时售罄':'库存紧张'}</span>}
      </span>
      <div className="product-bottom"><span><b>{money(p.price)}</b><del>{money(p.original_price)}</del></span>{quantity>0?<div className="product-quantity" role="group" aria-label={p.name+'购物车数量'} aria-busy={busy}><Quantity value={quantity} min={0} max={Math.min(99,item?.stock ?? p.stock)} disabled={busy} onChange={changeQuantity}/></div>:<button className="add-button" aria-label={'加入购物车 '+p.name} disabled={busy || !p.stock} onClick={()=>changeQuantity(1)}><Plus size={22}/></button>}</div>
    </div>
  </article>;
}
export function ProductPage(){const{id}=useParams(),{add}=useStore(),[quantity,setQuantity]=useState(1);const item=useLoad(()=>api<Product>('/products/'+id),[id]);if(item.loading)return <Loading/>;if(item.error)return <Failure error={item.error} retry={item.reload}/>;const p=item.data!;return <main className="container detail-page"><div className="breadcrumb"><Link to="/">首页</Link><span>/</span>商品详情<span>/</span>{p.name}</div><section className="product-detail"><div className="detail-image"><img src={p.image} alt={p.name}/></div><div className="detail-info"><span className="pill">{p.tag}</span><h1>{p.name}</h1><p className="detail-subtitle">{p.subtitle}</p><div className="detail-price"><strong>{money(p.price)}</strong><del>{money(p.original_price)}</del><span>已售 {p.sales} 件</span></div><dl><div><dt>商品规格</dt><dd>{p.unit}</dd></div><div><dt><MapPin size={16}/>产地</dt><dd>{p.origin}</dd></div><div><dt><Snowflake size={16}/>储存方式</dt><dd>{p.storage}</dd></div><div><dt>剩余库存</dt><dd>{p.stock} 件</dd></div></dl><div className="detail-buy"><Quantity value={quantity} max={Math.min(99,p.stock)} onChange={setQuantity}/><button className="button" disabled={!p.stock} onClick={()=>add(p.id,quantity)}><ShoppingCart size={19}/>{p.stock?'加入购物车':'暂时售罄'}</button></div><div className="detail-promises"><span><Truck size={16}/>全程冷链</span><span><ShieldCheck size={16}/>品质保障</span><span>满¥99免配送费</span></div></div></section><section className="panel product-description"><h2>好食材，有来处</h2><p>{p.description}</p><p className="muted">图片为食材示意，包装、重量与外观请以实物为准。</p></section><Related id={p.id}/><section className="panel"><h2>顾客评价 <small>{p.reviews?.length || 0} 条</small></h2>{p.reviews?.length?p.reviews.map((r,i)=><div className="review" key={i}><strong>{r.name.slice(0,1)}**</strong><span className="stars">{'★'.repeat(r.rating)}{'☆'.repeat(5-r.rating)}</span><p>{r.content}</p></div>):<Empty title="还没有评价" text="收货后，分享您的新鲜体验"/>}</section></main>;}
