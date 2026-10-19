import {createContext,useContext,useEffect,useState,type ReactNode} from 'react';
import {Link} from 'react-router-dom';
import {api,json,memberTokenKey,staffTokenKey} from './api';
import type {Address,Cart,Delivery,User} from './types';
import {Modal} from './components';
import {CheckCircle2,AlertCircle,Leaf} from 'lucide-react';
const emptyCart:Cart={items:[],subtotal:0,total:0,deliveryFee:0,count:0};
// 顶部地址选择器的默认值，未登录或没有收货地址时使用
const defaultDelivery:Delivery={id:'preset-shanghai-zhangjiang',label:'上海 · 张江',detail:'上海市浦东新区 张江路88号'};
const readDelivery=():Delivery=>{try{const raw=localStorage.getItem('fresh-delivery');if(raw)return JSON.parse(raw) as Delivery;}catch{}return defaultDelivery;};
interface Store {user:User|null;staffUser:User|null;memberLoading:boolean;staffLoading:boolean;cart:Cart;addresses:Address[];delivery:Delivery;refreshCart:()=>Promise<void>;refreshAddresses:()=>Promise<void>;setDelivery:(value:Delivery)=>void;add:(id:string,n?:number)=>Promise<void>;setQuantity:(id:string,n:number)=>Promise<void>;login:()=>void;logout:()=>void;loginStaff:(username:string,password:string)=>Promise<void>;logoutStaff:()=>void;notify:(message:string,error?:boolean)=>void;}
const Context=createContext<Store>(null!);
export const useStore=()=>useContext(Context);
export function StoreProvider({children}:{children:ReactNode}){
  const[user,setUser]=useState<User|null>(null),[staffUser,setStaffUser]=useState<User|null>(null),[memberLoading,setMemberLoading]=useState(true),[staffLoading,setStaffLoading]=useState(true),[cart,setCart]=useState<Cart>(emptyCart),[addresses,setAddresses]=useState<Address[]>([]),[delivery,setDeliveryState]=useState<Delivery>(readDelivery),[authOpen,setAuthOpen]=useState(false),[toast,setToast]=useState<{message:string;error:boolean}|null>(null),[pending,setPending]=useState<{id:string;quantity:number}>();
  const notify=(message:string,error=false)=>setToast({message,error});
  useEffect(()=>{
    const expired=(event:Event)=>{
      const {key,token,message}=(event as CustomEvent<{key:string;token:string;message:string}>).detail;
      if(sessionStorage.getItem(key)!==token)return;
      sessionStorage.removeItem(key);
      if(key===staffTokenKey)setStaffUser(null);
      else {setUser(null);setCart(emptyCart);setAddresses([]);}
      notify(message || '登录已失效，请重新登录',true);
    };
    window.addEventListener('fresh-session-expired',expired);return()=>window.removeEventListener('fresh-session-expired',expired);
  },[]);
  useEffect(()=>{if(toast){const t=setTimeout(()=>setToast(null),4500);return()=>clearTimeout(t);}},[toast]);
  useEffect(()=>{
    let active=true;
    // Shared sessions from older versions must be replaced by a login at the correct portal.
    sessionStorage.removeItem('fresh-token');
    const restore=async(path:string,key:string,type:User['accountType'],set:(value:User|null)=>void,loaded:()=>void)=>{
      const token=sessionStorage.getItem(key);
      try{if(token){const value=await api<User>(path);if(value.accountType!==type)throw new Error('账号类型不匹配');if(active&&sessionStorage.getItem(key)===token)set(value);}}
      catch{if(active&&sessionStorage.getItem(key)===token){sessionStorage.removeItem(key);set(null);}}
      finally{if(active)loaded();}
    };
    void restore('/auth/me',memberTokenKey,'member',setUser,()=>setMemberLoading(false));
    void restore('/admin/auth/me',staffTokenKey,'staff',setStaffUser,()=>setStaffLoading(false));
    return()=>{active=false;};
  },[]);
  const refreshCart=async()=>{const token=sessionStorage.getItem(memberTokenKey);if(token){const value=await api<Cart>('/cart');if(sessionStorage.getItem(memberTokenKey)===token)setCart(value);}};
  const refreshAddresses=async()=>{const token=sessionStorage.getItem(memberTokenKey);if(token){const value=await api<Address[]>('/addresses');if(sessionStorage.getItem(memberTokenKey)===token)setAddresses(value);}};
  const setDelivery=(value:Delivery)=>{setDeliveryState(value);try{localStorage.setItem('fresh-delivery',JSON.stringify(value));}catch{}};
  useEffect(()=>{if(user?.role==='member')refreshCart().catch(e=>notify(e.message,true));else setCart(emptyCart);},[user?.id]);
  useEffect(()=>{if(user?.role==='member')refreshAddresses().catch(()=>{});else setAddresses([]);},[user?.id]);
  const add=async(id:string,n=1)=>{if(user?.role!=='member'){setPending({id,quantity:n});setAuthOpen(true);return;}try{setCart(await api<Cart>('/cart',{method:'POST',body:json({productId:id,quantity:n})}));notify('已加入购物车');}catch(e:any){notify(e.message,true);}};
  const setQuantity=async(id:string,n:number)=>{if(user?.role!=='member'){setAuthOpen(true);return;}try{setCart(await api<Cart>('/cart/'+id,{method:'PUT',body:json({quantity:n})}));}catch(e:any){notify(e.message,true);}};
  const complete=async(value:{user:User;token:string})=>{if(value.user.accountType!=='member'||value.user.role!=='member')throw new Error('请使用会员账号登录商城');sessionStorage.setItem(memberTokenKey,value.token);setUser(value.user);setAuthOpen(false);notify('欢迎回来，'+value.user.name);if(pending){try{setCart(await api<Cart>('/cart',{method:'POST',body:json({productId:pending.id,quantity:pending.quantity})}));}catch(e:any){notify(e.message,true);}setPending(undefined);}};
  const logout=()=>{sessionStorage.removeItem(memberTokenKey);setUser(null);setCart(emptyCart);setAddresses([]);setAuthOpen(false);setPending(undefined);notify('已退出会员登录');};
  const loginStaff=async(username:string,password:string)=>{const value=await api<{user:User;token:string}>('/admin/auth/login',{method:'POST',body:json({username,password})});if(value.user.accountType!=='staff'||value.user.role==='member')throw new Error('请使用员工账号登录工作台');sessionStorage.setItem(staffTokenKey,value.token);setStaffUser(value.user);notify('欢迎回来，'+value.user.name);};
  const logoutStaff=()=>{sessionStorage.removeItem(staffTokenKey);setStaffUser(null);notify('已退出员工登录');};
  return <Context.Provider value={{user,staffUser,memberLoading,staffLoading,cart,addresses,delivery,refreshCart,refreshAddresses,setDelivery,add,setQuantity,notify,login:()=>setAuthOpen(true),logout,loginStaff,logoutStaff}}>{children}{authOpen&&<AuthModal onClose={()=>{setAuthOpen(false);setPending(undefined);}} onComplete={complete}/ >}{toast&&<div className={'toast '+(toast.error?'toast-error':'')} role={toast.error?'alert':'status'}>{toast.error?<AlertCircle size={20}/>:<CheckCircle2 size={20}/>}<span>{toast.message}</span></div>}</Context.Provider>;
}
function AuthModal({onClose,onComplete}:{onClose:()=>void;onComplete:(v:{user:User;token:string})=>Promise<void>}){
  const[register,setRegister]=useState(false),[username,setUsername]=useState(''),[password,setPassword]=useState(''),[name,setName]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  return <Modal title={register?'加入鲜境':'欢迎来到鲜境'} onClose={onClose}><div className="auth-intro"><span className="auth-icon"><Leaf size={26}/></span><p>好食材，让每一天更有滋味。</p></div><form className="form-stack" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{await onComplete(await api('/auth/'+(register?'register':'login'),{method:'POST',body:json({username,password,...(register?{name}:{})})}));}catch(e:any){setError(e.message);}finally{setBusy(false);}}}>
    {register&&<label>昵称<input required maxLength={40} value={name} onChange={e=>setName(e.target.value)} placeholder="怎么称呼您" autoComplete="nickname"/></label>}
    <label>账号<input required value={username} onChange={e=>setUsername(e.target.value)} placeholder="输入账号" autoComplete="username" maxLength={60}/></label>
    <label>密码<input type="password" required minLength={register?10:1} maxLength={128} value={password} onChange={e=>setPassword(e.target.value)} placeholder={register?'至少10位，包含字母和数字':'输入密码'} autoComplete={register?'new-password':'current-password'}/></label>
    {error&&<p className="form-error" role="alert">{error}</p>}<button className="button full" disabled={busy}>{busy?'请稍候…':register?'注册并登录':'登录'}</button></form>
    <p className="auth-switch">{register?'已有账号？':'还没有账号？'}<button className="text-button" onClick={()=>{setRegister(!register);setError('');}}>{register?'去登录':'立即注册'}</button></p>
    {!register&&import.meta.env.VITE_DEMO!=='false'&&<div className="demo-accounts"><span>实验演示账号（点击填入）</span><div><button onClick={()=>{setUsername('member');setPassword(import.meta.env.VITE_DEMO_PASSWORD || 'Fresh@123456');}}>会员</button></div><small>仅用于实验演示</small></div>}
    <p className="auth-switch">员工办公请前往 <Link className="text-button" to="/admin/login" onClick={onClose}>员工登录</Link></p>
  </Modal>;
}
