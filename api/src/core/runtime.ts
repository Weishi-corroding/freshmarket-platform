import { createClient, type RedisClientType } from 'redis';
import amqp, {type ConfirmChannel,type ChannelModel} from 'amqplib';
import { randomUUID } from 'node:crypto';
import type { Database, Row } from './database.js';
import type { OrderService } from '../modules/orders/service.js';
import type { FastifyBaseLogger } from 'fastify';
import { SpanKind, SpanStatusCode, type Context as TraceContext } from '@opentelemetry/api';
import { childSpan, extractContext, injectContext, withSpan } from './tracing.js';

export class Runtime {
  namespace=process.env.MQ_NAMESPACE || 'fresh';
  cacheNamespace=process.env.CACHE_NAMESPACE || 'fresh';
  redis?: RedisClientType; broker?: ChannelModel; channel?: ConfirmChannel;
  cacheVersion=0; timer?: ReturnType<typeof setInterval>; busy=false; stopping=false; connecting=false; lastConnect=0;
  constructor(private db:Database,private logger:FastifyBaseLogger) {}
  async connect() {
    if(this.connecting || this.stopping)return;
    this.connecting=true;
    try {
    this.lastConnect=Date.now();
    if(process.env.REDIS_URL && !this.redis?.isReady) {
      const redis=createClient({url:process.env.REDIS_URL,socket:{connectTimeout:3000,reconnectStrategy:false}});
      redis.on('error',err=>this.logger.warn({error:err.message},'redis_degraded'));
      try {await redis.connect();this.redis=redis as RedisClientType;} catch {this.logger.warn('cache_disabled');}
    }
    if(process.env.AMQP_URL && !this.channel) {
      let broker:ChannelModel|undefined;
      try {
        broker=await amqp.connect(process.env.AMQP_URL,{timeout:3000});this.broker=broker;
        const connection=broker;
        const disconnected=()=>{if(this.broker===connection){this.broker=undefined;this.channel=undefined;}this.logger.warn('broker_disconnected_outbox_will_wait');};
        const retire=()=>{disconnected();void connection.close().catch(()=>{});};
        broker.on('error',err=>{this.logger.warn({error:err.message},'broker_error');retire();});
        broker.on('close',disconnected);
        const ch=await broker.createConfirmChannel();
        ch.on('error',err=>{this.logger.warn({error:err.message},'channel_error');retire();});
        ch.on('close',()=>{if(this.broker===connection)retire();});
        const events=this.namespace+'.events',dead=this.namespace+'.dead',queue=this.namespace+'.notifications';
        await ch.assertExchange(events,'topic',{durable:true});
        await ch.assertExchange(dead,'fanout',{durable:true});
        await ch.assertQueue(dead,{durable:true});await ch.bindQueue(dead,dead,'');
        await ch.assertQueue(queue,{durable:true,arguments:{'x-dead-letter-exchange':dead}});
        await ch.bindQueue(queue,events,'order.*');await ch.prefetch(20);
        await ch.consume(queue,async message=>{
          if(!message){retire();return;}
          try {await this.consume(JSON.parse(message.content.toString()),extractContext(message.properties.headers));ch.ack(message);}
          catch(error){this.logger.error({error},'event_consume_failed');try {ch.nack(message,false,false);}catch {retire();}}
        });
        // 拓扑和消费者都已就绪，才允许发布与健康检查报告 connected。
        if(this.broker===connection && !this.stopping)this.channel=ch;
        else await connection.close().catch(()=>{});
      } catch(error){if(broker){if(this.broker===broker){this.broker=undefined;this.channel=undefined;}await broker.close().catch(()=>{});}this.logger.warn({error},'broker_degraded_outbox_will_wait');}
    }
    } finally {this.connecting=false;}
  }
  private publish(ch:ConfirmChannel,row:Row,event:unknown) {
    return new Promise<void>((resolve,reject)=>{
      let settled=false;
      const finish=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);ch.off('return',returned);ch.off('close',closed);ch.off('error',failed);error?reject(error):resolve();};
      const retire=()=>{if(this.channel===ch)this.channel=undefined;void ch.close().catch(()=>{});};
      const returned=(message:amqp.Message)=>{if(message.properties.messageId===row.id){finish(new Error('Message is unroutable'));retire();}};
      const closed=()=>finish(new Error('Publisher channel closed'));
      const failed=(error:Error)=>finish(error);
      const timer=setTimeout(()=>{finish(new Error('Publisher confirmation timed out'));retire();},5000);
      ch.on('return',returned);ch.on('close',closed);ch.on('error',failed);
      // RabbitMQ 对不可路由消息先发 basic.return 再确认；仅收到 confirm 不足以证明已入队。
      try {ch.publish(this.namespace+'.events',row.topic,Buffer.from(JSON.stringify(event)),{persistent:true,mandatory:true,messageId:row.id,headers:injectContext()},err=>finish(err || undefined));}catch(error){finish(error as Error);}
    });
  }
  async cacheGet(key:string) { const redis=this.redis;if(!redis?.isReady)return null;try {const s=await childSpan('redis GET',{'db.system.name':'redis','db.operation.name':'GET'},()=>redis.get(key));return s?JSON.parse(s):null;} catch{return null;} }
  async version() {if(this.redis?.isReady)try{return await this.redis.get(this.cacheNamespace+':catalog:version') || '0';}catch{}return String(this.cacheVersion);}
  async cacheSet(key:string,value:unknown) {const redis=this.redis;if(redis?.isReady)try {await childSpan('redis SET',{'db.system.name':'redis','db.operation.name':'SET'},()=>redis.set(key,JSON.stringify(value),{EX:30}));}catch{}}
  async invalidate() {this.cacheVersion++;if(this.redis?.isReady)try {await this.redis.incr(this.cacheNamespace+':catalog:version');}catch{}}
  async consume(event:{id:string;topic:string;payload:{orderId:string;userId:string}},parent?:TraceContext) {
    return withSpan(`event consume ${event.topic}`,{kind:SpanKind.CONSUMER,parent,attributes:{'messaging.destination.name':event.topic,'messaging.message.id':event.id}},()=>this.notify(event));
  }
  private async notify(event:{id:string;topic:string;payload:{orderId:string;userId:string}}) {
    const labels:Record<string,string>={'order.created':'订单提交成功','order.paid':'付款成功','order.cancelled':'订单已取消','order.picking':'商品正在拣货','order.delivering':'商品配送中','order.completed':'已确认收货','order.refunded':'退款已完成','order.partially_refunded':'部分退款已完成'};
    await this.db.transaction(async tx=>{
      const inserted=await tx.run('INSERT INTO processed_events(id,processed_at) VALUES(?,?) ON CONFLICT(id) DO NOTHING',[event.id,Date.now()]);
      if(!inserted)return;
      await tx.run('INSERT INTO notifications(id,user_id,title,body,created_at) VALUES(?,?,?,?,?)',[randomUUID(),event.payload.userId,labels[event.topic] || '订单更新',`订单 ${event.payload.orderId} 状态已更新`,Date.now()]);
    });
  }
  async flush() {
    // A configured broker never silently switches transport; unsent events stay durable until recovery.
    if(process.env.AMQP_URL && !this.channel)return;
    const events=await this.db.transaction(async tx=>{
      await tx.run("UPDATE outbox SET status='pending' WHERE status='processing' AND published_at<?",[Date.now()-60000]);
      const rows=await tx.all("SELECT * FROM outbox WHERE status='pending' ORDER BY created_at LIMIT 20"+(this.db.dialect==='postgres'?' FOR UPDATE SKIP LOCKED':''));
      for(const row of rows)await tx.run("UPDATE outbox SET status='processing',attempts=attempts+1,published_at=? WHERE id=?",[Date.now(),row.id]);
      return rows;
    });
    for(const row of events) {
      const event={id:row.id,topic:row.topic,payload:JSON.parse(row.payload)};
      let carrier={};try {carrier=JSON.parse(row.trace_context || '{}');} catch {}
      // 发布 span 挂在下单请求的 trace 下；RabbitMQ 消息头携带 traceparent，消费者继续同一条链路
      await withSpan(`outbox publish ${row.topic}`,{kind:SpanKind.PRODUCER,parent:extractContext(carrier),attributes:{'messaging.system':this.channel?'rabbitmq':'in-process','messaging.destination.name':row.topic,'messaging.message.id':row.id,'outbox.attempts':Number(row.attempts)+1}},async span=>{
        try {
          if(process.env.AMQP_URL) {
            if(!this.channel)throw new Error('Broker disconnected');
            await this.publish(this.channel,row,event);
          } else await this.consume(event);
          await this.db.run("UPDATE outbox SET status='sent',published_at=? WHERE id=?",[Date.now(),row.id]);
        } catch(error) {span.recordException(error as Error);span.setStatus({code:SpanStatusCode.ERROR,message:'outbox_retry'});await this.db.run("UPDATE outbox SET status='pending' WHERE id=?",[row.id]);this.logger.error({error,eventId:row.id},'outbox_retry');}
      });
    }
  }
  start(orders:OrderService) {
    this.timer=setInterval(async()=>{
      if(this.busy || this.stopping)return;this.busy=true;
      try {if(Date.now()-this.lastConnect>30000 && ((process.env.AMQP_URL&&!this.channel)||(process.env.REDIS_URL&&!this.redis?.isReady)))await this.connect();if(await orders.expire())await this.invalidate();await this.flush();}catch(error){this.logger.error({error},'worker_failed');}finally{this.busy=false;}
    },2000);this.timer.unref();
  }
  async stop() {
    this.stopping=true;if(this.timer)clearInterval(this.timer);
    while(this.busy)await new Promise(resolve=>setTimeout(resolve,10));
    if(this.channel)await this.channel.close().catch(()=>{});
    if(this.broker)await this.broker.close().catch(()=>{});
    if(this.redis?.isOpen)await this.redis.quit().catch(()=>{});
  }
}
