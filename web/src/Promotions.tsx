import {useEffect,useRef,useState,type ReactNode} from 'react';
import {Link,useNavigate} from 'react-router-dom';
import {Zap,TicketPercent,Clock} from 'lucide-react';
import {api,json,money,couponRule,couponScope,day} from './api';
import {useStore} from './store';
import {Empty,Failure,Loading,Modal,useLoad} from './components';
import type {Coupon,CouponRule,Seckill,UserCoupon} from './types';

const slots=['尽快送达','今日 18:00–20:00','明日 09:00–12:00','明日 14:00–18:00'];
const clock=(ms:number)=>{const s=Math.max(0,Math.floor(ms/1000)),d=Math.floor(s/86400),t=[Math.floor(s%86400/3600),Math.floor(s%3600/60),s%60].map(n=>String(n).padStart(2,'0')).join(':');return d?d+'天 '+t:t;};
function useNow(){const[now,setNow]=useState(Date.now());useEffect(()=>{const t=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(t);},[]);return now;}

// 首页限时秒杀：按服务器时间校正倒计时，开始/结束状态在前端实时切换
type HomeData={now:number;seckill:Seckill[];coupons:Coupon[]};
export function HomePromotions(){const{user}=useStore(),data=useLoad(()=>api<HomeData>('/promotions'),[user?.id]);return data.data?<><SeckillZone now={data.data.now} items={data.data.seckill}/><CouponCenter coupons={data.data.coupons} reload={data.reload}/></>:null;}
function SeckillZone({now:server,items:all}:{now:number;items:Seckill[]}){
  const{user,login}=useStore(),[buying,setBuying]=useState<Seckill>(),now=useNow(),offset=useRef(0);
  useEffect(()=>{offset.current=server-Date.now();},[server]);
  const serverNow=now+offset.current,items=all.filter(s=>Number(s.end_at)>serverNow);
  if(!items.length)return null;
  return <section className="seckill-zone" aria-label="限时秒杀"><div className="section-heading"><div><span className="eyebrow">FLASH SALE</span><h2><Zap size={21}/>限时秒杀<small>每人每场限购1件 · 5分钟内付款</small></h2></div></div><div className="seckill-list">{items.map(s=>{
    const started=serverNow>=Number(s.start_at),left=s.remaining || 0,label=s.joined?'已抢到':!started?'即将开始':left?'立即抢购':'已抢光';
    return <article className="seckill-card" key={s.id}><Link to={'/products/'+s.product_id} className="seckill-image"><img src={s.image} alt={s.name}/></Link><div className="seckill-body"><strong>{s.title}</strong><small>{s.name} · {s.unit}</small><span className="seckill-price"><b>{money(s.price)}</b><del>{money(s.original_price || 0)}</del></span><span className="seckill-progress" aria-hidden="true"><i style={{width:Math.round(Number(s.sold)/Number(s.stock)*100)+'%'}}/></span><small>已抢 {s.sold}/{s.stock} 件 · 剩余 {left} 件</small><small className="seckill-time"><Clock size={13}/>{started?'距结束 ':'距开始 '}{clock(Number(started?s.end_at:s.start_at)-serverNow)}</small><button className="button small" disabled={label!=='立即抢购'} onClick={()=>user?setBuying(s):login()}>{label}</button></div></article>;
  })}</div>{buying&&<SeckillBuy activity={buying} onClose={()=>setBuying(undefined)}/>}</section>;
}
function SeckillBuy({activity,onClose}:{activity:Seckill;onClose:()=>void}){
  const{addresses,delivery,notify}=useStore(),navigate=useNavigate(),key=useRef(crypto.randomUUID());
  const[address,setAddress]=useState(addresses.find(a=>a.id===delivery.id)?.id || addresses.find(a=>a.is_default)?.id || addresses[0]?.id || ''),[slot,setSlot]=useState(slots[0]),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const fee=Number(activity.price)>=9900?0:600;
  return <Modal title="确认秒杀订单" onClose={()=>{if(!busy)onClose();}}><form className="form-stack" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{const order=await api<{id:string}>('/seckill/'+activity.id+'/orders',{method:'POST',headers:{'Idempotency-Key':key.current},body:json({addressId:address,deliverySlot:slot})});notify('抢购成功，请在5分钟内完成付款');navigate('/orders?new='+order.id);}catch(e:any){setError(e.message);}finally{setBusy(false);}}}>
    <div className="checkout-product"><img src={activity.image} alt=""/><div><strong>{activity.title}</strong><small>{activity.name} · 限购1件</small></div><strong>{money(activity.price)}</strong></div>
    {addresses.length?<label>收货地址<select value={address} onChange={e=>{setAddress(e.target.value);key.current=crypto.randomUUID();}}>{addresses.map(a=><option key={a.id} value={a.id}>{a.name} · {a.detail}</option>)}</select></label>:<p className="info-box">请先<Link to="/account" onClick={onClose}>添加收货地址</Link>再参与秒杀。</p>}
    <label>配送时间<select value={slot} onChange={e=>{setSlot(e.target.value);key.current=crypto.randomUUID();}}>{slots.map(s=><option key={s}>{s}</option>)}</select></label>
    <p className="refund-summary">应付合计 <strong>{money(Number(activity.price)+fee)}</strong><small>{fee?'含配送费 '+money(fee):'免配送费'}</small></p>
    <p className="muted">秒杀商品不可使用优惠券；未在5分钟内付款将自动取消并释放名额。</p>
    {error&&<p className="form-error" role="alert">{error}</p>}
    <button className="button full" disabled={busy || !address}>{busy?'正在抢购…':'确认抢购'}</button>
  </form></Modal>;
}

export function CouponTicket({coupon:c,muted=false,children}:{coupon:CouponRule&{name:string};muted?:boolean;children?:ReactNode}){
  return <div className={'coupon-ticket'+(muted?' muted':'')}><div className="coupon-value"><b>{c.kind==='amount'?<><small>¥</small>{Number(c.value)/100}</>:<>{Number(c.value)/10}<small>折</small></>}</b><small>{c.threshold?`满${Number(c.threshold)/100}可用`:'无门槛'}</small></div><div className="coupon-info"><strong title={couponRule(c)}>{c.name}</strong><span>{couponScope(c)}{c.kind==='percent'&&Number(c.max_discount)>0?` · 最高减${Number(c.max_discount)/100}`:''}</span><small>有效期至 {day(c.valid_to)}</small></div>{children}</div>;
}
function CouponCenter({coupons,reload}:{coupons:Coupon[];reload:()=>void}){
  const{user,login,notify}=useStore(),[busy,setBusy]=useState('');
  if(!coupons.length)return null;
  const take=async(c:Coupon)=>{if(!user)return login();setBusy(c.id);try{await api('/coupons/'+c.id+'/claim',{method:'POST'});notify('领取成功，结算时自动推荐可用优惠券');reload();}catch(e:any){notify(e.message,true);reload();}finally{setBusy('');}};
  return <section className="coupon-center" aria-label="领券中心"><div className="section-heading"><div><span className="eyebrow">COUPONS</span><h2><TicketPercent size={21}/>领券中心<small>领取后结算时自动选择最优惠的券</small></h2></div></div><div className="coupon-list">{coupons.map(c=><CouponTicket key={c.id} coupon={c} muted={c.claimed || !c.remaining}><button className="button small" disabled={c.claimed || !c.remaining || busy===c.id} onClick={()=>take(c)}>{c.claimed?'已领取':c.remaining?'立即领取':'已抢光'}</button></CouponTicket>)}</div></section>;
}
const stateText:Record<string,string>={unused:'可使用',used:'已使用',expired:'已过期',pending:'未生效'};
export function MyCoupons(){
  const data=useLoad(()=>api<UserCoupon[]>('/my/coupons'));
  return <section className="panel"><div className="section-heading"><h2><TicketPercent size={21}/>我的优惠券</h2><Link className="text-button" to="/">去领券</Link></div>{data.loading?<Loading/>:data.error?<Failure error={data.error} retry={data.reload}/>:data.data?.length?<div className="coupon-list">{data.data.map(c=><CouponTicket key={c.id} coupon={c} muted={c.state!=='unused'}><span className="pill">{stateText[c.state]}</span></CouponTicket>)}</div>:<Empty title="还没有优惠券" text="在首页领券中心领取后，结算时可抵扣"/>}</section>;
}
