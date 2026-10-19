import {useEffect,useState} from 'react';
import {RefreshCw} from 'lucide-react';
import {api,date,json,money,statusText} from '../api';
import {Empty,Failure,Loading,Modal,Pager,useLoad} from '../components';
import {useStore} from '../store';
import type {Order,Page} from '../types';
import {AdminSearch,ConfirmAction,PageTitle} from './shared';

export function AdminOrders() {
  const {staffUser:user,notify}=useStore();
  const [page,setPage]=useState(1),[status,setStatus]=useState(''),[q,setQ]=useState(''),[detail,setDetail]=useState<Order>(),[editing,setEditing]=useState<Order>(),[action,setAction]=useState<'cancel'|'delete'>(),[busy,setBusy]=useState(false);
  const data=useLoad(()=>api<Page<Order>>('/admin/orders?'+new URLSearchParams({page:String(page),pageSize:'15',status,q})),[page,status,q]);
  useEffect(()=>{if(!data.loading&&data.data)setPage(value=>Math.min(value,Math.max(1,Math.ceil(data.data!.total/15))));},[data.loading,data.data?.total]);
  const show=async(order:Order)=>{try{setDetail(await api<Order>('/admin/orders/'+order.id));}catch(e:any){notify(e.message,true);}};
  const canManage=user?.capabilities.includes('orders.manage');
  const transition=async(order:Order)=>{setBusy(true);try{const next=await api<Order>('/admin/orders/'+order.id+'/status',{method:'POST',body:json({status:order.status==='paid'?'picking':'delivering'})});setDetail(next);data.reload();notify('履约状态已更新');}catch(e:any){notify(e.message,true);}finally{setBusy(false);}};
  return <>
    <PageTitle title="订单履约" text="按付款、拣货、配送、收货处理订单；管理员可维护发货前的配送信息。"/>
    <section className="panel table-panel"><div className="table-toolbar"><AdminSearch label="搜索后台订单" placeholder="搜索订单号或收货人" onSearch={value=>{setQ(value);setPage(1);}}/><select aria-label="筛选订单状态" value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="">全部订单</option>{Object.entries(statusText).filter(([s])=>!['approved','rejected'].includes(s)).map(([s,t])=><option key={s} value={s}>{t}</option>)}</select><button className="button small secondary" onClick={data.reload}><RefreshCw size={15}/>刷新</button></div>
      {data.loading?<Loading/>:data.error?<Failure error={data.error} retry={data.reload}/>:<><p className="table-summary">共 {data.data?.total || 0} 笔订单</p><div className="table-scroll"><table><thead><tr><th>订单编号</th><th>收货人</th><th>订单金额</th><th>状态</th><th>配送时段</th><th>创建时间</th><th>操作</th></tr></thead><tbody>{data.data?.items.map(order=><tr key={order.id}><td><span className="mono">{order.id}</span></td><td>{order.address.name}<small className="block">{order.address.phone}</small></td><td>{money(order.total)}</td><td><span className={'status status-'+order.status}>{statusText[order.status]}</span>{order.refund?.status==='pending'&&<small className="block stock-warning">售后处理中</small>}</td><td>{order.delivery_slot}</td><td>{date(order.created_at)}</td><td><button className="text-button" onClick={()=>show(order)}>查看详情</button></td></tr>)}</tbody></table></div>{!data.data?.items.length&&<Empty title="暂无匹配的订单"/>}<Pager page={page} total={data.data?.total || 0} size={15} onPage={setPage}/></>}
    </section>
    {detail&&!editing&&!action&&<Modal title="订单详情" wide onClose={()=>{if(!busy)setDetail(undefined);}}><div className="admin-order-meta"><p>订单编号：<span className="mono">{detail.id}</span></p><p>订单状态：<span className={'status status-'+detail.status}>{statusText[detail.status]}</span></p><p>收货信息：{detail.address.name} · {detail.address.phone}</p><p>配送地址：{detail.address.detail}</p><p>配送时段：{detail.delivery_slot}</p>{detail.note&&<p>顾客备注：{detail.note}</p>}</div>
      {detail.items.map(item=><div className="checkout-product" key={item.id}><img src={item.image} alt=""/><div><strong>{item.name}</strong><small>{item.unit}</small></div><span>×{item.quantity}</span><b>{money(item.price*item.quantity)}</b></div>)}<p className="align-right">订单合计：<strong>{money(detail.total)}</strong></p>{detail.refund&&<p className="info-box">售后：{detail.refund.status==='pending'?'待审核':statusText[detail.refund.status]} · {detail.refund.reason}</p>}
      <div className="admin-detail-actions">
        {canManage&&['pending','paid'].includes(detail.status)&&detail.refund?.status!=='pending'&&<button className="button secondary" onClick={()=>setEditing(detail)}>修改配送信息</button>}
        {canManage&&detail.status==='pending'&&<button className="button secondary danger" onClick={()=>setAction('cancel')}>取消待付款订单</button>}
        {user?.capabilities.includes('orders.delete')&&detail.status==='cancelled'&&<button className="button danger-button" onClick={()=>setAction('delete')}>删除错误订单</button>}
        {user?.capabilities.includes('fulfillment')&&['paid','picking'].includes(detail.status)&&detail.refund?.status!=='pending'&&<button className="button" disabled={busy} onClick={()=>transition(detail)}>{busy?'处理中…':detail.status==='paid'?'开始拣货':'确认发出配送'}</button>}
      </div>
    </Modal>}
    {editing&&<DeliveryEditor order={editing} onClose={()=>setEditing(undefined)} onSaved={order=>{setDetail(order);data.reload();notify('配送信息已更新');}}/>}
    {action&&detail&&<ConfirmAction title={action==='cancel'?'取消待付款订单':'删除错误订单'} confirmText={action==='cancel'?'确认取消':'确认删除'} onClose={()=>setAction(undefined)} onConfirm={async()=>{
      if(action==='cancel'){setDetail(await api<Order>('/admin/orders/'+detail.id+'/cancel',{method:'POST'}));notify('订单已取消，预扣库存已归还');}
      else {await api('/admin/orders/'+detail.id,{method:'DELETE'});setDetail(undefined);notify('错误订单已删除');}
      data.reload();
    }}><p>订单 <strong className="mono">{detail.id}</strong></p><p>{action==='cancel'?'取消后将归还预扣库存，订单无法继续付款。':'仅允许删除已取消且没有支付、退款或结算记录的订单。删除操作会记入审计日志。'}</p></ConfirmAction>}
  </>;
}
function DeliveryEditor({order,onClose,onSaved}:{order:Order;onClose:()=>void;onSaved:(order:Order)=>void}) {
  const [name,setName]=useState(order.address.name),[phone,setPhone]=useState(''),[detail,setDetail]=useState(order.address.detail),[deliverySlot,setSlot]=useState(order.delivery_slot),[note,setNote]=useState(order.note),[busy,setBusy]=useState(false),[error,setError]=useState('');
  return <Modal title="修改配送信息" wide onClose={()=>{if(!busy)onClose();}}><form className="form-stack" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{onSaved(await api<Order>('/admin/orders/'+order.id,{method:'PUT',body:json({name:name.trim(),phone,detail:detail.trim(),deliverySlot,note})}));onClose();}catch(e:any){setError(e.message);}finally{setBusy(false);}}}>
    <label>收货人<input required maxLength={40} value={name} onChange={e=>setName(e.target.value)}/></label><label>更换联系电话（留空保留原号码）<input type="tel" pattern="1[3-9][0-9]{9}" maxLength={11} value={phone} onChange={e=>setPhone(e.target.value)} placeholder={order.address.phone}/></label><label>配送地址<input required minLength={8} maxLength={200} value={detail} onChange={e=>setDetail(e.target.value)}/></label>
    <label>配送时段<select value={deliverySlot} onChange={e=>setSlot(e.target.value)}>{['尽快送达','今日 18:00–20:00','明日 09:00–12:00','明日 14:00–18:00'].map(slot=><option key={slot}>{slot}</option>)}</select></label><label>订单备注<textarea maxLength={200} value={note} onChange={e=>setNote(e.target.value)}/></label><p className="info-box">修改仅适用于此订单，会员地址簿、商品和订单金额保持不变。</p>{error&&<p className="form-error" role="alert">{error}</p>}<button className="button" disabled={busy}>{busy?'保存中…':'保存配送信息'}</button>
  </form></Modal>;
}
