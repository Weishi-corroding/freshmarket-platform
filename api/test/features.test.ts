import {test,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {randomUUID} from 'node:crypto';
import {InMemorySpanExporter,SimpleSpanProcessor} from '@opentelemetry/sdk-trace-node';
import {initTracing} from '../src/core/tracing.js';
import {buildApp} from '../src/app.js';
import {createDatabase,type Database} from '../src/core/database.js';
import {quote} from '../src/modules/promotions/coupons.js';

// 内存导出器必须在 buildApp 之前注册，才能断言 span 结构
const spans=new InMemorySpanExporter();initTracing([new SimpleSpanProcessor(spans)]);
let app:Awaited<ReturnType<typeof buildApp>>['app'];
let ctx:Awaited<ReturnType<typeof buildApp>>['ctx'];
let db:Database;
let cleanup:(()=>Promise<void>)|undefined;
const headers=(role='member')=>({authorization:'Bearer '+app.jwt.sign({sub:'u-'+role,accountType:role==='member'?'member':'staff'})});
const request=async(method:any,url:string,payload?:any,role='member',extra:any={})=>{
  const response=await app.inject({method,url,payload,headers:{...headers(role),...extra}});
  return {status:response.statusCode,body:response.json(),headers:response.headers};
};
const cart=(id='p01',quantity=1,extra:any={})=>request('POST','/api/cart',{productId:id,quantity},'member',extra);
const checkout=(body:any={},extra:any={})=>request('POST','/api/orders',{addressId:'a-demo',deliverySlot:'尽快送达',...body},'member',{'idempotency-key':randomUUID(),...extra});
const buy=(id:string,extra:any={},addressId='a-demo')=>request('POST','/api/seckill/'+id+'/orders',{addressId,deliverySlot:'尽快送达'},'member',{'idempotency-key':randomUUID(),...extra});
async function paidOrder(items:[string,number][]){for(const [id,n] of items)await cart(id,n);const o=(await checkout()).body.data;assert.equal((await request('POST','/api/orders/'+o.id+'/pay')).status,200);return o;}
async function member(username:string){
  const user=await ctx.accounts.register({username,name:'会员'+username,password:'Secure12345'},'test'),auth={authorization:'Bearer '+app.jwt.sign({sub:user.id,accountType:'member'})};
  const address=(await request('POST','/api/addresses',{name:'测试',phone:'13800138000',detail:'上海市浦东新区测试路100号',isDefault:true},'member',auth)).body.data;
  return {user,auth,address};
}
const claim=async(couponId:string,extra:any={})=>(await request('POST','/api/coupons/'+couponId+'/claim',undefined,'member',extra));
const couponInput=(over:any={})=>({name:'测试满减券',kind:'amount',threshold:5000,value:1000,max_discount:0,category_id:'',total:100,valid_from:Date.now()-1000,valid_to:Date.now()+86400000,active:1,...over});
const seckillInput=(over:any={})=>({product_id:'p05',title:'蓝莓秒杀',price:990,stock:2,start_at:Date.now()-1000,end_at:Date.now()+3600000,active:1,...over});
beforeEach(async()=>{
  if(process.env.TEST_DATABASE_URL){
    const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL}),schema='test_'+randomUUID().replaceAll('-','');
    await pool.query('CREATE SCHEMA '+schema);const url=new URL(process.env.TEST_DATABASE_URL);url.searchParams.set('options','-c search_path='+schema);
    db=await createDatabase(url.toString());cleanup=async()=>{await pool.query('DROP SCHEMA '+schema+' CASCADE');await pool.end();};
  }else db=await createDatabase(undefined,':memory:');
  ({app,ctx}=await buildApp({db,logger:false,workers:false}));spans.reset();
});
afterEach(async()=>{await app.close();await db.close();if(cleanup){await cleanup();cleanup=undefined;}});

test('W3C trace context joins HTTP, SQL, audit and asynchronous outbox spans',async()=>{
  const traceId='4bf92f3577b34da6a3ce929d0e0e4736',parent='00f067aa0ba902b7',traceparent=`00-${traceId}-${parent}-01`;
  await cart();const response=await checkout({},{traceparent});
  assert.equal(response.status,200);assert.equal(response.body.traceId,traceId);assert.equal(response.headers['x-trace-id'],traceId);
  assert.equal((await db.one("SELECT trace_id FROM audit_logs WHERE action='order.create'"))!.trace_id,traceId);
  assert.ok((await db.one('SELECT trace_context FROM outbox'))!.trace_context.includes(traceId));
  const server=spans.getFinishedSpans().find(span=>span.name==='POST /api/orders')!;
  assert.equal(server.spanContext().traceId,traceId);assert.equal(server.parentSpanContext?.spanId,parent);
  assert.equal(server.attributes['http.route'],'/api/orders');assert.equal(server.attributes['enduser.id'],'u-member');
  assert.ok(spans.getFinishedSpans().some(span=>span.spanContext().traceId===traceId && span.attributes['order.id']===response.body.data.id));
  const sql=spans.getFinishedSpans().filter(span=>span.spanContext().traceId===traceId && /^(sqlite|postgres) /.test(span.name));
  assert.ok(sql.some(span=>span.name.endsWith('UPDATE') && String(span.attributes['db.query.text']).includes('stock=stock-?')));
  assert.ok(sql.every(span=>!JSON.stringify(span.attributes).includes('13800138000')),'SQL span 不记录参数值');
  // 异步发布与消费在 Outbox 之后继续同一条 trace
  await ctx.runtime.flush();
  const publish=spans.getFinishedSpans().find(span=>span.name==='outbox publish order.created')!,consume=spans.getFinishedSpans().find(span=>span.name==='event consume order.created')!;
  assert.equal(publish.spanContext().traceId,traceId);assert.equal(consume.spanContext().traceId,traceId);assert.equal(consume.parentSpanContext?.spanId,publish.spanContext().spanId);
  // 无上游上下文时新建 traceId；健康检查不产生 span
  const fresh=await request('GET','/api/products?pageSize=1');assert.match(fresh.body.traceId,/^[0-9a-f]{32}$/);assert.notEqual(fresh.body.traceId,traceId);
  spans.reset();const health=await request('GET','/api/health');assert.match(health.body.traceId,/^[0-9a-f]{32}$/);assert.equal(health.body.data.tracing,'local');assert.equal(spans.getFinishedSpans().length,0);
});
test('failing requests and expired orders keep traceable spans and audit trace ids',async()=>{
  const traceId='0af7651916cd43dd8448eb211c80319c';
  const missing=await request('GET','/api/orders/not-exist',undefined,'member',{traceparent:`00-${traceId}-b7ad6b7169203331-01`});
  assert.equal(missing.status,404);assert.equal(missing.body.traceId,traceId);
  assert.equal(spans.getFinishedSpans().find(span=>span.spanContext().traceId===traceId && span.kind===1)!.attributes['http.response.status_code'],404);
  await cart();const o=(await checkout()).body.data;await db.run('UPDATE orders SET expires_at=? WHERE id=?',[Date.now()-1,o.id]);await ctx.orders.expire();
  const audit=(await db.one("SELECT trace_id FROM audit_logs WHERE action='order.cancel'"))!;
  assert.match(audit.trace_id,/^[0-9a-f]{32}$/);assert.ok(spans.getFinishedSpans().some(span=>span.name==='order.expire' && span.spanContext().traceId===audit.trace_id));
});

test('search suggestions reuse fuzzy matching and hot keywords count real storefront searches',async()=>{
  const suggest=(await request('GET','/api/search/suggest?q='+encodeURIComponent('红颜草梅'))).body.data;
  assert.equal(suggest[0].id,'p01');assert.ok(suggest.length<=8);assert.equal(suggest[0].subtitle,undefined);
  assert.deepEqual((await request('GET','/api/search/suggest?q=%20')).body.data,[]);
  for(const q of ['牛排',' 牛排 ','牛排','草莓','完全不存在的商品'])await request('GET','/api/products?q='+encodeURIComponent(q));
  await request('GET','/api/products?q='+encodeURIComponent('车厘子')+'&page=2');await request('GET','/api/admin/products?q='+encodeURIComponent('车厘子'),undefined,'operator');
  const hot=(await request('GET','/api/search/hot')).body.data;
  assert.equal(hot[0],'牛排');assert.ok(hot.includes('草莓'));assert.ok(!hot.includes('完全不存在的商品'));assert.ok(!hot.includes('车厘子'));assert.equal(hot.length,8);
  assert.equal(Number((await db.one('SELECT COUNT(*) AS n FROM search_logs'))!.n),5);
});
test('related products rank paid co-purchases before same-category fallbacks',async()=>{
  await paidOrder([['p01',1],['p02',1]]);await paidOrder([['p01',1],['p02',1]]);await paidOrder([['p01',1],['p03',1]]);
  await cart('p01');await cart('p05');await checkout();
  const items=(await request('GET','/api/products/p01/related')).body.data;
  assert.equal(items.length,6);assert.deepEqual(items.slice(0,2).map((p:any)=>[p.id,p.reason,p.together]),[['p02','买了又买',2],['p03','买了又买',1]]);
  assert.ok(items.slice(2).every((p:any)=>p.reason==='同类推荐' && p.category_id==='fruit' && p.id!=='p01'));
  assert.equal((await request('GET','/api/products/missing/related')).status,404);
});
test('recommendations personalize by purchased and carted categories',async()=>{
  const anonymous=await app.inject({url:'/api/recommendations'});
  assert.equal(anonymous.json().data.length,8);assert.ok(anonymous.json().data.every((p:any)=>p.reason==='热销推荐'));
  assert.equal((await app.inject({url:'/api/recommendations',headers:{authorization:'Bearer invalid'}})).statusCode,200);
  await paidOrder([['p07',1]]);await cart('p08');
  const items=(await request('GET','/api/recommendations?limit=8')).body.data;
  assert.equal(items[0].category_id,'seafood');assert.ok(items.some((p:any)=>p.id==='p07' && p.reason==='您常买'));assert.ok(!items.some((p:any)=>p.id==='p08'));
  assert.ok(items.filter((p:any)=>p.category_id==='seafood').length>=6);
});

test('coupon allocation always sums to the discount and never exceeds a line',()=>{
  const lines=[{product_id:'a',category_id:'x',price:333,quantity:3},{product_id:'b',category_id:'x',price:101,quantity:1},{product_id:'c',category_id:'y',price:7777,quantity:1}];
  const scoped=quote({kind:'amount',threshold:1000,value:999,max_discount:0,category_id:'x'},lines);
  assert.equal(scoped.discount,999);assert.equal(Object.values(scoped.allocation).reduce((a,b)=>a+b,0),999);assert.equal(scoped.allocation.c,undefined);
  const percent=quote({kind:'percent',threshold:0,value:85,max_discount:0,category_id:null},lines);
  assert.equal(percent.discount,Math.floor((999+101+7777)*15/100));assert.equal(Object.values(percent.allocation).reduce((a,b)=>a+b,0),percent.discount);
  assert.match(quote({kind:'amount',threshold:99999,value:100,max_discount:0,category_id:null},lines).reason,/还差¥/);
});
test('coupons are claimed once per member and the issue quantity is never exceeded',async()=>{
  assert.equal((await request('POST','/api/admin/coupons',couponInput(),'warehouse')).status,403);
  const coupon=(await request('POST','/api/admin/coupons',couponInput({total:1}),'operator')).body.data;
  const other=await member('coupon_other');
  const results=await Promise.all([claim(coupon.id),claim(coupon.id,other.auth)]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(results.find(r=>r.status===409)!.body.code,'COUPON_SOLD_OUT');
  assert.equal(Number((await db.one('SELECT issued FROM coupons WHERE id=?',[coupon.id]))!.issued),1);assert.equal(Number((await db.one('SELECT COUNT(*) AS n FROM user_coupons WHERE coupon_id=?',[coupon.id]))!.n),1);
  const winner=results[0].status===200?{}:other.auth;assert.equal((await claim(coupon.id,winner)).body.code,'COUPON_CLAIMED');
  assert.equal((await claim('missing')).status,404);assert.equal((await claim('c-welcome',headers('operator'))).status,403);
  const anonymous=(await app.inject({url:'/api/coupons'})).json().data;assert.equal(anonymous.find((c:any)=>c.id==='c-welcome').claimed,false);
  await claim('c-welcome');assert.equal((await request('GET','/api/coupons')).body.data.find((c:any)=>c.id==='c-welcome').claimed,true);
  assert.ok((await request('GET','/api/my/coupons')).body.data.some((c:any)=>c.coupon_id==='c-welcome' && c.state==='unused'));
});
test('checkout applies the coupon, allocates the discount and computes delivery after discount',async()=>{
  const mine=(await claim('c-welcome')).body.data;await cart('p01',2);await cart('p02',2);
  const options=(await request('GET','/api/cart/coupons')).body.data;
  assert.equal(options.subtotal,9960);assert.deepEqual([options.items[0].id,options.items[0].applicable,options.items[0].discount,options.items[0].deliveryFee,options.items[0].total],[mine.id,true,1500,600,9060]);
  const order=(await checkout({couponId:mine.id})).body.data;
  assert.deepEqual([order.subtotal,order.discount,order.delivery_fee,order.total,order.coupon_id],[9960,1500,600,9060,mine.id]);
  assert.deepEqual(Object.fromEntries(order.items.map((i:any)=>[i.product_id,i.discount])),{p01:901,p02:599});
  assert.deepEqual({...await db.one('SELECT status,order_id FROM user_coupons WHERE id=?',[mine.id])},{status:'used',order_id:order.id});
  await cart('p01',4);assert.equal((await checkout({couponId:mine.id})).body.code,'COUPON_USED');
  const seafood=(await claim('c-seafood')).body.data,stock=(await db.one('SELECT stock FROM products WHERE id=?',['p01']))!.stock;
  const rejected=await checkout({couponId:seafood.id});assert.equal(rejected.status,409);assert.equal(rejected.body.code,'COUPON_NOT_APPLICABLE');
  assert.equal((await db.one('SELECT stock FROM products WHERE id=?',['p01']))!.stock,stock);assert.equal((await request('GET','/api/cart')).body.data.count,4);
  assert.equal((await request('GET','/api/cart/coupons')).body.data.items.find((c:any)=>c.id===seafood.id).applicable,false);
  const other=await member('coupon_thief');
  await request('POST','/api/cart',{productId:'p07',quantity:3},'member',other.auth);
  assert.equal((await request('POST','/api/orders',{addressId:other.address.id,deliverySlot:'尽快送达',couponId:seafood.id},'member',{...other.auth,'idempotency-key':randomUUID()})).body.code,'COUPON_INVALID');
});
test('cancel and full refund return coupons while partial refunds deduct allocated discounts',async()=>{
  const welcome=(await claim('c-welcome')).body.data;await cart('p01',2);await cart('p02',2);
  const first=(await checkout({couponId:welcome.id})).body.data;await request('POST','/api/orders/'+first.id+'/cancel');
  assert.deepEqual({...await db.one('SELECT status,order_id FROM user_coupons WHERE id=?',[welcome.id])},{status:'unused',order_id:null});
  await cart('p01',2);await cart('p02',2);const second=(await checkout({couponId:welcome.id})).body.data;await request('POST','/api/orders/'+second.id+'/pay');
  const refund=(await request('POST','/api/orders/'+second.id+'/refund',{reason:'凤梨有一个磕碰',items:[{productId:'p02',quantity:1}]})).body.data;
  assert.equal(refund.amount,1990-Math.ceil(599/2));
  await request('POST','/api/admin/refunds/'+refund.id+'/decision',{approve:true,note:'同意部分退款'},'support');
  assert.equal((await db.one('SELECT status FROM user_coupons WHERE id=?',[welcome.id]))!.status,'used');
  // 折扣券只作用于适用分类并受封顶限制；整单退款后退回优惠券
  const fruit=(await claim('c-fruit')).body.data;await cart('p04',4);await cart('p07',1);
  const third=(await checkout({couponId:fruit.id})).body.data;
  assert.equal(third.discount,2000);assert.equal(third.items.find((i:any)=>i.product_id==='p07').discount,0);assert.equal(third.total,5990*4+6990-2000);
  await request('POST','/api/orders/'+third.id+'/pay');
  const full=(await request('POST','/api/orders/'+third.id+'/refund',{reason:'临时出差无法收货'})).body.data;assert.equal(full.amount,third.total);
  await request('POST','/api/admin/refunds/'+full.id+'/decision',{approve:true,note:'同意整单退款'},'support');
  assert.equal((await db.one('SELECT status FROM user_coupons WHERE id=?',[fruit.id]))!.status,'unused');
});
test('administrators validate coupon rules and lock them after members claim',async()=>{
  assert.equal((await request('POST','/api/admin/coupons',couponInput({value:5000}),'operator')).body.code,'INVALID_COUPON');
  assert.equal((await request('POST','/api/admin/coupons',couponInput({kind:'percent',value:100}),'operator')).body.code,'INVALID_COUPON');
  assert.equal((await request('POST','/api/admin/coupons',couponInput({valid_to:Date.now()-2000,valid_from:Date.now()-5000}),'operator')).body.code,'INVALID_COUPON');
  assert.equal((await request('POST','/api/admin/coupons',couponInput({category_id:'nope'}),'operator')).body.code,'INVALID_CATEGORY');
  const coupon=(await request('POST','/api/admin/coupons',couponInput({total:5}),'admin')).body.data;
  assert.equal((await request('PUT','/api/admin/coupons/'+coupon.id,couponInput({value:800,total:5,valid_from:coupon.valid_from}),'operator')).status,200);
  await claim(coupon.id);await claim(coupon.id,(await member('coupon_two')).auth);
  const base=couponInput({value:800,total:5,valid_from:Number(coupon.valid_from)});
  assert.equal((await request('PUT','/api/admin/coupons/'+coupon.id,{...base,value:900},'operator')).body.code,'COUPON_LOCKED');
  assert.equal((await request('PUT','/api/admin/coupons/'+coupon.id,{...base,total:1},'operator')).body.code,'INVALID_COUPON');
  const stopped=(await request('PUT','/api/admin/coupons/'+coupon.id,{...base,name:'改名后的券',active:0},'operator')).body.data;
  assert.deepEqual([stopped.name,stopped.active],['改名后的券',0]);
  assert.equal((await claim(coupon.id,(await member('coupon_three')).auth)).body.code,'COUPON_SOLD_OUT');
  const list=(await request('GET','/api/admin/coupons?q='+encodeURIComponent('改名'),undefined,'operator')).body.data;assert.equal(list.total,1);assert.equal(list.items[0].issued,2);
  assert.ok(Number((await db.one("SELECT COUNT(*) AS n FROM audit_logs WHERE action IN ('coupon.create','coupon.update','coupon.claim')"))!.n)>=5);
});

test('seckill sells one unit per member at the activity price and releases quota on cancel',async()=>{
  const listed=(await app.inject({url:'/api/seckill'})).json().data.items.find((s:any)=>s.id==='sk-cherry');
  assert.deepEqual([listed.status,listed.remaining,listed.price,listed.original_price,listed.joined],['ongoing',20,3990,5990,false]);
  const stock=(await db.one('SELECT stock FROM products WHERE id=?',['p04']))!.stock,key=randomUUID();
  const first=await buy('sk-cherry',{'idempotency-key':key});
  assert.equal(first.status,200);const o=first.body.data;
  assert.deepEqual([o.seckill_id,o.items[0].price,o.subtotal,o.delivery_fee,o.total,Number(o.expires_at)-Number(o.created_at)],['sk-cherry',3990,3990,600,4590,5*60000]);
  assert.equal((await buy('sk-cherry',{'idempotency-key':key})).body.data.id,o.id);
  assert.equal((await buy('sk-cherry')).body.code,'SECKILL_LIMIT');
  assert.equal(Number((await db.one('SELECT sold FROM seckill_activities WHERE id=?',['sk-cherry']))!.sold),1);assert.equal((await db.one('SELECT stock FROM products WHERE id=?',['p04']))!.stock,stock-1);
  const mine=(await request('GET','/api/seckill')).body.data.items.find((s:any)=>s.id==='sk-cherry');assert.deepEqual([mine.joined,mine.remaining],[true,19]);
  const home=(await request('GET','/api/promotions')).body.data;assert.equal(home.seckill.find((s:any)=>s.id==='sk-cherry').joined,true);assert.ok(home.coupons.some((c:any)=>c.id==='c-welcome'));assert.equal(typeof home.now,'number');
  assert.equal((await request('GET','/api/cart')).body.data.count,0);
  await request('POST','/api/orders/'+o.id+'/cancel');
  assert.equal(Number((await db.one('SELECT sold FROM seckill_activities WHERE id=?',['sk-cherry']))!.sold),0);assert.equal((await db.one('SELECT stock FROM products WHERE id=?',['p04']))!.stock,stock);
  assert.equal((await buy('sk-cherry')).status,200);
  assert.equal((await request('POST','/api/seckill/sk-cherry/orders',{addressId:'a-demo',deliverySlot:'尽快送达',couponId:'x'},'member',{'idempotency-key':randomUUID()})).status,400);
  assert.equal((await buy('sk-cherry',headers('operator'))).body.code,'MEMBER_ONLY');
});
test('seckill enforces its time window and expired orders release quota',async()=>{
  const upcoming=(await request('POST','/api/admin/seckill',seckillInput({start_at:Date.now()+3600000,end_at:Date.now()+7200000}),'operator')).body.data;
  assert.equal((await request('GET','/api/seckill')).body.data.items.find((s:any)=>s.id===upcoming.id).status,'upcoming');
  assert.equal((await buy(upcoming.id)).body.code,'SECKILL_NOT_STARTED');assert.equal((await buy('missing')).body.code,'SECKILL_NOT_FOUND');
  await db.run('UPDATE seckill_activities SET start_at=?,end_at=? WHERE id=?',[Date.now()-7200000,Date.now()-1000,upcoming.id]);assert.equal((await buy(upcoming.id)).body.code,'SECKILL_ENDED');
  const o=(await buy('sk-cherry')).body.data;await db.run('UPDATE orders SET expires_at=? WHERE id=?',[Date.now()-1,o.id]);await ctx.orders.expire();
  assert.equal((await db.one('SELECT status FROM orders WHERE id=?',[o.id]))!.status,'cancelled');
  assert.equal(Number((await db.one('SELECT sold FROM seckill_activities WHERE id=?',['sk-cherry']))!.sold),0);assert.equal(Number((await db.one('SELECT COUNT(*) AS n FROM seckill_participants'))!.n),0);
  // 付款后整单退款不归还秒杀名额
  const paid=(await buy('sk-cherry')).body.data;await request('POST','/api/orders/'+paid.id+'/pay');
  const refund=(await request('POST','/api/orders/'+paid.id+'/refund',{reason:'买错了需要退款'})).body.data;await request('POST','/api/admin/refunds/'+refund.id+'/decision',{approve:true,note:'同意退款'},'support');
  assert.equal(Number((await db.one('SELECT sold FROM seckill_activities WHERE id=?',['sk-cherry']))!.sold),1);assert.equal((await buy('sk-cherry')).body.code,'SECKILL_LIMIT');
});
test('concurrent seckill buyers never exceed the activity quota',async()=>{
  const activity=(await request('POST','/api/admin/seckill',seckillInput(),'operator')).body.data,stock=(await db.one('SELECT stock FROM products WHERE id=?',['p05']))!.stock;
  const buyers=[{auth:{},address:{id:'a-demo'}},...await Promise.all(['sk_a','sk_b','sk_c','sk_d'].map(member))];
  const results=await Promise.all(buyers.map(b=>buy(activity.id,b.auth,b.address.id)));
  assert.deepEqual(results.map(r=>r.status).sort(),[200,200,409,409,409]);assert.ok(results.filter(r=>r.status===409).every(r=>r.body.code==='SECKILL_SOLD_OUT'));
  assert.equal(Number((await db.one('SELECT sold FROM seckill_activities WHERE id=?',[activity.id]))!.sold),2);assert.equal(Number((await db.one('SELECT COUNT(*) AS n FROM seckill_participants WHERE activity_id=?',[activity.id]))!.n),2);
  assert.equal((await db.one('SELECT stock FROM products WHERE id=?',['p05']))!.stock,stock-2);
  assert.equal((await request('GET','/api/seckill')).body.data.items.find((s:any)=>s.id===activity.id).status,'soldout');
});
test('seckill administration validates prices, windows and locks sold activities',async()=>{
  assert.equal((await request('POST','/api/admin/seckill',seckillInput(),'warehouse')).status,403);
  assert.equal((await request('POST','/api/admin/seckill',seckillInput({price:1590}),'operator')).body.code,'INVALID_SECKILL');
  assert.equal((await request('POST','/api/admin/seckill',seckillInput({end_at:Date.now()-2000}),'operator')).body.code,'INVALID_SECKILL');
  assert.equal((await request('POST','/api/admin/seckill',seckillInput({product_id:'missing'}),'operator')).body.code,'PRODUCT_NOT_FOUND');
  const activity=(await request('POST','/api/admin/seckill',seckillInput({stock:5}),'admin')).body.data,base=seckillInput({stock:5,start_at:Number(activity.start_at),end_at:Number(activity.end_at)});
  await buy(activity.id);
  assert.equal((await request('PUT','/api/admin/seckill/'+activity.id,{...base,price:890},'operator')).body.code,'SECKILL_LOCKED');
  assert.equal((await request('PUT','/api/admin/seckill/'+activity.id,{...base,stock:0},'operator')).status,400);
  const edited=(await request('PUT','/api/admin/seckill/'+activity.id,{...base,title:'加量秒杀',stock:10,active:0},'operator')).body.data;
  assert.deepEqual([edited.title,edited.stock,edited.active],['加量秒杀',10,0]);
  const late=await member('sk_late');assert.equal((await buy(activity.id,late.auth,late.address.id)).body.code,'SECKILL_NOT_FOUND');
  const list=(await request('GET','/api/admin/seckill',undefined,'operator')).body.data;assert.ok(list.items.some((s:any)=>s.id===activity.id && s.sold===1));
});
