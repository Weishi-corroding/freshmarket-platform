import {useState} from 'react';
import {Link,Navigate,useLocation} from 'react-router-dom';
import {ArrowLeft,ShieldCheck,ShoppingBag} from 'lucide-react';
import {useStore} from './store';
import {Loading} from './components';

export function StaffLogin(){
  const{staffUser,staffLoading,loginStaff}=useStore(),location=useLocation();
  const[username,setUsername]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const from=location.state?.from as string|undefined;
  if(staffLoading)return <Loading/>;
  if(staffUser)return <Navigate to={from&&/^\/admin(?:\/|$)/.test(from)&&from!=='/admin/login'?from:'/admin'} replace/>;
  return <main className="staff-login-page"><section className="staff-login-brand"><span className="staff-brand-icon"><ShoppingBag size={35}/></span><span className="eyebrow">FRESHMARKET CONSOLE</span><h1>鲜境员工工作台</h1><p>商品、库存、履约与服务，<br/>在这里有序协作。</p><span className="staff-login-note"><ShieldCheck size={20}/>员工专属办公空间</span></section><section className="staff-login-card"><Link className="staff-back" to="/"><ArrowLeft size={16}/>返回商城</Link><h2>员工登录</h2><p className="muted">请使用管理员分配的员工账号登录。</p><form className="form-stack" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{await loginStaff(username,password);}catch(e:any){setError(e.message);}finally{setBusy(false);}}}><label>账号<input required value={username} maxLength={60} onChange={e=>setUsername(e.target.value)} autoComplete="username" placeholder="输入员工账号"/></label><label>密码<input type="password" required value={password} maxLength={128} onChange={e=>setPassword(e.target.value)} autoComplete="current-password" placeholder="输入密码"/></label>{error&&<p className="form-error" role="alert">{error}</p>}<button className="button full" disabled={busy}>{busy?'登录中…':'登录工作台'}</button></form>{import.meta.env.VITE_DEMO!=='false'&&<div className="demo-accounts"><span>员工演示账号（点击填入）</span><div>{[['admin','管理员'],['operator','运营'],['warehouse','仓库'],['support','客服'],['finance','财务']].map(([id,label])=><button key={id} onClick={()=>{setUsername(id);setPassword(import.meta.env.VITE_DEMO_PASSWORD || 'Fresh@123456');setError('');}}>{label}</button>)}</div></div>}<p className="staff-login-footnote">会员购物请从商城登录。员工账号仅用于工作台。</p></section></main>;
}
