import {useEffect,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {Sparkles,Repeat} from 'lucide-react';
import {api,money} from './api';
import {useStore} from './store';
import {useLoad} from './components';
import type {Product} from './types';

// 推荐卡片不带加购按钮，避免与商品列表的“加入购物车”按钮重名
export function MiniCard({product:p}:{product:Product}){return <Link className="mini-card" to={'/products/'+p.id}><span className="mini-image"><img src={p.image} alt="" loading="lazy"/>{p.reason&&<i>{p.reason}</i>}</span><strong>{p.name}</strong><small>{p.unit}</small><b>{money(p.price)}</b></Link>;}
// 滚动到可视区域附近才请求推荐，首屏不额外占用请求
export function ForYou({title='猜你喜欢'}:{title?:string}){
  const ref=useRef<HTMLDivElement>(null),[visible,setVisible]=useState(false);
  useEffect(()=>{const node=ref.current;if(!node)return;if(!('IntersectionObserver' in window)){setVisible(true);return;}const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){setVisible(true);observer.disconnect();}},{rootMargin:'300px'});observer.observe(node);return()=>observer.disconnect();},[]);
  return <div ref={ref}>{visible&&<ForYouList title={title}/>}</div>;
}
function ForYouList({title}:{title:string}){
  const{user}=useStore(),data=useLoad(()=>api<Product[]>('/recommendations?limit=8'),[user?.id]);
  if(!data.data?.length)return null;
  return <section className="recommend-section" aria-label={title}><div className="section-heading"><div><span className="eyebrow">FOR YOU</span><h2><Sparkles size={21}/>{title}<small>{user?'根据您的购买与购物车偏好推荐':'登录后为您个性化推荐'}</small></h2></div></div><div className="mini-grid">{data.data.map(p=><MiniCard key={p.id} product={p}/>)}</div></section>;
}
export function Related({id}:{id:string}){
  const data=useLoad(()=>api<Product[]>('/products/'+id+'/related'),[id]);
  if(!data.data?.length)return null;
  return <section className="panel recommend-section" aria-label="买了又买"><h2><Repeat size={20}/>买了又买 <small>购买此商品的顾客也常买</small></h2><div className="mini-grid">{data.data.map(p=><MiniCard key={p.id} product={p}/>)}</div></section>;
}
