export class ApiError extends Error {constructor(message:string,public code:string,public traceId:string){super(message);}}
export async function api<T>(path:string,options:RequestInit={}):Promise<T> {
  const token=sessionStorage.getItem('fresh-token');
  const response=await fetch('/api'+path,{...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`} : {}),...options.headers}});
  const data=await response.json();
  if(!response.ok || data.code!==0)throw new ApiError(data.message || '请求失败，请稍后重试',data.code || 'NETWORK_ERROR',data.traceId || '');
  return data.data as T;
}
export const json=(value:unknown)=>JSON.stringify(value);
export const money=(fen:number)=>'¥'+(Number(fen || 0)/100).toFixed(2);
export const date=(value:number)=>new Date(Number(value)).toLocaleString('zh-CN',{hour12:false});
export const statusText:Record<string,string>={pending:'待付款',paid:'待拣货',picking:'拣货中',delivering:'配送中',completed:'已完成',cancelled:'已取消',refunded:'已退款',approved:'已通过',rejected:'已拒绝'};
export const roleText:Record<string,string>={member:'会员',operator:'运营',warehouse:'仓库',support:'客服',finance:'财务',admin:'管理员'};
