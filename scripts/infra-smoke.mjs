// Copy to /app/infra-smoke.mjs in the API container. All test resources have unique namespaces.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {buildApp} from './api/dist/app.js';
import {createDatabase} from './api/dist/core/database.js';
const schema='smoke_'+randomUUID().replaceAll('-','');
process.env.MQ_NAMESPACE=schema;process.env.CACHE_NAMESPACE=schema;
const pool=new Pool({connectionString:process.env.DATABASE_URL});
await pool.query('CREATE SCHEMA '+schema);
const url=new URL(process.env.DATABASE_URL);url.searchParams.set('options','-c search_path='+schema);
const db=await createDatabase(url.toString());let app,ctx;const checks=[];
try{
  ({app,ctx}=await buildApp({db,logger:false,workers:false}));
  await ctx.runtime.connect();assert.ok(ctx.runtime.redis?.isReady);assert.ok(ctx.runtime.channel);checks.push('Redis connection and authenticated RabbitMQ connection');
  const query={page:1,pageSize:12,sort:'default'};const catalog=await ctx.catalog.list(query);assert.equal(catalog.items.length,12);
  const cached=await ctx.runtime.redis.keys(schema+':catalog:*');assert.ok(cached.length);assert.ok(await ctx.runtime.redis.ttl(cached[0])>0);checks.push('Catalog cache persisted in Redis with TTL');
  await ctx.catalog.stock('p01',5,'u-admin','smoke-test','smoke');const refreshed=await ctx.catalog.list(query);assert.equal(refreshed.items.find(p=>p.id==='p01').stock,91);checks.push('Shared Redis version invalidation returns updated inventory');
  await ctx.accounts.setCart('u-member','p01',1,true);
  const order=await ctx.orders.create('u-member',randomUUID(),{addressId:'a-demo',deliverySlot:'尽快送达'},'smoke');assert.equal(order.status,'pending');checks.push('PostgreSQL transactional checkout');
  await ctx.runtime.flush();assert.equal((await db.one('SELECT status FROM outbox')).status,'sent');checks.push('RabbitMQ publisher confirms mark Outbox sent');
  let notified=false;for(let i=0;i<50;i++){if(Number((await db.one('SELECT COUNT(*) AS n FROM notifications')).n)===1){notified=true;break;}await new Promise(r=>setTimeout(r,100));}assert.ok(notified);checks.push('RabbitMQ consumer commits notification before ack');
  const event=await db.one('SELECT * FROM outbox');await ctx.runtime.consume({id:event.id,topic:event.topic,payload:JSON.parse(event.payload)});assert.equal(Number((await db.one('SELECT COUNT(*) AS n FROM notifications')).n),1);checks.push('Repeated RabbitMQ event produces one notification');
  await ctx.orders.cancel(order.id,'u-member','smoke');assert.equal(Number((await db.one('SELECT stock FROM products WHERE id=?',['p01'])).stock),91);await ctx.runtime.flush();
  assert.equal((await db.one('SELECT status FROM outbox WHERE topic=?',['order.cancelled'])).status,'sent');
  let cancelledNotified=false;for(let i=0;i<50;i++){if(Number((await db.one('SELECT COUNT(*) AS n FROM notifications')).n)===2){cancelledNotified=true;break;}await new Promise(r=>setTimeout(r,100));}assert.ok(cancelledNotified);checks.push('Cancellation stock reversal plus durable queue delivery');
  console.log(JSON.stringify({timestamp:new Date().toISOString(),database:'postgres',cache:'redis',broker:'rabbitmq',passed:checks.length,checks,isolatedSchema:true},null,2));
}finally{
  if(ctx?.runtime.channel){const ch=ctx.runtime.channel;await ch.deleteQueue(schema+'.notifications');await ch.deleteQueue(schema+'.dead');await ch.deleteExchange(schema+'.events');await ch.deleteExchange(schema+'.dead');}
  if(ctx?.runtime.redis?.isReady){const keys=await ctx.runtime.redis.keys(schema+':*');if(keys.length)await ctx.runtime.redis.del(keys);}
  if(app)await app.close();await db.close();await pool.query('DROP SCHEMA '+schema+' CASCADE');await pool.end();
}
