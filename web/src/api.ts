export class ApiError extends Error {constructor(message:string,public code:string,public traceId:string){super(message);}}
export const memberTokenKey='fresh-member-token',staffTokenKey='fresh-staff-token';
// 每次请求生成 W3C traceparent，浏览器请求与后端 span、审计日志共用同一 traceId
const hex=(bytes:number)=>Array.from(crypto.getRandomValues(new Uint8Array(bytes)),b=>b.toString(16).padStart(2,'0')).join('');
export async function api<T>(path:string,options:RequestInit={}):Promise<T> {
  const token=sessionStorage.getItem(path.startsWith('/admin/')?staffTokenKey:memberTokenKey);
  const response=await fetch('/api'+path,{...options,headers:{traceparent:`00-${hex(16)}-${hex(8)}-01`,...(options.body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`} : {}),...options.headers}});
  const data=await response.json();
  if(!response.ok || data.code!==0){
    if(response.status===401 && token && !path.endsWith('/login'))window.dispatchEvent(new CustomEvent('fresh-session-expired',{detail:{key:path.startsWith('/admin/')?staffTokenKey:memberTokenKey,token,message:data.message}}));
    throw new ApiError(data.message || '请求失败，请稍后重试',data.code || 'NETWORK_ERROR',data.traceId || '');
  }
  return data.data as T;
}
export const json=(value:unknown)=>JSON.stringify(value);
export const money=(fen:number)=>'¥'+(Number(fen || 0)/100).toFixed(2);
export const date=(value:number)=>new Date(Number(value)).toLocaleString('zh-CN',{hour12:false});
export const statusText:Record<string,string>={pending:'待付款',paid:'待拣货',picking:'拣货中',delivering:'配送中',completed:'已完成',cancelled:'已取消',refunded:'已退款',approved:'已通过',rejected:'已拒绝'};
export const roleText:Record<string,string>={member:'会员',operator:'运营',warehouse:'仓库',support:'客服',finance:'财务',admin:'管理员'};
// 优惠券规则文案：满99减15 / 满50享9折 最高减20 / 无门槛减5
export const couponRule=(c:{kind:string;threshold:number;value:number;max_discount:number})=>c.kind==='amount'?(c.threshold?`满${Number(c.threshold)/100}减${Number(c.value)/100}`:`无门槛减${Number(c.value)/100}`):`${c.threshold?`满${Number(c.threshold)/100}享`:''}${Number(c.value)/10}折${c.max_discount?` 最高减${Number(c.max_discount)/100}`:''}`;
export const couponScope=(c:{category_name?:string|null})=>c.category_name?c.category_name+'可用':'全场通用';
export const day=(value:number)=>new Date(Number(value)).toLocaleDateString('zh-CN');
