import {createContext,useContext,useEffect,useState,type ReactNode} from 'react';
import {api,json} from './api';
import type {Cart,User} from './types';
import {Modal} from './components';
import {CheckCircle2,AlertCircle,Leaf} from 'lucide-react';
const emptyCart:Cart={items:[],subtotal:0,total:0,deliveryFee:0,count:0};
interface Store {user:User|null;cart:Cart;refreshCart:()=>Promise<void>;add:(id:string,n?:number)=>Promise<void>;setQuantity:(id:string,n:number)=>Promise<void>;login:()=>void;logout:()=>void;notify:(message:string,error?:boolean)=>void;}
const Context=createContext<Store>(null!);
export const useStore=()=>useContext(Context);
export function StoreProvider({children}:{children:ReactNode}){
  const[user,setUser]=useState<User|null>(null),[cart,setCart]=useState<Cart>(emptyCart),[authOpen,setAuthOpen]=useState(false),[toast,setToast]=useState<{message:string;error:boolean}|null>(null),[pending,setPending]=useState<string>();
  const notify=(message:string,error=false)=>setToast({message,error});
  useEffect(()=>{if(toast){const t=setTimeout(()=>setToast(null),4500);return()=>clearTimeout(t);}},[toast]);
  useEffect(()=>{if(sessionStorage.getItem('fresh-token'))api<User>('/auth/me').then(setUser).catch(()=>{sessionStorage.removeItem('fresh-token');setUser(null);});},[]);
  const refreshCart=async()=>{if(sessionStorage.getItem('fresh-token'))setCart(await api<Cart>('/cart'));};
  useEffect(()=>{if(user)refreshCart().catch(e=>notify(e.message,true));else setCart(emptyCart);},[user?.id]);
  const add=async(id:string,n=1)=>{if(!user){setPending(id);setAuthOpen(true);return;}try{setCart(await api<Cart>('/cart',{method:'POST',body:json({productId:id,quantity:n})}));notify('已加入购物车');}catch(e:any){notify(e.message,true);}};
  const setQuantity=async(id:string,n:number)=>{try{setCart(await api<Cart>('/cart/'+id,{method:'PUT',body:json({quantity:n})}));}catch(e:any){notify(e.message,true);}};
  const complete=async(value:{user:User;token:string})=>{sessionStorage.setItem('fresh-token',value.token);setUser(value.user);setAuthOpen(false);notify('欢迎回来，'+value.user.name);if(pending){try{setCart(await api<Cart>('/cart',{method:'POST',body:json({productId:pending,quantity:1})}));}catch(e:any){notify(e.message,true);}setPending(undefined);}};
  const logout=()=>{sessionStorage.removeItem('fresh-token');setUser(null);setCart(emptyCart);notify('已退出登录');};
  return <Context.Provider value={{user,cart,refreshCart,add,setQuantity,notify,login:()=>setAuthOpen(true),logout}}>{children}{authOpen&&<AuthModal onClose={()=>{setAuthOpen(false);setPending(undefined);}} onComplete={complete}/ >}{toast&&<div className={'toast '+(toast.error?'toast-error':'')} role={toast.error?'alert':'status'}>{toast.error?<AlertCircle size={20}/>:<CheckCircle2 size={20}/>}<span>{toast.message}</span></div>}</Context.Provider>;
}
function AuthModal({onClose,onComplete}:{onClose:()=>void;onComplete:(v:{user:User;token:string})=>Promise<void>}){
  const[register,setRegister]=useState(false),[username,setUsername]=useState(''),[password,setPassword]=useState(''),[name,setName]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  return <Modal title={register?'加入鲜境':'欢迎来到鲜境'} onClose={onClose}><div className="auth-intro"><span className="auth-icon"><Leaf size={26}/></span><p>好食材，让每一天更有滋味。</p></div><form className="form-stack" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{await onComplete(await api('/auth/'+(register?'register':'login'),{method:'POST',body:json({username,password,...(register?{name}:{})})}));}catch(e:any){setError(e.message);}finally{setBusy(false);}}}>
    {register&&<label>昵称<input required maxLength={40} value={name} onChange={e=>setName(e.target.value)} placeholder="怎么称呼您" autoComplete="nickname"/></label>}
    <label>账号<input required value={username} onChange={e=>setUsername(e.target.value)} placeholder="输入账号" autoComplete="username" maxLength={60}/></label>
    <label>密码<input type="password" required minLength={register?10:1} maxLength={128} value={password} onChange={e=>setPassword(e.target.value)} placeholder={register?'至少10位，包含字母和数字':'输入密码'} autoComplete={register?'new-password':'current-password'}/></label>
    {error&&<p className="form-error" role="alert">{error}</p>}<button className="button full" disabled={busy}>{busy?'请稍候…':register?'注册并登录':'登录'}</button></form>
    <p className="auth-switch">{register?'已有账号？':'还没有账号？'}<button className="text-button" onClick={()=>{setRegister(!register);setError('');}}>{register?'去登录':'立即注册'}</button></p>
    {!register&&import.meta.env.VITE_DEMO!=='false'&&<div className="demo-accounts"><span>实验演示账号（点击填入）</span><div>{[['member','会员'],['admin','管理员'],['operator','运营'],['warehouse','仓库'],['support','客服'],['finance','财务']].map(([id,label])=><button key={id} onClick={()=>{setUsername(id);setPassword(import.meta.env.VITE_DEMO_PASSWORD || 'Fresh@123456');}}>{label}</button>)}</div><small>选择角色自动填入账号，仅用于实验演示</small></div>}
  </Modal>;
}
