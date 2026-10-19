import {useEffect,useState} from 'react';
import {Plus,Pencil,Trash2,RefreshCw} from 'lucide-react';
import {api,date,json,roleText} from '../api';
import {Empty,Failure,Loading,Modal,Pager,useLoad} from '../components';
import {useStore} from '../store';
import type {Page,User} from '../types';
import {AdminSearch,capabilityText,ConfirmAction,PageTitle} from './shared';

const staffRoles=Object.entries(roleText).filter(([role])=>role!=='member');
type AccountType='staff'|'member';
export function Accounts() {
  const {staffUser,notify}=useStore();
  const [type,setType]=useState<AccountType>('staff'),[page,setPage]=useState(1),[q,setQ]=useState(''),[active,setActive]=useState(''),[role,setRole]=useState('');
  const [editing,setEditing]=useState<User|null|undefined>(),[detail,setDetail]=useState<User>(),[removing,setRemoving]=useState<User>();
  const path='/admin/'+(type==='staff'?'users':'members');
  const data=useLoad(()=>api<Page<User>>(path+'?'+new URLSearchParams({page:String(page),pageSize:'20',q,active,role})),[type,page,q,active,role]);
  useEffect(()=>{if(!data.loading&&data.data)setPage(value=>Math.min(value,Math.max(1,Math.ceil(data.data!.total/20))));},[data.loading,data.data?.total]);
  const label=type==='staff'?'员工':'会员';
  const latest=async(user:User,edit=false)=>{try{const value=await api<User>(path+'/'+user.id);if(edit)setEditing(value);else setDetail(value);}catch(e:any){notify(e.message,true);}};
  return <>
    <PageTitle title="账号管理" text="管理员可维护员工与会员资料、重置密码和停用账号；两类账号不能互相转换。"><button className="button" onClick={()=>setEditing(null)}><Plus size={16}/>新增{label}</button></PageTitle>
    <div className="account-tabs" role="tablist" aria-label="账号类型">{([['staff','员工账号'],['member','会员账号']] as const).map(([value,text])=><button key={value} role="tab" aria-selected={type===value} onClick={()=>{setType(value);setPage(1);setQ('');setActive('');setRole('');}}>{text}</button>)}</div>
    <section className="panel table-panel">
      <div className="table-toolbar">
        <AdminSearch key={type} label="搜索账号" placeholder="搜索账号或姓名" onSearch={value=>{setQ(value);setPage(1);}}/>
        {type==='staff'&&<select aria-label="筛选员工岗位" value={role} onChange={e=>{setRole(e.target.value);setPage(1);}}><option value="">全部岗位</option>{staffRoles.map(([value,text])=><option key={value} value={value}>{text}</option>)}</select>}
        <select aria-label="筛选账号状态" value={active} onChange={e=>{setActive(e.target.value);setPage(1);}}><option value="">全部状态</option><option value="1">已启用</option><option value="0">已停用</option></select>
        <button className="icon-button" aria-label="刷新账号" onClick={data.reload}><RefreshCw size={17}/></button>
      </div>
      {data.loading?<Loading/>:data.error?<Failure error={data.error} retry={data.reload}/>:<>
        <p className="table-summary">共 {data.data?.total || 0} 个{label}账号</p>
        <div className="table-scroll"><table><thead><tr><th>姓名</th><th>账号</th><th>岗位 / 身份</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead><tbody>{data.data?.items.map(user=><tr key={user.id}>
          <td><strong>{user.name}</strong>{user.id===staffUser?.id&&<small className="block muted">当前账号</small>}</td><td>{user.username}</td><td><span className="pill">{roleText[user.role]}</span></td><td><span className={'pill '+(user.active===0?'gray':'')}>{user.active===0?'已停用':'已启用'}</span></td><td>{user.created_at?date(user.created_at):'—'}</td>
          <td><div className="table-actions"><button className="text-button" onClick={()=>latest(user)}>详情</button><button className="text-button" onClick={()=>latest(user,true)}><Pencil size={14}/>编辑</button>{staffUser?.capabilities.includes('users.delete')&&<button className="text-button danger" disabled={user.id===staffUser.id} title={user.id===staffUser.id?'不能删除当前登录的管理员':undefined} onClick={()=>setRemoving(user)}><Trash2 size={14}/>删除</button>}</div></td>
        </tr>)}</tbody></table></div>{!data.data?.items.length&&<Empty title="没有匹配的账号"/>}<Pager page={page} total={data.data?.total || 0} size={20} onPage={setPage}/>
      </>}
    </section>
    {editing!==undefined&&<AccountEditor type={type} user={editing || undefined} onClose={()=>setEditing(undefined)} onSaved={()=>{data.reload();notify(editing?'账号已更新':'账号已创建');}}/>}
    {detail&&<Modal title={label+'账号详情'} onClose={()=>setDetail(undefined)}><dl className="audit-detail"><dt>姓名</dt><dd>{detail.name}</dd><dt>账号</dt><dd>{detail.username}</dd><dt>身份</dt><dd>{roleText[detail.role]}</dd><dt>状态</dt><dd>{detail.active===0?'已停用':'已启用'}</dd><dt>创建时间</dt><dd>{detail.created_at?date(detail.created_at):'—'}</dd><dt>权限范围</dt><dd>{detail.accountType==='member'?'商城购物与个人订单':detail.capabilities.map(value=>capabilityText[value] || value).join('、')}</dd></dl></Modal>}
    {removing&&<ConfirmAction title={'删除'+label+'账号'} onClose={()=>setRemoving(undefined)} onConfirm={async()=>{await api(path+'/'+removing.id,{method:'DELETE'});data.reload();notify('账号已删除');}}><p>确认删除 <strong>{removing.name}（{removing.username}）</strong>？</p><p>删除后将无法登录，旧会话失效，历史业务记录保留。有未完成订单或待审核售后的账号需先处理业务，也可先停用账号。</p></ConfirmAction>}
  </>;
}
function AccountEditor({type,user,onClose,onSaved}:{type:AccountType;user?:User;onClose:()=>void;onSaved:()=>void}) {
  const {staffUser,logoutStaff}=useStore();
  const [name,setName]=useState(user?.name || ''),[username,setUsername]=useState(user?.username || ''),[password,setPassword]=useState(''),[role,setRole]=useState(user?.role || 'operator'),[active,setActive]=useState(user?.active ?? 1),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const label=type==='staff'?'员工':'会员',self=user?.id===staffUser?.id;
  return <Modal title={(user?'编辑':'新增')+label+'账号'} onClose={()=>{if(!busy)onClose();}}><form className="form-stack" onSubmit={async e=>{
    e.preventDefault();setBusy(true);setError('');try{
      const body={name:name.trim(),username,password:password || undefined,...(type==='staff'?{role}:{}),...(user?{active}:{})};
      await api('/admin/'+(type==='staff'?'users':'members')+(user?'/'+user.id:''),{method:user?'PUT':'POST',body:json(body)});onSaved();onClose();
      if(self){if(password)logoutStaff();else window.location.reload();}
    }catch(e:any){setError(e.message);}finally{setBusy(false);}
  }}>
    <label>姓名<input required maxLength={40} value={name} onChange={e=>setName(e.target.value)} autoComplete="off"/></label>
    <label>{label}账号<input required minLength={3} maxLength={60} pattern="[a-zA-Z0-9_@.]+" value={username} onChange={e=>setUsername(e.target.value)} autoComplete="off"/><small className="muted">3–60位，支持英文字母、数字、下划线、@ 和英文句点。</small></label>
    <label>{user?'重置密码（留空保持原密码）':'初始密码'}<input type="password" required={!user} minLength={10} maxLength={128} pattern="(?=.*[A-Za-z])(?=.*[0-9]).+" value={password} onChange={e=>setPassword(e.target.value)} placeholder="至少10位，包含字母和数字" autoComplete="new-password"/></label>
    {type==='staff'&&<label>员工岗位<select value={role} disabled={self} onChange={e=>setRole(e.target.value)}>{staffRoles.map(([value,text])=><option key={value} value={value}>{text}</option>)}</select></label>}
    {user&&<label>账号状态<select value={active} disabled={self} onChange={e=>setActive(Number(e.target.value))}><option value={1}>已启用</option><option value={0}>已停用</option></select></label>}
    {user&&<p className="info-box">停用或重置密码后，旧登录会话立即失效。当前管理员的岗位和启用状态需由另一位管理员调整。</p>}
    {error&&<p className="form-error" role="alert">{error}</p>}<button className="button full" disabled={busy}>{busy?'保存中…':user?'保存账号':'创建'+label+'账号'}</button>
  </form></Modal>;
}
