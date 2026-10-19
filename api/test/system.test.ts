import {test,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {randomUUID} from 'node:crypto';
import {buildApp} from '../src/app.js';
import {createDatabase,type Database} from '../src/core/database.js';
import {hashPassword,verifyPassword} from '../src/core/security.js';
import {productData,seed} from '../src/modules/catalog/seed.js';

let app:Awaited<ReturnType<typeof buildApp>>['app'];
let ctx:Awaited<ReturnType<typeof buildApp>>['ctx'];
let db:Database;
let cleanup:(()=>Promise<void>)|undefined;
const headers=(role='member')=>({authorization:'Bearer '+app.jwt.sign({sub:'u-'+role,accountType:role==='member'?'member':'staff'})});
const request=async(method:any,url:string,payload?:any,role='member',extra:any={})=>{
  const response=await app.inject({method,url,payload,headers:{...headers(role),...extra}});
  return {status:response.statusCode,body:response.json()};
};
const cart=(id='p01',quantity=1,role='member')=>request('POST','/api/cart',{productId:id,quantity},role);
const checkout=(key=randomUUID(),role='member',body:any={addressId:'a-demo',deliverySlot:'尽快送达'})=>request('POST','/api/orders',body,role,{'idempotency-key':key});
async function paid(){await cart();const o=(await checkout()).body.data;assert.equal((await request('POST','/api/orders/'+o.id+'/pay')).status,200);return o;}
async function completed(){const o=await paid();await request('POST','/api/admin/orders/'+o.id+'/status',{status:'picking'},'warehouse');await request('POST','/api/admin/orders/'+o.id+'/status',{status:'delivering'},'warehouse');await request('POST','/api/orders/'+o.id+'/receive');return o;}
beforeEach(async()=>{
  if(process.env.TEST_DATABASE_URL){
    const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL}),schema='test_'+randomUUID().replaceAll('-','');
    await pool.query('CREATE SCHEMA '+schema);const url=new URL(process.env.TEST_DATABASE_URL);url.searchParams.set('options','-c search_path='+schema);
    db=await createDatabase(url.toString());cleanup=async()=>{await pool.query('DROP SCHEMA '+schema+' CASCADE');await pool.end();};
  }else db=await createDatabase(undefined,':memory:');
  ({app,ctx}=await buildApp({db,logger:false,workers:false}));
});
afterEach(async()=>{await app.close();await db.close();if(cleanup){await cleanup();cleanup=undefined;}});

test('password hashes are salted and verified using scrypt',()=>{const a=hashPassword('Secure12345'),b=hashPassword('Secure12345');assert.notEqual(a,b);assert.equal(verifyPassword('Secure12345',a),true);assert.equal(verifyPassword('bad',a),false);assert.ok(!a.includes('Secure12345'));});
test('login, JWT identity and invalid credentials',async()=>{const good=await app.inject({method:'POST',url:'/api/auth/login',payload:{username:'member',password:'Fresh@123456'}});assert.equal(good.statusCode,200);assert.ok(good.json().data.token);const bad=await app.inject({method:'POST',url:'/api/auth/login',payload:{username:'missing',password:'bad'}});assert.equal(bad.statusCode,401);assert.equal(bad.json().code,'INVALID_CREDENTIALS');assert.equal((await request('GET','/api/auth/me')).body.data.role,'member');});
test('registration rejects role injection and creates members only',async()=>{const injected=await app.inject({method:'POST',url:'/api/auth/register',payload:{username:'new_user',name:'新会员',password:'Secure12345',role:'admin'}});assert.equal(injected.statusCode,400);const registered=await app.inject({method:'POST',url:'/api/auth/register',payload:{username:'new_user',name:'新会员',password:'Secure12345'}});assert.equal(registered.statusCode,200);assert.equal(registered.json().data.user.role,'member');assert.equal((await app.inject({method:'POST',url:'/api/auth/register',payload:{username:'new_user',name:'新会员',password:'Secure12345'}})).statusCode,409);});
test('RBAC rejects anonymous, members and staff outside their role',async()=>{assert.equal((await app.inject({url:'/api/admin/dashboard'})).statusCode,401);assert.equal((await request('GET','/api/admin/dashboard',undefined,'member')).status,403);assert.equal((await request('GET','/api/admin/refunds',undefined,'warehouse')).status,403);assert.equal((await request('POST','/api/admin/products/p01/stock',{delta:5,reason:'入库'},'operator')).status,403);assert.equal((await request('GET','/api/admin/audit',undefined,'finance')).status,403);});

test('member and staff logins issue separate identities and reject the opposite portal',async()=>{
  for(const username of ['operator','warehouse','support','finance','admin']) {
    const payload={username,password:'Fresh@123456'};
    const wrong=await app.inject({method:'POST',url:'/api/auth/login',payload});
    assert.equal(wrong.statusCode,403);assert.equal(wrong.json().code,'ACCOUNT_TYPE_MISMATCH');assert.equal(wrong.json().data,null);
    const login=await app.inject({method:'POST',url:'/api/admin/auth/login',payload});
    assert.equal(login.statusCode,200);assert.equal(login.json().data.user.accountType,'staff');
    assert.equal(app.jwt.verify<{accountType:string}>(login.json().data.token).accountType,'staff');
    const auth={authorization:'Bearer '+login.json().data.token};
    assert.equal((await app.inject({url:'/api/admin/auth/me',headers:auth})).statusCode,200);
    assert.equal((await app.inject({url:'/api/auth/me',headers:auth})).statusCode,403);
  }
  const wrong=await app.inject({method:'POST',url:'/api/admin/auth/login',payload:{username:'member',password:'Fresh@123456'}});
  assert.equal(wrong.statusCode,403);assert.equal(wrong.json().data,null);
  const member=await app.inject({method:'POST',url:'/api/auth/login',payload:{username:'member',password:'Fresh@123456'}});
  assert.equal(member.json().data.user.accountType,'member');
  assert.equal(app.jwt.verify<{accountType:string}>(member.json().data.token).accountType,'member');
  assert.equal((await app.inject({url:'/api/admin/auth/me',headers:{authorization:'Bearer '+member.json().data.token}})).statusCode,403);
  for(const username of ['missing','admin'])assert.equal((await app.inject({method:'POST',url:'/api/admin/auth/login',payload:{username,password:'wrong'}})).statusCode,401);
});

test('all employee roles are blocked from shopping even when historical carts and orders exist',async()=>{
  const order=await paid(),address={name:'员工旧地址',phone:'13900139000',detail:'上海市浦东新区员工旧地址88号',isDefault:true};
  await db.run('UPDATE orders SET user_id=? WHERE id=?',['u-operator',order.id]);
  const stock=(await db.one('SELECT stock FROM products WHERE id=?',['p01']))!.stock;
  for(const role of ['operator','warehouse','support','finance','admin']) {
    const addressId='old-'+role;
    await db.run('INSERT INTO addresses(id,user_id,name,phone,detail,is_default) VALUES(?,?,?,?,?,?)',[addressId,'u-'+role,address.name,address.phone,address.detail,1]);
    await db.run('INSERT INTO cart_items(user_id,product_id,quantity) VALUES(?,?,?)',['u-'+role,'p01',1]);
    const attempts:[string,string,any?][]=[
      ['GET','/api/auth/me'],['GET','/api/cart'],['POST','/api/cart',{productId:'p01',quantity:1}],['PUT','/api/cart/p01',{quantity:0}],
      ['GET','/api/addresses'],['POST','/api/addresses',address],['PUT','/api/addresses/'+addressId,address],['DELETE','/api/addresses/'+addressId],['GET','/api/notifications'],
      ['GET','/api/orders'],['POST','/api/orders',{addressId,deliverySlot:'尽快送达'}],['GET','/api/orders/'+order.id],
      ...['pay','cancel','receive'].map(action=>['POST','/api/orders/'+order.id+'/'+action] as [string,string]),
      ['POST','/api/orders/'+order.id+'/refund',{reason:'旧员工订单退款测试'}],['POST','/api/orders/'+order.id+'/reviews',{productId:'p01',rating:5,content:'员工不能购物评价'}]
    ];
    for(const [method,url,payload] of attempts) {
      const response=await request(method,url,payload,role,{'idempotency-key':randomUUID()});
      assert.equal(response.status,403,role+' '+method+' '+url);assert.equal(response.body.code,'MEMBER_ONLY');
    }
    await assert.rejects(()=>ctx.orders.create('u-'+role,randomUUID(),{addressId,deliverySlot:'尽快送达'},'test'),{code:'MEMBER_ONLY'});
  }
  assert.equal(Number((await db.one('SELECT COUNT(*) AS n FROM orders'))!.n),1);
  assert.equal((await db.one('SELECT status FROM orders WHERE id=?',[order.id]))!.status,'paid');
  assert.equal((await db.one('SELECT stock FROM products WHERE id=?',['p01']))!.stock,stock);
  assert.equal(Number((await db.one('SELECT COUNT(*) AS n FROM cart_items'))!.n),5);
  assert.equal(Number((await db.one('SELECT COUNT(*) AS n FROM addresses'))!.n),6);
  assert.equal(Number((await db.one('SELECT COUNT(*) AS n FROM refunds'))!.n),0);
  assert.equal(Number((await db.one('SELECT COUNT(*) AS n FROM reviews'))!.n),0);
});

test('account lists and employee provisioning keep memberships separate',async()=>{
  const staff=(await request('GET','/api/admin/users',undefined,'admin')).body.data;
  const members=(await request('GET','/api/admin/members',undefined,'admin')).body.data;
  assert.equal(staff.total,5);assert.ok(staff.items.every((u:any)=>u.accountType==='staff'));
  assert.equal(members.total,1);assert.ok(members.items.every((u:any)=>u.accountType==='member'));
  assert.ok(!JSON.stringify([staff,members]).includes('password'));
  assert.equal((await request('PUT','/api/admin/users/u-member/role',{role:'operator'},'admin')).body.code,'ACCOUNT_TYPE_IMMUTABLE');
  assert.equal((await request('PUT','/api/admin/users/u-operator/role',{role:'member'},'admin')).status,400);
  assert.equal((await db.one('SELECT role FROM users WHERE id=?',['u-member']))!.role,'member');
  assert.equal((await db.one('SELECT role FROM users WHERE id=?',['u-operator']))!.role,'operator');
  const employee={username:'staff_new',name:'新运营',password:'StaffPass12345',role:'operator'};
  for(const role of ['member','operator','warehouse','support','finance'])assert.equal((await request('POST','/api/admin/users',employee,role)).status,403);
  assert.equal((await request('POST','/api/admin/users',{...employee,role:'member'},'admin')).status,400);
  const created=await request('POST','/api/admin/users',employee,'admin');
  assert.equal(created.status,200);assert.equal(created.body.data.accountType,'staff');assert.equal(created.body.data.role,'operator');
  assert.equal((await request('POST','/api/admin/users',employee,'admin')).status,409);
  const payload={username:employee.username,password:employee.password};
  const login=await app.inject({method:'POST',url:'/api/admin/auth/login',payload});assert.equal(login.statusCode,200);
  assert.equal((await app.inject({method:'POST',url:'/api/auth/login',payload})).statusCode,403);
  assert.equal((await app.inject({url:'/api/cart',headers:{authorization:'Bearer '+login.json().data.token}})).statusCode,403);
  const audit=(await request('GET','/api/admin/audit',undefined,'admin')).body.data.items;
  assert.ok(audit.some((row:any)=>row.action==='user.create'&&row.actor_id==='u-admin'));assert.ok(!JSON.stringify(audit).includes(employee.password));
});

test('legacy tokens and stale account types cannot cross the member and staff boundary',async()=>{
  const legacy=app.jwt.sign({sub:'u-admin'} as any);
  assert.equal((await app.inject({url:'/api/admin/dashboard',headers:{authorization:'Bearer '+legacy}})).statusCode,401);
  for(const [role,next] of [['member','operator'],['warehouse','member']]) {
    const token=headers(role);await db.run('UPDATE users SET role=? WHERE id=?',[next,'u-'+role]);
    for(const url of ['/api/auth/me','/api/admin/auth/me','/api/cart','/api/admin/dashboard']) {
      const response=await app.inject({url,headers:token});assert.equal(response.statusCode,401);assert.equal(response.json().code,'SESSION_CHANGED');
    }
  }
});

test('administrators can create, search, inspect, edit and delete both account types',async()=>{
  for(const [path,type] of [['users','staff'],['members','member']] as const) {
    const original={username:'crud_'+type,name:'账号查询样例',password:'AccountPass123',...(type==='staff'?{role:'support'}:{})};
    const created=await request('POST','/api/admin/'+path,original,'admin');assert.equal(created.status,200);
    const id=created.body.data.id,url='/api/admin/'+path+'/'+id;
    const detail=await request('GET',url,undefined,'admin');assert.equal(detail.body.data.username,original.username);assert.ok(!JSON.stringify(detail.body).includes('password'));
    const list=await request('GET','/api/admin/'+path+'?q='+encodeURIComponent('账号查询样例'),undefined,'admin');assert.equal(list.body.data.total,1);
    const changed={username:original.username+'_edited',name:'改后姓名',active:1,...(type==='staff'?{role:'finance'}:{})};
    assert.equal((await request('PUT',url,changed,'admin')).status,200);
    const filtered=await request('GET','/api/admin/'+path+'?q='+changed.username+'&active=1'+(type==='staff'?'&role=finance':''),undefined,'admin');assert.equal(filtered.body.data.total,1);assert.equal(filtered.body.data.items[0].name,'改后姓名');
    assert.equal((await request('DELETE',url,undefined,'admin')).status,200);
    assert.equal((await request('GET',url,undefined,'admin')).status,404);
    assert.equal((await request('DELETE',url,undefined,'admin')).status,404);
    assert.equal((await request('GET','/api/admin/'+path+'?q='+changed.username,undefined,'admin')).body.data.total,0);
    const login=await app.inject({method:'POST',url:type==='staff'?'/api/admin/auth/login':'/api/auth/login',payload:{username:changed.username,password:original.password}});assert.equal(login.statusCode,401);
    assert.ok((await db.one('SELECT deleted_at FROM users WHERE id=?',[id]))!.deleted_at);
    await seed(db);assert.equal((await request('GET',url,undefined,'admin')).status,404);
  }
  const logs=await db.all("SELECT * FROM audit_logs WHERE action IN ('user.create','user.update','user.delete')");
  assert.equal(logs.length,6);assert.ok(!JSON.stringify(logs).includes('AccountPass123'));
});

test('account CRUD enforces roles, type boundaries, validation and self protection',async()=>{
  const member={username:'created_member',name:'测试会员',password:'AccountPass123'},edit={username:'member',name:'会员资料',active:1};
  for(const role of ['member','operator','warehouse','support','finance'])for(const [method,url,payload] of [
    ['GET','/api/admin/users'],['GET','/api/admin/members/u-member'],['POST','/api/admin/members',member],
    ['PUT','/api/admin/members/u-member',edit],['DELETE','/api/admin/members/u-member'],['DELETE','/api/admin/users/u-operator']
  ] as const)assert.equal((await request(method,url,payload,role)).status,403,role+' '+method+' '+url);
  assert.equal((await app.inject({method:'DELETE',url:'/api/admin/users/u-operator'})).statusCode,401);
  assert.equal((await request('POST','/api/admin/members',{...member,role:'admin'},'admin')).status,400);
  assert.equal((await request('POST','/api/admin/members',{...member,name:'   '},'admin')).status,400);
  assert.equal((await request('POST','/api/admin/members',{...member,password:'weak'},'admin')).status,400);
  assert.equal((await request('PUT','/api/admin/members/u-member',{...edit,role:'admin'},'admin')).status,400);
  assert.equal((await request('PUT','/api/admin/users/u-member',{...edit,role:'admin'},'admin')).body.code,'ACCOUNT_TYPE_IMMUTABLE');
  assert.equal((await request('DELETE','/api/admin/users/u-member',undefined,'admin')).status,404);
  assert.equal((await request('PUT','/api/admin/users/u-admin',{username:'admin',name:'管理员',role:'admin',active:0},'admin')).body.code,'SELF_DISABLE');
  assert.equal((await request('DELETE','/api/admin/users/u-admin',undefined,'admin')).body.code,'SELF_DELETE');
  assert.equal((await request('PUT','/api/admin/members/u-member',{...edit,username:'operator'},'admin')).body.code,'USERNAME_EXISTS');
  assert.equal((await request('GET','/api/admin/users?q=%25',undefined,'admin')).body.data.total,0);
});

test('password resets, disable/enable and deletion invalidate old sessions for both portals',async()=>{
  for(const [path,loginPath,mePath,username] of [['users','/api/admin/auth/login','/api/admin/auth/me','operator'],['members','/api/auth/login','/api/auth/me','member']]) {
    const login=await app.inject({method:'POST',url:loginPath,payload:{username,password:'Fresh@123456'}});
    const old={authorization:'Bearer '+login.json().data.token},url='/api/admin/'+path+'/u-'+username;
    const edit={username,name:'账号安全测试',active:1,...(path==='users'?{role:'operator'}:{})};
    assert.equal((await request('PUT',url,{...edit,password:'ChangedPass123'},'admin')).status,200);
    assert.equal((await app.inject({url:mePath,headers:old})).statusCode,401);
    assert.equal((await app.inject({method:'POST',url:loginPath,payload:{username,password:'Fresh@123456'}})).statusCode,401);
    const next=await app.inject({method:'POST',url:loginPath,payload:{username,password:'ChangedPass123'}});assert.equal(next.statusCode,200);
    const current={authorization:'Bearer '+next.json().data.token};
    assert.equal((await request('PUT',url,{...edit,active:0},'admin')).status,200);
    assert.equal((await app.inject({url:mePath,headers:current})).statusCode,401);
    assert.equal((await app.inject({method:'POST',url:loginPath,payload:{username,password:'ChangedPass123'}})).json().code,'ACCOUNT_DISABLED');
    assert.equal((await request('PUT',url,edit,'admin')).status,200);
    assert.equal((await app.inject({url:mePath,headers:current})).statusCode,401);
    const fresh=await app.inject({method:'POST',url:loginPath,payload:{username,password:'ChangedPass123'}});assert.equal(fresh.statusCode,200);
    assert.equal((await request('DELETE',url,undefined,'admin')).status,200);
    assert.equal((await app.inject({url:mePath,headers:{authorization:'Bearer '+fresh.json().data.token}})).statusCode,401);
  }
  assert.ok(!JSON.stringify(await db.all('SELECT detail FROM audit_logs')).includes('ChangedPass123'));
});

test('concurrent administrator demotions preserve one active administrator',async()=>{
  const other=(await request('POST','/api/admin/users',{username:'second_admin',name:'另一管理员',password:'AccountPass123',role:'admin'},'admin')).body.data;
  const otherAuth={authorization:'Bearer '+app.jwt.sign({sub:other.id,accountType:'staff'})};
  const results=await Promise.all([
    request('PUT','/api/admin/users/'+other.id+'/role',{role:'operator'},'admin'),
    request('PUT','/api/admin/users/u-admin/role',{role:'operator'},'admin',otherAuth)
  ]);
  assert.equal(results.filter(result=>result.status===200).length,1);
  assert.equal(Number((await db.one("SELECT COUNT(*) AS count FROM users WHERE role='admin' AND active=1 AND deleted_at IS NULL"))!.count),1);
});

test('member deletion blocks unfinished business and preserves completed order history',async()=>{
  const order=await paid();
  assert.equal((await request('DELETE','/api/admin/members/u-member',undefined,'admin')).body.code,'ACCOUNT_IN_USE');
  await ctx.orders.transition(order.id,'picking','u-warehouse','test');await ctx.orders.transition(order.id,'delivering','u-warehouse','test');await ctx.orders.transition(order.id,'completed','u-member','test',true);
  const refund=(await request('POST','/api/orders/'+order.id+'/refund',{reason:'删除账号前的待处理售后'})).body.data;
  assert.equal((await request('DELETE','/api/admin/members/u-member',undefined,'admin')).status,409);
  await request('POST','/api/admin/refunds/'+refund.id+'/decision',{approve:false,note:'已核实，无需退款'},'support');
  assert.equal((await request('DELETE','/api/admin/members/u-member',undefined,'admin')).status,200);
  assert.equal((await request('GET','/api/admin/orders/'+order.id,undefined,'admin')).body.data.items[0].name,'丹东红颜草莓');
  assert.equal((await request('POST','/api/admin/settlements',undefined,'finance')).body.data.count,1);
  assert.equal((await request('GET','/api/admin/dashboard',undefined,'admin')).body.data.members,0);
});

test('only administrators delete goods, while history, refunds and seed tombstones survive',async()=>{
  const order=await paid();await cart();
  for(const role of ['member','operator','warehouse','support','finance'])assert.equal((await request('DELETE','/api/admin/products/p01',undefined,role)).status,403);
  assert.equal((await app.inject({method:'DELETE',url:'/api/admin/products/p01'})).statusCode,401);
  assert.equal((await request('GET','/api/admin/products/p01',undefined,'finance')).status,403);
  await request('GET','/api/products');await request('GET','/api/admin/products',undefined,'admin');
  assert.equal((await request('DELETE','/api/admin/products/p01',undefined,'admin')).status,200);
  assert.equal((await request('GET','/api/cart')).body.data.count,0);
  assert.equal((await request('GET','/api/products/p01')).status,404);
  assert.equal((await request('GET','/api/admin/products/p01',undefined,'admin')).status,404);
  assert.equal((await request('GET','/api/products?pageSize=100')).body.data.total,productData.length-1);
  assert.equal((await request('GET','/api/admin/products?pageSize=100',undefined,'admin')).body.data.total,productData.length-1);
  assert.equal((await request('POST','/api/admin/products/p01/stock',{delta:1,reason:'删除后禁止入库'},'admin')).status,409);
  assert.equal((await request('DELETE','/api/admin/products/p01',undefined,'admin')).status,404);
  await seed(db);await ctx.runtime.invalidate();
  assert.equal((await request('GET','/api/products/p01')).status,404);
  const refund=(await request('POST','/api/orders/'+order.id+'/refund',{reason:'历史商品删除后仍可售后'})).body.data;
  assert.equal((await request('POST','/api/admin/refunds/'+refund.id+'/decision',{approve:true,note:'按历史订单退款'},'support')).status,200);
  assert.equal((await db.one('SELECT stock FROM products WHERE id=?',['p01']))!.stock,86);
  assert.ok((await db.one('SELECT deleted_at FROM products WHERE id=?',['p01']))!.deleted_at);
  assert.equal((await request('GET','/api/admin/orders/'+order.id,undefined,'admin')).body.data.status,'refunded');
});

test('catalog administration supports create, detail, edit and visibility filters',async()=>{
  const source=(await request('GET','/api/admin/products/p01',undefined,'operator')).body.data;
  const input=Object.fromEntries(['category_id','name','subtitle','description','price','original_price','image','unit','origin','storage','tag','active'].map(key=>[key,source[key]]));
  const created=await request('POST','/api/admin/products',{...input,name:'后台新增商品'},'operator');assert.equal(created.status,200);
  const id=created.body.data.id;assert.equal(created.body.data.stock,0);
  assert.equal((await request('PUT','/api/admin/products/'+id,{...input,name:'已编辑商品',active:0},'operator')).status,200);
  assert.equal((await request('GET','/api/admin/products?active=0',undefined,'warehouse')).body.data.total,1);
  assert.equal((await request('GET','/api/products/'+id)).status,404);
  assert.equal((await request('DELETE','/api/admin/products/'+id,undefined,'admin')).status,200);
  assert.equal((await request('PUT','/api/admin/products/'+id,input,'admin')).status,404);
});

test('administrators edit delivery data and cancel/delete only unpaid cancelled orders',async()=>{
  await cart();const order=(await checkout()).body.data,url='/api/admin/orders/'+order.id;
  const edit={name:'修改收货人',phone:'',detail:'上海市浦东新区 修改后的配送地址88号',deliverySlot:'明日 09:00–12:00',note:'请先电话联系'};
  for(const role of ['member','operator','warehouse','support','finance'])for(const [method,path,payload] of [['PUT',url,edit],['POST',url+'/cancel'],['DELETE',url]] as const)assert.equal((await request(method,path,payload,role)).status,403);
  const changed=await request('PUT',url,edit,'admin');assert.equal(changed.status,200);assert.equal(changed.body.data.address.phone,'138****8000');assert.equal(changed.body.data.address_snapshot,undefined);
  assert.equal((await request('GET','/api/orders/'+order.id)).body.data.address.phone,'13800138000');
  assert.equal((await request('GET','/api/addresses')).body.data[0].name,'林小鲜');
  assert.equal((await request('GET','/api/admin/orders?q='+encodeURIComponent(edit.name),undefined,'admin')).body.data.total,1);
  assert.equal((await request('DELETE',url,undefined,'admin')).status,409);
  assert.equal((await request('POST',url+'/cancel',undefined,'admin')).status,200);
  assert.equal((await db.one('SELECT stock FROM products WHERE id=?',['p01']))!.stock,86);
  assert.equal((await request('POST',url+'/cancel',undefined,'admin')).status,200);
  assert.equal((await request('DELETE',url,undefined,'admin')).status,200);
  assert.equal((await request('GET',url,undefined,'admin')).status,404);
  assert.equal((await request('GET','/api/orders/'+order.id)).status,404);
  assert.equal((await request('GET','/api/orders')).body.data.total,0);
  assert.equal((await request('GET','/api/admin/orders',undefined,'admin')).body.data.total,0);
  assert.equal((await request('GET','/api/admin/dashboard',undefined,'admin')).body.data.orders,0);
});

test('paid, fulfilled and financial records cannot be deleted or bypass business transitions',async()=>{
  const order=await paid(),url='/api/admin/orders/'+order.id;
  assert.equal((await request('POST',url+'/cancel',undefined,'admin')).status,409);
  assert.equal((await request('DELETE',url,undefined,'admin')).status,409);
  const edit={name:'订单联系人',phone:'13900139000',detail:'上海市浦东新区订单联系人地址99号',deliverySlot:'尽快送达',note:''};
  assert.equal((await request('PUT',url,edit,'admin')).status,200);
  assert.equal((await request('GET','/api/orders/'+order.id)).body.data.address.phone,'13900139000');
  await ctx.orders.transition(order.id,'picking','u-warehouse','test');
  assert.equal((await request('PUT',url,edit,'admin')).status,409);
  const refund=(await request('POST','/api/orders/'+order.id+'/refund',{reason:'后台检索售后测试'})).body.data;
  assert.equal((await request('GET','/api/admin/refunds?q='+encodeURIComponent('检索售后'),undefined,'support')).body.data.total,1);
  assert.equal((await request('GET','/api/admin/refunds/'+refund.id,undefined,'support')).body.data.order.address.phone,'139****9000');
  for(const path of ['/api/admin/refunds/'+refund.id,'/api/admin/settlements/nonexistent','/api/admin/audit/nonexistent'])assert.equal((await request('DELETE',path,undefined,'admin')).status,404);
  assert.equal((await request('POST','/api/admin/refunds/'+refund.id+'/decision',{approve:false,note:'   '},'support')).status,400);
  await request('POST','/api/admin/refunds/'+refund.id+'/decision',{approve:false,note:'保留历史审核记录'},'support');
  await ctx.orders.transition(order.id,'delivering','u-warehouse','test');await ctx.orders.transition(order.id,'completed','u-member','test',true);
  await request('POST','/api/admin/settlements',undefined,'finance');
  const settlements=await request('GET','/api/admin/settlements?q='+order.id,undefined,'finance');assert.equal(settlements.body.data.total,1);assert.equal(Number(settlements.body.data.amount),order.total);
  const empty=await request('GET','/api/admin/settlements?q=missing_record',undefined,'finance');assert.equal(empty.body.data.total,0);assert.equal(Number(empty.body.data.amount),0);
  const logs=await request('GET','/api/admin/audit?q=order.delivery.update',undefined,'admin');assert.equal(logs.body.data.total,1);
  for(const [path,status] of [['orders','unknown'],['refunds','completed'],['users','']]) {
    if(status)assert.equal((await request('GET','/api/admin/'+path+'?status='+status,undefined,'admin')).status,400);
  }
});
test('catalog validates sort, bounds pagination, and parameterizes search',async()=>{assert.equal((await request('GET','/api/products?pageSize=1000')).status,400);assert.equal((await request('GET','/api/products?sort=stock%20DESC')).status,400);const sql=await request('GET',"/api/products?q="+encodeURIComponent("' OR 1=1 --"));assert.equal(sql.status,200);assert.equal(sql.body.data.total,0);const page=await request('GET','/api/products?page=2&pageSize=4');assert.equal(page.body.data.items.length,4);assert.equal(page.body.data.total,productData.length);});
test('catalog seeding fills existing shops without changing inventory, accounts or orders',async()=>{
  await cart();const order=(await checkout()).body.data;
  await db.run('UPDATE products SET price=2590,stock=12,active=0,sales=9 WHERE id=?',['p01']);
  await db.run('UPDATE users SET name=? WHERE id=?',['已有会员','u-member']);
  await db.run('DELETE FROM products WHERE id>=?',['p25']);
  const products=await db.all('SELECT * FROM products ORDER BY id');
  const users=await db.all('SELECT * FROM users ORDER BY id');
  const addresses=await db.all('SELECT * FROM addresses ORDER BY id');
  const storedOrder=await db.one('SELECT * FROM orders WHERE id=?',[order.id]);
  await seed(db);await seed(db);
  assert.deepEqual(await db.all('SELECT * FROM products WHERE id<? ORDER BY id',['p25']),products);
  assert.deepEqual(await db.all('SELECT * FROM users ORDER BY id'),users);
  assert.deepEqual(await db.all('SELECT * FROM addresses ORDER BY id'),addresses);
  assert.deepEqual(await db.one('SELECT * FROM orders WHERE id=?',[order.id]),storedOrder);
  const counts=await db.all('SELECT category_id,COUNT(*) AS count FROM products GROUP BY category_id');
  assert.equal(counts.length,6);assert.ok(counts.every(row=>Number(row.count)===8));
  const newProduct=await request('GET','/api/products/p48');
  assert.equal(newProduct.status,200);assert.equal(newProduct.body.data.name,'嘉兴鲜肉粽');
});

test('catalog search tolerates a single name typo and requires every keyword',async()=>{
  const cases:[string,string[]][]=[
    ['三文余',['p07']],['西蓝花',['p14']],['三鱼文',['p07']],
    ['红草莓',['p01']],['红颜颜草莓',['p01']],['挪威 三文余',['p07']],
    ['苹果 山东',['p06']],['  丹东　草莓  ',['p01']],['车厘子 ｊｊ级',['p04']]
  ];
  for(const [q,ids] of cases) {
    const response=await request('GET','/api/products?'+new URLSearchParams({q}));
    assert.equal(response.status,200);
    assert.deepEqual(response.body.data.items.map((p:any)=>p.id),ids,q);
    assert.equal(response.body.data.total,ids.length,q);
  }
});
test('catalog search rejects insufficient overlaps and literal SQL wildcards',async()=>{
  for(const q of ['草莓酱','草莓蛋糕','牛奶茶','草莓 牛奶','挪危 三文余','丹冬 草莓','清甜微酥','%','_']) {
    const response=await request('GET','/api/products?'+new URLSearchParams({q}));
    assert.equal(response.status,200);
    assert.equal(response.body.data.total,0,q);
    assert.deepEqual(response.body.data.items,[],q);
  }
  assert.deepEqual((await request('GET','/api/products?'+new URLSearchParams({q:'虾'}))).body.data.items.map((p:any)=>p.id),['p08']);
  assert.equal((await request('GET','/api/products?'+new URLSearchParams({q:'   '}))).body.data.total,productData.length);
});
test('two-character searches use the same overlap algorithm for any product name',async()=>{
  const meat=(await request('GET','/api/products?'+new URLSearchParams({q:'牛肉',category:'meat'}))).body.data;
  assert.ok(meat.items.some((p:any)=>p.id==='p10'));
  assert.ok(meat.items.some((p:any)=>p.id==='p12'));
  for(const [id,name] of [['p01','甲丁'],['p02','丙乙'],['p03','甲乙'],['p04','戊己']]) {
    await db.run('UPDATE products SET name=? WHERE id=?',[name,id]);
  }
  const generic=(await request('GET','/api/products?'+new URLSearchParams({q:'甲乙'}))).body.data;
  assert.deepEqual(generic.items.map((p:any)=>p.id),['p03','p01','p02']);
});
test('weak overlap results are capped before pagination without capping accurate matches',async()=>{
  for(let n=1;n<=10;n++)await db.run('UPDATE products SET name=? WHERE id=?',['甲示例'+n,'p'+String(n).padStart(2,'0')]);
  await db.run('UPDATE products SET name=? WHERE id=?',['甲乙商品','p11']);
  const query=new URLSearchParams({q:'甲乙',pageSize:'100'});
  const all=(await request('GET','/api/products?'+query)).body.data;
  assert.equal(all.total,7);assert.equal(all.items[0].id,'p11');
  query.set('sort','priceAsc');
  const price=(await request('GET','/api/products?'+query)).body.data;
  assert.deepEqual(price.items.map((p:any)=>p.id).sort(),all.items.map((p:any)=>p.id).sort());
  query.set('pageSize','2');query.set('page','4');
  const last=(await request('GET','/api/products?'+query)).body.data;
  assert.equal(last.total,7);assert.equal(last.items.length,1);
});
test('search relevance precedes recommendation while explicit price and sales sorts still apply',async()=>{
  await db.run('UPDATE products SET name=?,views=9999,sales=999 WHERE id=?',['有机西蓝花','p15']);
  await db.run('UPDATE products SET subtitle=? WHERE id=?',['西兰花的清爽搭档','p16']);
  const ids=async(sort:string)=>(await request('GET','/api/products?'+new URLSearchParams({q:'西兰花',sort}))).body.data.items.map((p:any)=>p.id);
  assert.deepEqual(await ids('default'),['p14','p16','p15']);
  assert.deepEqual(await ids('priceAsc'),['p16','p14','p15']);
  assert.deepEqual(await ids('priceDesc'),['p15','p14','p16']);
  assert.deepEqual(await ids('sales'),['p15','p14','p16']);
});
test('search filters and ranks all matches before pagination',async()=>{
  const first=(await request('GET','/api/products?'+new URLSearchParams({q:'山东',page:'1',pageSize:'2'}))).body.data;
  const second=(await request('GET','/api/products?'+new URLSearchParams({q:'山东',page:'2',pageSize:'2'}))).body.data;
  assert.equal(first.total,8);assert.equal(second.total,8);
  assert.deepEqual(first.items.map((p:any)=>p.id),['p06','p15']);
  assert.deepEqual(second.items.map((p:any)=>p.id),['p13','p16']);
});
test('fuzzy search respects category and visibility and also works in the workbench',async()=>{
  const query=(category:string)=>new URLSearchParams({q:'西蓝花',category}).toString();
  assert.equal((await request('GET','/api/products?'+query('fruit'))).body.data.total,0);
  assert.equal((await request('GET','/api/products?'+query('vegetable'))).body.data.total,1);
  await db.run('UPDATE products SET active=0 WHERE id=?',['p14']);
  assert.equal((await request('GET','/api/products?'+query('vegetable'))).body.data.total,0);
  const admin=await request('GET','/api/admin/products?'+query('vegetable'),undefined,'operator');
  assert.equal(admin.status,200);assert.deepEqual(admin.body.data.items.map((p:any)=>p.id),['p14']);
});
test('default sort ranks by weighted recommendation instead of upload time',async()=>{
  const items=(await request('GET','/api/products?pageSize=24')).body.data.items;
  // 种子数据上架时间相同，按时间排序会让 p01 居首；综合推荐应由浏览量最高的 p04 居首
  assert.equal(items[0].id,'p04');
  assert.notEqual(items[0].id,'p01');
  // 权重（销量*0.5 + 浏览量*0.3 + 新品*0.2，新品权重对全部种子商品一致）应单调不增
  const score=(p:any)=>p.sales*0.5+p.views*0.3;
  for(let i=1;i<items.length;i++)assert.ok(score(items[i-1])>=score(items[i]),'推荐分数应非递增');
});
test('cart maintains quantities and rejects stock overflow',async()=>{assert.equal((await cart()).body.data.count,1);assert.equal((await cart()).body.data.count,2);assert.equal((await cart('p07',99)).status,409);const removed=await request('PUT','/api/cart/p01',{quantity:0});assert.equal(removed.body.data.count,0);assert.equal((await request('POST','/api/cart',{productId:'p01',quantity:-1})).status,400);});
test('checkout snapshots prices/address, applies fee and reserves inventory',async()=>{await cart();const order=(await checkout()).body.data;assert.equal(order.total,3590);assert.equal(order.status,'pending');assert.equal(order.address.phone,'13800138000');assert.equal(order.items[0].price,2990);assert.equal((await db.one('SELECT stock FROM products WHERE id=?',['p01']))!.stock,85);assert.equal((await request('GET','/api/cart')).body.data.count,0);await db.run('UPDATE products SET price=9999 WHERE id=?',['p01']);assert.equal((await request('GET','/api/orders/'+order.id)).body.data.items[0].price,2990);});
test('checkout applies free shipping at 99 yuan and above',async()=>{await cart('p01',4);const o=(await checkout()).body.data;assert.equal(o.subtotal,11960);assert.equal(o.delivery_fee,0);assert.equal(o.total,11960);});
test('eight simultaneous retries with same idempotency key create one order',async()=>{await cart();const key=randomUUID();const results=await Promise.all(Array.from({length:8},()=>checkout(key)));assert.ok(results.every(r=>r.status===200));assert.equal(new Set(results.map(r=>r.body.data.id)).size,1);assert.equal(Number((await db.one('SELECT COUNT(*) AS n FROM orders'))!.n),1);assert.equal((await db.one('SELECT stock FROM products WHERE id=?',['p01']))!.stock,85);});
test('idempotency key cannot be reused with another payload',async()=>{await cart();const key=randomUUID();await checkout(key);const conflict=await checkout(key,'member',{addressId:'a-demo',deliverySlot:'明日 09:00–12:00'});assert.equal(conflict.status,409);assert.equal(conflict.body.code,'IDEMPOTENCY_CONFLICT');});
test('failed multi-product checkout rolls back all reservations and preserves cart',async()=>{await cart('p01');await cart('p02');await db.run('UPDATE products SET stock=0 WHERE id=?',['p02']);const order=await checkout();assert.equal(order.status,409);assert.equal((await db.one('SELECT stock FROM products WHERE id=?',['p01']))!.stock,86);assert.equal(Number((await db.one('SELECT COUNT(*) AS n FROM orders'))!.n),0);assert.equal((await request('GET','/api/cart')).body.data.count,2);});
test('competing members cannot oversell the final three units',async()=>{
  const other=await ctx.accounts.register({username:'other_member',name:'其他会员',password:'Secure12345'},'test'),auth={authorization:'Bearer '+app.jwt.sign({sub:other.id,accountType:'member'})};
  await db.run('UPDATE products SET stock=3 WHERE id=?',['p01']);
  const address=(await request('POST','/api/addresses',{name:'测试',phone:'13800138000',detail:'上海市张江路第二号测试地址',isDefault:true},'member',auth)).body.data;
  assert.equal((await cart('p01',3)).status,200);assert.equal((await request('POST','/api/cart',{productId:'p01',quantity:3},'member',auth)).status,200);
  const results=await Promise.all([checkout(),request('POST','/api/orders',{addressId:address.id,deliverySlot:'尽快送达'},'member',{...auth,'idempotency-key':randomUUID()})]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal((await db.one('SELECT stock FROM products WHERE id=?',['p01']))!.stock,0);assert.equal(Number((await db.one('SELECT COUNT(*) AS n FROM orders'))!.n),1);
});
test('duplicate sandbox payments never double charge or inflate sales',async()=>{await cart();const o=(await checkout()).body.data;const results=await Promise.all(Array.from({length:6},()=>request('POST','/api/orders/'+o.id+'/pay')));assert.ok(results.every(r=>r.status===200));assert.equal(Number((await db.one('SELECT COUNT(*) AS n FROM payments'))!.n),1);assert.equal((await db.one('SELECT sales FROM products WHERE id=?',['p01']))!.sales,1);});
test('pay-versus-cancel race has exactly one winning transition',async()=>{await cart();const o=(await checkout()).body.data;const r=await Promise.all([request('POST','/api/orders/'+o.id+'/pay'),request('POST','/api/orders/'+o.id+'/cancel')]);assert.deepEqual(r.map(x=>x.status).sort(),[200,409]);const final=(await db.one('SELECT status FROM orders WHERE id=?',[o.id]))!.status;const stock=(await db.one('SELECT stock FROM products WHERE id=?',['p01']))!.stock;assert.equal(stock,final==='paid'?85:86);});
test('cancel is idempotent and stock is returned once',async()=>{await cart();const o=(await checkout()).body.data;await request('POST','/api/orders/'+o.id+'/cancel');await request('POST','/api/orders/'+o.id+'/cancel');assert.equal((await db.one('SELECT stock FROM products WHERE id=?',['p01']))!.stock,86);assert.equal((await request('POST','/api/orders/'+o.id+'/pay')).status,409);});
test('expiry rejects payment and worker returns stock only once',async()=>{await cart();const o=(await checkout()).body.data;await db.run('UPDATE orders SET expires_at=1 WHERE id=?',[o.id]);assert.equal((await request('POST','/api/orders/'+o.id+'/pay')).status,409);await ctx.orders.expire();await ctx.orders.expire();assert.equal((await db.one('SELECT stock FROM products WHERE id=?',['p01']))!.stock,86);assert.equal((await db.one('SELECT status FROM orders WHERE id=?',[o.id]))!.status,'cancelled');});
test('member cannot read, pay, cancel or refund another member order',async()=>{await cart();const o=(await checkout()).body.data,other=await ctx.accounts.register({username:'other_member',name:'其他会员',password:'Secure12345'},'test'),auth={authorization:'Bearer '+app.jwt.sign({sub:other.id,accountType:'member'})};for(const suffix of ['', '/pay','/cancel','/refund'])assert.equal((await request(suffix?'POST':'GET','/api/orders/'+o.id+suffix,suffix==='/refund'?{reason:'测试越权退款'}:undefined,'member',auth)).status,404);});
test('fulfillment follows a strict state machine and receive checks ownership',async()=>{const o=await paid();assert.equal((await request('POST','/api/admin/orders/'+o.id+'/status',{status:'delivering'},'warehouse')).status,409);assert.equal((await request('POST','/api/orders/'+o.id+'/receive')).status,409);assert.equal((await request('POST','/api/admin/orders/'+o.id+'/status',{status:'picking'},'warehouse')).status,200);assert.equal((await request('POST','/api/admin/orders/'+o.id+'/status',{status:'delivering'},'warehouse')).status,200);assert.equal((await request('POST','/api/orders/'+o.id+'/receive')).body.data.status,'completed');});
test('pending refund blocks fulfillment and approval restocks unshipped goods once',async()=>{const o=await paid();const r=(await request('POST','/api/orders/'+o.id+'/refund',{reason:'未发货需要取消本单'})).body.data;assert.equal((await request('POST','/api/admin/orders/'+o.id+'/status',{status:'picking'},'warehouse')).status,409);for(let i=0;i<2;i++)assert.equal((await request('POST','/api/admin/refunds/'+r.id+'/decision',{approve:true,note:'核实后同意'},'support')).status,200);assert.equal((await db.one('SELECT stock FROM products WHERE id=?',['p01']))!.stock,86);assert.equal((await db.one('SELECT status FROM orders WHERE id=?',[o.id]))!.status,'refunded');});
test('fresh food already delivered is never restocked after refund',async()=>{const o=await completed();const r=(await request('POST','/api/orders/'+o.id+'/refund',{reason:'收到商品品质不符合预期'})).body.data;await request('POST','/api/admin/refunds/'+r.id+'/decision',{approve:true,note:'核实品质问题'},'support');assert.equal((await db.one('SELECT stock FROM products WHERE id=?',['p01']))!.stock,85);assert.equal((await request('POST','/api/admin/settlements',undefined,'finance')).body.data.count,0);});
test('partial refund restocks only the selected items and keeps the order active',async()=>{
  await cart('p01');await cart('p02');const o=(await checkout()).body.data;await request('POST','/api/orders/'+o.id+'/pay');
  assert.equal((await db.one('SELECT sales FROM products WHERE id=?',['p02']))!.sales,1);
  const refund=(await request('POST','/api/orders/'+o.id+'/refund',{reason:'其中一件不想要了',items:[{productId:'p02',quantity:1}]})).body.data;
  assert.equal(refund.amount,1990);assert.equal(refund.items.length,1);
  assert.equal((await request('POST','/api/admin/refunds/'+refund.id+'/decision',{approve:true,note:'同意部分退款'},'support')).status,200);
  assert.equal((await db.one('SELECT stock FROM products WHERE id=?',['p01']))!.stock,85);
  assert.equal((await db.one('SELECT stock FROM products WHERE id=?',['p02']))!.stock,120);
  assert.equal((await db.one('SELECT sales FROM products WHERE id=?',['p02']))!.sales,0);
  assert.equal((await db.one('SELECT status FROM orders WHERE id=?',[o.id]))!.status,'paid');
});
test('partial refund amount is bounded and nets the settlement',async()=>{
  await cart('p01');await cart('p02');const o=(await checkout()).body.data;await request('POST','/api/orders/'+o.id+'/pay');
  assert.equal((await request('POST','/api/orders/'+o.id+'/refund',{reason:'退款金额超出订单总额',amount:o.total+1})).status,400);
  await request('POST','/api/admin/orders/'+o.id+'/status',{status:'picking'},'warehouse');
  await request('POST','/api/admin/orders/'+o.id+'/status',{status:'delivering'},'warehouse');
  await request('POST','/api/orders/'+o.id+'/receive');
  const refund=(await request('POST','/api/orders/'+o.id+'/refund',{reason:'其中一件品质一般',items:[{productId:'p01',quantity:1}]})).body.data;
  assert.equal(refund.amount,2990);
  await request('POST','/api/admin/refunds/'+refund.id+'/decision',{approve:true,note:'同意部分退款'},'support');
  assert.equal((await db.one('SELECT stock FROM products WHERE id=?',['p01']))!.stock,85);
  const settle=(await request('POST','/api/admin/settlements',undefined,'finance')).body.data;
  assert.equal(settle.count,1);assert.equal(settle.amount,o.total-2990);
});
test('reviews require received items and prevent duplicate reviews',async()=>{const o=await paid(),review={productId:'p01',rating:5,content:'新鲜好吃，非常满意'};assert.equal((await request('POST','/api/orders/'+o.id+'/reviews',review)).status,409);await ctx.orders.transition(o.id,'picking','u-warehouse','test');await ctx.orders.transition(o.id,'delivering','u-warehouse','test');await ctx.orders.transition(o.id,'completed','u-member','test',true);assert.equal((await request('POST','/api/orders/'+o.id+'/reviews',review)).status,200);assert.equal((await request('POST','/api/orders/'+o.id+'/reviews',review)).status,409);assert.equal((await request('POST','/api/orders/'+o.id+'/reviews',{...review,productId:'p02'})).status,400);});
test('settlements exclude pending refunds and never settle twice',async()=>{const o=await completed();const r=(await request('POST','/api/orders/'+o.id+'/refund',{reason:'测试售后冻结结算'})).body.data;assert.equal((await request('POST','/api/admin/settlements',undefined,'finance')).body.data.count,0);await request('POST','/api/admin/refunds/'+r.id+'/decision',{approve:false,note:'核实商品正常'},'support');const first=await request('POST','/api/admin/settlements',undefined,'finance');assert.equal(first.body.data.count,1);assert.equal(first.body.data.amount,3590);assert.equal((await request('POST','/api/admin/settlements',undefined,'finance')).body.data.count,0);});
test('transactional outbox retries failed processing and deduplicates notifications',async()=>{await cart();const o=(await checkout()).body.data;const original=ctx.runtime.consume.bind(ctx.runtime);let fail=true;ctx.runtime.consume=async(event)=>{if(fail){fail=false;throw new Error('simulated failure');}return original(event);};await ctx.runtime.flush();assert.equal((await db.one('SELECT status FROM outbox'))!.status,'pending');await ctx.runtime.flush();await ctx.runtime.flush();const event=(await db.one('SELECT * FROM outbox'))!;await original({id:event.id,topic:event.topic,payload:JSON.parse(event.payload)});assert.equal(Number((await db.one('SELECT COUNT(*) AS n FROM notifications'))!.n),1);assert.equal((await db.one('SELECT status FROM outbox'))!.status,'sent');assert.equal(Number((await db.one('SELECT attempts FROM outbox'))!.attempts),2);});
test('role revocation takes effect even for previously signed JWT',async()=>{const token=headers('warehouse');assert.equal((await request('PUT','/api/admin/users/u-warehouse/role',{role:'finance'},'admin')).status,200);const revoked=await app.inject({url:'/api/admin/orders',headers:token});assert.equal(revoked.statusCode,403);assert.equal((await request('PUT','/api/admin/users/u-admin/role',{role:'operator'},'admin')).status,400);});
test('stock adjustments cannot make inventory negative and produce an audit trail',async()=>{assert.equal((await request('POST','/api/admin/products/p01/stock',{delta:-100,reason:'损耗'},'warehouse')).status,409);assert.equal((await request('POST','/api/admin/products/p01/stock',{delta:10,reason:'采购入库'},'warehouse')).status,200);assert.equal((await db.one('SELECT stock FROM products WHERE id=?',['p01']))!.stock,96);const logs=(await request('GET','/api/admin/audit',undefined,'admin')).body.data.items;assert.equal(logs[0].action,'stock.adjust');assert.ok(logs[0].trace_id);assert.ok(!JSON.stringify(logs).includes('password_hash'));});
test('address validation, ownership and default selection',async()=>{assert.equal((await request('POST','/api/addresses',{name:'测试',phone:'123',detail:'上海市张江路测试地址',isDefault:true})).status,400);const a=(await request('POST','/api/addresses',{name:'测试',phone:'13900139000',detail:'上海市张江路测试第二地址',isDefault:true})).body.data;const other=await ctx.accounts.register({username:'other_member',name:'其他会员',password:'Secure12345'},'test');const foreign=await request('PUT','/api/addresses/'+a.id,{name:'测试',phone:'13900139000',detail:'上海市张江路测试第二地址',isDefault:true},'member',{authorization:'Bearer '+app.jwt.sign({sub:other.id,accountType:'member'})});assert.equal(foreign.status,404);const list=(await request('GET','/api/addresses')).body.data;assert.equal(list.filter((x:any)=>x.is_default).length,1);});
test('dashboard, OpenAPI, health, metrics and masked staff order responses',async()=>{const o=await paid();assert.equal((await request('GET','/api/admin/dashboard',undefined,'admin')).status,200);const staff=(await request('GET','/api/admin/orders',undefined,'warehouse')).body.data.items[0];assert.equal(staff.address.phone,'138****8000');assert.equal(staff.address_snapshot,undefined);const health=await request('GET','/api/health');assert.equal(health.body.data.status,'ok');const spec=await app.inject({url:'/api/openapi.json'});assert.equal(spec.statusCode,200);assert.ok(spec.json().paths['/api/orders']);const metrics=await app.inject({url:'/api/metrics'});assert.equal(metrics.statusCode,200);assert.ok(metrics.body.includes('fresh_http_requests_total'));});
test('login rate limit blocks brute force attempts with a uniform error',async()=>{let last;for(let i=0;i<11;i++)last=await app.inject({method:'POST',url:'/api/auth/login',payload:{username:'member',password:'wrong'}});assert.equal(last!.statusCode,429);assert.equal(last!.json().code,'RATE_LIMITED');});
