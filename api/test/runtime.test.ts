import {test,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import amqp from 'amqplib';
import {buildApp} from '../src/app.js';
import {createDatabase} from '../src/core/database.js';

class Channel extends EventEmitter {
  callback:any; behavior:(channel:Channel,options:any,confirm:(error?:Error)=>void)=>void=(_ch,_options,confirm)=>confirm();
  async assertExchange(){} async assertQueue(){} async bindQueue(){} async prefetch(){}
  async consume(_queue:string,callback:any){this.callback=callback;}
  publish(_exchange:string,_topic:string,_body:Buffer,options:any,confirm:any){assert.equal(options.mandatory,true);this.behavior(this,options,confirm);return true;}
  ack(){} nack(){}
  async close(){this.emit('close');}
}
class Broker extends EventEmitter {
  closed=false;
  constructor(public channel=new Channel()){super();}
  async createConfirmChannel(){return this.channel;}
  async close(){if(!this.closed){this.closed=true;this.emit('close');}}
}
let db:Awaited<ReturnType<typeof createDatabase>>;
let app:Awaited<ReturnType<typeof buildApp>>['app'];
let runtime:Awaited<ReturnType<typeof buildApp>>['ctx']['runtime'];
let originalAmqp:string|undefined,originalRedis:string|undefined;
let databaseFailed=false;
beforeEach(async()=>{
  originalAmqp=process.env.AMQP_URL;originalRedis=process.env.REDIS_URL;
  delete process.env.AMQP_URL;delete process.env.REDIS_URL;databaseFailed=false;
  db=await createDatabase(undefined,':memory:');
  const one=db.one.bind(db);db.one=async(sql,params)=>{if(databaseFailed)throw new Error('database unavailable');return one(sql,params);};
  const built=await buildApp({db,logger:false,workers:false});app=built.app;runtime=built.ctx.runtime;
});
afterEach(async()=>{
  await app.close();await db.close();
  if(originalAmqp===undefined)delete process.env.AMQP_URL;else process.env.AMQP_URL=originalAmqp;
  if(originalRedis===undefined)delete process.env.REDIS_URL;else process.env.REDIS_URL=originalRedis;
});
async function event(){const id=randomUUID();await db.run('INSERT INTO outbox(id,topic,payload,created_at) VALUES(?,?,?,?)',[id,'order.created',JSON.stringify({orderId:'test',userId:'u-member'}),Date.now()-120000]);return id;}
async function status(id:string){return (await db.one('SELECT status FROM outbox WHERE id=?',[id]))!.status;}
function connectMock(t:any,brokers:Broker[]){process.env.AMQP_URL='amqp://test.invalid';let n=0;t.mock.method(amqp,'connect',async()=>{assert.ok(n<brokers.length,'unexpected reconnect');return brokers[n++] as any;});}

test('channel-only closure rebuilds the connection; late old close cannot clear the new channel',async t=>{
  const old=new Broker(),next=new Broker();connectMock(t,[old,next]);
  await runtime.connect();assert.equal(runtime.channel,old.channel);
  await old.channel.close();assert.equal(runtime.channel,undefined);assert.equal(old.closed,true);
  await runtime.connect();assert.equal(runtime.channel,next.channel);
  old.emit('close');old.channel.emit('close');assert.equal(runtime.channel,next.channel);
});

test('topology setup failure closes the partial connection and permits retry',async t=>{
  const broken=new Broker(),next=new Broker();broken.channel.assertQueue=async()=>{throw new Error('queue declaration failed');};connectMock(t,[broken,next]);
  await runtime.connect();assert.equal(runtime.channel,undefined);assert.equal(broken.closed,true);
  await runtime.connect();assert.equal(runtime.channel,next.channel);
});

test('channel errors and consumer cancellation retire the connection and recover',async t=>{
  const first=new Broker(),second=new Broker(),third=new Broker();connectMock(t,[first,second,third]);
  await runtime.connect();first.channel.emit('error',new Error('channel failure'));assert.equal(runtime.channel,undefined);
  await runtime.connect();await second.channel.callback(null);assert.equal(runtime.channel,undefined);assert.equal(second.closed,true);
  await runtime.connect();assert.equal(runtime.channel,third.channel);
});

test('unroutable return followed by a positive confirm keeps the event pending; retry can succeed',async t=>{
  const broker=new Broker(),next=new Broker();connectMock(t,[broker,next]);await runtime.connect();const id=await event();
  broker.channel.behavior=(ch,options,confirm)=>{ch.emit('return',{properties:{messageId:options.messageId}});confirm();};
  await runtime.flush();assert.equal(await status(id),'pending');
  assert.equal(broker.channel.listenerCount('return'),0);
  assert.equal(runtime.channel,undefined);await runtime.connect();await runtime.flush();assert.equal(await status(id),'sent');
  assert.equal(Number((await db.one('SELECT attempts FROM outbox WHERE id=?',[id]))!.attempts),2);
});

test('a disconnect during a batch never switches the remaining events to local consumption',async t=>{
  const broker=new Broker();connectMock(t,[broker]);await runtime.connect();const first=await event(),second=await event();
  broker.channel.behavior=ch=>{void ch.close();};
  await runtime.flush();assert.equal(await status(first),'pending');assert.equal(await status(second),'pending');
  assert.equal(Number((await db.one('SELECT COUNT(*) AS n FROM notifications'))!.n),0);
});

test('negative confirms and synchronous publish errors keep events retryable without listener leaks',async t=>{
  const broker=new Broker();connectMock(t,[broker]);await runtime.connect();const id=await event();
  for(const behavior of [(_ch:Channel,_options:any,confirm:any)=>confirm(new Error('nack')),()=>{throw new Error('closed');}]){
    broker.channel.behavior=behavior;await runtime.flush();assert.equal(await status(id),'pending');assert.equal(broker.channel.listenerCount('return'),0);
  }
});

test('missing confirms time out and release the worker for a later reconnect',async t=>{
  const broker=new Broker();connectMock(t,[broker]);await runtime.connect();const id=await event();
  t.mock.timers.enable({apis:['setTimeout']});
  let published!:()=>void;const started=new Promise<void>(resolve=>{published=resolve;});broker.channel.behavior=()=>published();
  const flushing=runtime.flush();await started;t.mock.timers.tick(5000);await flushing;
  assert.equal(await status(id),'pending');assert.equal(runtime.channel,undefined);assert.equal(broker.closed,true);assert.equal(broker.channel.listenerCount('return'),0);
});

test('metrics distinguish a successful scrape from database failure and configured dependency outages',async()=>{
  const id=await event();let response=await app.inject('/api/metrics');
  assert.equal(response.statusCode,200);assert.match(response.body,/fresh_dependency_up\{dependency="database"\} 1/);
  assert.doesNotMatch(response.body,/dependency="(?:cache|queue)"/);
  assert.ok(Number(response.body.match(/^fresh_outbox_oldest_pending_seconds (\S+)/m)![1])>=120);
  process.env.AMQP_URL='amqp://test.invalid';process.env.REDIS_URL='redis://test.invalid';databaseFailed=true;
  assert.equal((await app.inject('/api/health')).statusCode,500);
  response=await app.inject('/api/metrics');assert.equal(response.statusCode,200);
  for(const dependency of ['database','cache','queue'])assert.ok(response.body.includes(`fresh_dependency_up{dependency="${dependency}"} 0`));
  assert.match(response.body,/^fresh_outbox_oldest_pending_seconds nan$/mi);
  databaseFailed=false;await db.run("UPDATE outbox SET status='sent' WHERE id=?",[id]);
  response=await app.inject('/api/metrics');assert.match(response.body,/fresh_dependency_up\{dependency="database"\} 1/);assert.match(response.body,/fresh_outbox_oldest_pending_seconds 0/);
});
