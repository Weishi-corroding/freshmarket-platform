import {useState} from 'react';
import {RefreshCw,Wallet} from 'lucide-react';
import {api,date,json,money,statusText} from '../api';
import {Empty,Failure,Loading,Modal,Pager,useLoad} from '../components';
import {useStore} from '../store';
import type {Order,Page} from '../types';
import {AdminSearch,ConfirmAction,PageTitle} from './shared';

interface Refund {id:string;order_id:string;amount:number;reason:string;status:string;decision_note:string;created_at:number;order?:Order;}
export function Refunds() {
  const {notify}=useStore();
  const [page,setPage]=useState(1),[status,setStatus]=useState(''),[q,setQ]=useState(''),[detail,setDetail]=useState<Refund>(),[decision,setDecision]=useState<{refund:Refund;approve:boolean}>(),[note,setNote]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const data=useLoad(()=>api<Page<Refund>>('/admin/refunds?'+new URLSearchParams({page:String(page),pageSize:'15',status,q})),[page,status,q]);
  const decide=(refund:Refund,approve:boolean)=>{setDetail(undefined);setDecision({refund,approve});setNote(approve?'核实后同意退款':'');setError('');};
  return <>
    <PageTitle title="售后服务" text="查看整单或部分退款申请并记录审核结果，已处理记录保留供追溯。"/>
    <section className="panel table-panel"><div className="table-toolbar"><AdminSearch label="搜索售后申请" placeholder="搜索订单号或售后原因" onSearch={value=>{setQ(value);setPage(1);}}/><select aria-label="筛选退款状态" value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="">全部申请</option><option value="pending">待审核</option><option value="approved">已通过</option><option value="rejected">已拒绝</option></select><button className="button small secondary" onClick={data.reload}><RefreshCw size={15}/>刷新</button></div>
      {data.loading?<Loading/>:data.error?<Failure error={data.error} retry={data.reload}/>:<><p className="table-summary">共 {data.data?.total || 0} 条售后申请</p><div className="table-scroll"><table><thead><tr><th>订单</th><th>退款金额</th><th>顾客说明</th><th>状态</th><th>申请时间</th><th>操作</th></tr></thead><tbody>{data.data?.items.map(refund=><tr key={refund.id}><td className="mono">{refund.order_id}</td><td>{money(refund.amount)}</td><td className="wrap-cell">{refund.reason}{refund.decision_note&&<small className="block">审核：{refund.decision_note}</small>}</td><td><span className="pill">{refund.status==='pending'?'待审核':statusText[refund.status]}</span></td><td>{date(refund.created_at)}</td><td><div className="table-actions"><button className="text-button" onClick={async()=>{try{setDetail(await api<Refund>('/admin/refunds/'+refund.id));}catch(e:any){notify(e.message,true);}}}>详情</button>{refund.status==='pending'&&<><button className="text-button" onClick={()=>decide(refund,true)}>同意退款</button><button className="text-button danger" onClick={()=>decide(refund,false)}>拒绝</button></>}</div></td></tr>)}</tbody></table></div>{!data.data?.items.length&&<Empty title="暂无匹配的售后申请"/>}<Pager page={page} total={data.data?.total || 0} size={15} onPage={setPage}/></>}
    </section>
    {detail&&<Modal title="售后申请详情" wide onClose={()=>setDetail(undefined)}><dl className="audit-detail"><dt>订单</dt><dd className="mono">{detail.order_id}</dd><dt>申请金额</dt><dd>{money(detail.amount)}</dd><dt>申请原因</dt><dd>{detail.reason}</dd><dt>处理状态</dt><dd>{detail.status==='pending'?'待审核':statusText[detail.status]}</dd>{detail.decision_note&&<><dt>审核说明</dt><dd>{detail.decision_note}</dd></>}</dl><h3>订单商品</h3>{detail.order?.items.map(item=>{
      const refundItems=detail.order?.refund?.items || [],requested=refundItems.find(value=>value.product_id===item.product_id);
      return <div className="checkout-product" key={item.id}><img src={item.image} alt=""/><div><strong>{item.name}</strong><small>{refundItems.length?(requested?'申请退回 '+requested.quantity+' 件':'未申请退回'):'购买数量 '+item.quantity}</small></div><b>{money(item.price*item.quantity)}</b></div>;
    })}{detail.status==='pending'&&<div className="modal-actions"><button className="button secondary" onClick={()=>decide(detail,false)}>拒绝申请</button><button className="button" onClick={()=>decide(detail,true)}>同意退款</button></div>}</Modal>}
    {decision&&<Modal title={decision.approve?'同意退款':'拒绝售后申请'} onClose={()=>{if(!busy)setDecision(undefined);}}><form className="form-stack" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{await api('/admin/refunds/'+decision.refund.id+'/decision',{method:'POST',body:json({approve:decision.approve,note:note.trim()})});data.reload();setDecision(undefined);notify('审核结果已记录');}catch(e:any){setError(e.message);}finally{setBusy(false);}}}><p>订单 {decision.refund.order_id}</p><p>金额 <strong>{money(decision.refund.amount)}</strong></p><label>审核说明<textarea required maxLength={200} value={note} onChange={e=>setNote(e.target.value)} placeholder="填写核实结果与处理理由"/></label>{error&&<p className="form-error" role="alert">{error}</p>}<button className="button" disabled={busy || !note.trim()}>{busy?'处理中…':decision.approve?'确认退款':'确认拒绝'}</button></form></Modal>}
  </>;
}
interface Settlement {id:string;order_id:string;operator_id:string;amount:number;created_at:number;}
export function Settlements() {
  const {notify}=useStore();
  const [page,setPage]=useState(1),[q,setQ]=useState(''),[confirm,setConfirm]=useState(false),[detail,setDetail]=useState<Settlement>();
  const data=useLoad(()=>api<Page<Settlement>&{amount:number}>('/admin/settlements?'+new URLSearchParams({page:String(page),pageSize:'15',q})),[page,q]);
  return <>
    <PageTitle title="财务结算" text="结算已收货且没有待审核售后的订单。结算记录保留，不支持手工改金额或删除。"><button className="button" onClick={()=>setConfirm(true)}><Wallet size={17}/>结算已完成订单</button></PageTitle>
    <div className="settlement-banner"><span>{q?'当前查询结算金额':'累计已结算金额'}</span><strong>{money(data.data?.amount || 0)}</strong><small>{data.data?.total || 0} 笔订单结算 · 沙箱账务</small></div>
    <section className="panel table-panel"><div className="table-toolbar"><AdminSearch label="搜索结算记录" placeholder="搜索结算单号、订单号或操作人ID" onSearch={value=>{setQ(value);setPage(1);}}/><button className="button small secondary" onClick={data.reload}><RefreshCw size={15}/>刷新</button></div>
      {data.loading?<Loading/>:data.error?<Failure error={data.error} retry={data.reload}/>:<><div className="table-scroll"><table><thead><tr><th>结算单号</th><th>订单编号</th><th>结算金额</th><th>处理时间</th><th>操作</th></tr></thead><tbody>{data.data?.items.map(item=><tr key={item.id}><td className="mono">{item.id.slice(0,18)}</td><td className="mono">{item.order_id}</td><td>{money(item.amount)}</td><td>{date(item.created_at)}</td><td><button className="text-button" onClick={()=>setDetail(item)}>详情</button></td></tr>)}</tbody></table></div>{!data.data?.items.length&&<Empty title="没有匹配的结算记录"/>}<Pager page={page} total={data.data?.total || 0} size={15} onPage={setPage}/></>}
    </section>
    {detail&&<Modal title="结算记录详情" onClose={()=>setDetail(undefined)}><dl className="audit-detail"><dt>结算单号</dt><dd className="mono">{detail.id}</dd><dt>订单编号</dt><dd className="mono">{detail.order_id}</dd><dt>结算金额</dt><dd>{money(detail.amount)}</dd><dt>操作人ID</dt><dd>{detail.operator_id}</dd><dt>处理时间</dt><dd>{date(detail.created_at)}</dd></dl></Modal>}
    {confirm&&<ConfirmAction title="生成财务结算" confirmText="确认结算" danger={false} onClose={()=>setConfirm(false)} onConfirm={async()=>{const value=await api<{count:number;amount:number}>('/admin/settlements',{method:'POST'});data.reload();notify(`已结算${value.count}笔订单，合计${money(value.amount)}`);}}><p>系统将结算当前所有符合条件的订单。已结算订单和售后处理中订单会自动跳过。</p><p className="muted">列表搜索条件不影响本次结算范围。</p></ConfirmAction>}
  </>;
}
interface AuditRecord {id:string;action:string;actor_id:string;entity_id:string;trace_id:string;detail:string;created_at:number;}
export function Audit() {
  const [page,setPage]=useState(1),[q,setQ]=useState(''),[selected,setSelected]=useState<AuditRecord>();
  const data=useLoad(()=>api<Page<AuditRecord>>('/admin/audit?'+new URLSearchParams({page:String(page),pageSize:'20',q})),[page,q]);
  return <>
    <PageTitle title="审计日志" text="追溯账号、商品、库存和订单操作，审计记录仅支持查询。"><button className="button secondary" onClick={data.reload}><RefreshCw size={16}/>刷新</button></PageTitle>
    <section className="panel table-panel"><div className="table-toolbar"><AdminSearch label="搜索审计日志" placeholder="搜索事件、操作人、业务对象或Trace ID" onSearch={value=>{setQ(value);setPage(1);}}/></div>
      {data.loading?<Loading/>:data.error?<Failure error={data.error} retry={data.reload}/>:<><p className="table-summary">共 {data.data?.total || 0} 条记录</p><div className="table-scroll"><table><thead><tr><th>发生时间</th><th>操作人</th><th>操作事件</th><th>业务对象</th><th>请求追踪</th><th>详情</th></tr></thead><tbody>{data.data?.items.map(item=><tr key={item.id}><td>{date(item.created_at)}</td><td>{item.actor_id}</td><td><span className="pill gray">{item.action}</span></td><td className="mono">{item.entity_id}</td><td className="mono">{item.trace_id.slice(0,13)}…</td><td><button className="text-button" onClick={()=>setSelected(item)}>查看</button></td></tr>)}</tbody></table></div>{!data.data?.items.length&&<Empty title="没有匹配的审计记录"/>}<Pager page={page} total={data.data?.total || 0} size={20} onPage={setPage}/></>}
    </section>{selected&&<Modal title="审计记录详情" wide onClose={()=>setSelected(undefined)}><dl className="audit-detail"><dt>事件</dt><dd>{selected.action}</dd><dt>操作人</dt><dd>{selected.actor_id}</dd><dt>业务对象</dt><dd>{selected.entity_id}</dd><dt>Trace ID</dt><dd className="mono">{selected.trace_id}</dd></dl><pre className="json-box">{JSON.stringify(JSON.parse(selected.detail),null,2)}</pre></Modal>}
  </>;
}
