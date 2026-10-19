import {useState,type ReactNode} from 'react';
import {Search} from 'lucide-react';
import {Modal} from '../components';

export function PageTitle({title,text,children}:{title:string;text?:string;children?:ReactNode}) {
  return <div className="page-heading"><div><h1>{title}</h1>{text&&<p className="muted">{text}</p>}</div>{children}</div>;
}
export function AdminSearch({label,placeholder,onSearch}:{label:string;placeholder:string;onSearch:(q:string)=>void}) {
  const [value,setValue]=useState('');
  return <form className="admin-search" onSubmit={e=>{e.preventDefault();onSearch(value.trim());}}><Search size={17}/><input aria-label={label} maxLength={80} value={value} onChange={e=>{setValue(e.target.value);if(!e.target.value)onSearch('');}} placeholder={placeholder}/><button className="text-button">搜索</button></form>;
}
export function ConfirmAction({title,children,confirmText='确认删除',danger=true,onConfirm,onClose}:{title:string;children:ReactNode;confirmText?:string;danger?:boolean;onConfirm:()=>Promise<void>;onClose:()=>void}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  return <Modal title={title} onClose={()=>{if(!busy)onClose();}}><div className="confirm-copy">{children}</div>{error&&<p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button className="button secondary" disabled={busy} onClick={onClose}>返回</button><button className={'button '+(danger?'danger-button':'')} disabled={busy} onClick={async()=>{setBusy(true);setError('');try{await onConfirm();onClose();}catch(e:any){setError(e.message);}finally{setBusy(false);}}}>{busy?'处理中…':confirmText}</button></div></Modal>;
}
export const capabilityText:Record<string,string>={dashboard:'经营概览','catalog.read':'查看商品',products:'维护商品','products.delete':'删除商品',stock:'调整库存',orders:'查看订单','orders.manage':'维护订单','orders.delete':'删除错误订单',fulfillment:'订单履约',refunds:'售后审核',settlements:'财务结算',users:'管理账号','users.delete':'删除账号',audit:'审计日志'};
