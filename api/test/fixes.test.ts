import {test,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {randomUUID} from 'node:crypto';
import {buildApp} from '../src/app.js';
import {createDatabase,type Database} from '../src/core/database.js';

// 缺陷回归：DEF-01 经营概览数值类型、DEF-03 代理后限流、DEF-15 会员限流键、OBS-01/02/06
let app:Awaited<ReturnType<typeof buildApp>>['app'];
let ctx:Awaited<ReturnType<typeof buildApp>>['ctx'];
let db:Database;
let cleanup:(()=>Promise<void>)|undefined;
const token=(role='member',extra:Record<string,unknown>={})=>'Bearer '+app.jwt.sign({sub:'u-'+role,accountType:role==='member'?'member':'staff',...extra} as any);
const request=async(method:any,url:string,payload?:any,role='member',extra:any={})=>{
  const response=await app.inject({method,url,payload,headers:{authorization:token(role),...extra}});
  return {status:response.statusCode,body:response.json()};
};
async function open(){
  if(process.env.TEST_DATABASE_URL){
    const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL}),schema='test_'+randomUUID().replaceAll('-','');
    await pool.query('CREATE SCHEMA '+schema);const url=new URL(process.env.TEST_DATABASE_URL);url.searchParams.set('options','-c search_path='+schema);
    db=await createDatabase(url.toString());cleanup=async()=>{await pool.query('DROP SCHEMA '+schema+' CASCADE');await pool.end();};
  }else db=await createDatabase(undefined,':memory:');
  ({app,ctx}=await buildApp({db,logger:false,workers:false}));
}
beforeEach(open);
afterEach(async()=>{await app.close();await db.close();if(cleanup){await cleanup();cleanup=undefined;}delete process.env.TRUST_PROXY;});
const login=(username:string,ip?:string)=>app.inject({method:'POST',url:'/api/auth/login',payload:{username,password:'wrong-password-1'},headers:ip?{'x-forwarded-for':ip}:{}});

test('dashboard aggregates are numbers on every database, including zero orders',async()=>{
  const empty=(await request('GET','/api/admin/dashboard',undefined,'admin')).body.data;
  for(const key of ['orders','revenue','pending_fulfillment'])assert.equal(typeof empty[key],'number',key);
  assert.equal(empty.pending_fulfillment,0);assert.equal(typeof empty.outbox.pending,'number');
  await request('POST','/api/cart',{productId:'p01',quantity:2});
  const order=(await request('POST','/api/orders',{addressId:'a-demo',deliverySlot:'尽快送达'},'member',{'idempotency-key':randomUUID()})).body.data;
  await request('POST','/api/orders/'+order.id+'/pay');
  const d=(await request('GET','/api/admin/dashboard',undefined,'admin')).body.data;
  assert.deepEqual([d.orders,d.revenue,d.pending_fulfillment],[1,order.total,1]);
  assert.ok(d.statuses.every((s:any)=>typeof s.count==='number' && typeof s.status==='string'));
});

test('per-member limits key on the verified subject, so new tokens do not reset the bucket',async()=>{
  const statuses=[];
  // 每次请求都换一个新签发的令牌（模拟重复登录），30 次/分钟的抢券额度仍按同一会员累计
  for(let i=0;i<31;i++)statuses.push((await app.inject({method:'POST',url:'/api/coupons/missing/claim',headers:{authorization:token('member',{n:i})}})).statusCode);
  assert.ok(statuses.slice(0,30).every(s=>s!==429));assert.equal(statuses[30],429);
  // 伪造令牌退回按 IP 计数，不能凭随机令牌无限获得新计数桶
  const forged=[];for(let i=0;i<31;i++)forged.push((await app.inject({method:'POST',url:'/api/coupons/missing/claim',headers:{authorization:'Bearer forged.'+i+'.token'}})).statusCode);
  assert.equal(forged[30],429);
});

test('without TRUST_PROXY a spoofed X-Forwarded-For cannot open a new rate-limit bucket',async()=>{
  for(let i=0;i<10;i++)assert.equal((await login('nobody','1.1.1.'+i)).statusCode,401);
  assert.equal((await login('nobody','9.9.9.9')).statusCode,429);
});

test('with TRUST_PROXY=1 rate limits count each real client behind the gateway',async()=>{
  await app.close();await db.close();if(cleanup){await cleanup();cleanup=undefined;}
  process.env.TRUST_PROXY='1';await open();
  for(let i=0;i<10;i++)assert.equal((await login('nobody','203.0.113.7')).statusCode,401);
  assert.equal((await login('nobody','203.0.113.7')).statusCode,429);
  assert.equal((await login('nobody','198.51.100.8')).statusCode,401);
});

test('expiry reports cancelled orders so the worker can invalidate the catalog cache',async()=>{
  await request('POST','/api/cart',{productId:'p01',quantity:1});
  const order=(await request('POST','/api/orders',{addressId:'a-demo',deliverySlot:'尽快送达'},'member',{'idempotency-key':randomUUID()})).body.data;
  await db.run('UPDATE orders SET expires_at=? WHERE id=?',[Date.now()-1,order.id]);
  assert.equal(await ctx.orders.expire(),1);assert.equal(await ctx.orders.expire(),0);
});

test('partial refund events produce a specific member notification',async()=>{
  await ctx.runtime.consume({id:randomUUID(),topic:'order.partially_refunded',payload:{orderId:'FM-test',userId:'u-member'}});
  assert.equal((await db.one('SELECT title FROM notifications WHERE user_id=?',['u-member']))!.title,'部分退款已完成');
});

test('deleting the default address promotes the next address to default',async()=>{
  const second=(await request('POST','/api/addresses',{name:'第二地址',phone:'13900139000',detail:'上海市徐汇区 漕溪北路100号',isDefault:false})).body.data;
  assert.equal((await request('DELETE','/api/addresses/a-demo')).status,200);
  const list=(await request('GET','/api/addresses')).body.data;
  assert.equal(list.length,1);assert.equal(list[0].id,second.id);assert.equal(Number(list[0].is_default),1);
  assert.equal((await request('DELETE','/api/addresses/'+second.id)).status,200);
  assert.equal((await request('GET','/api/addresses')).body.data.length,0);
});
