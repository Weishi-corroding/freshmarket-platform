import { randomUUID } from 'node:crypto';
import type { Database } from '../../core/database.js';
import { ensure } from '../../core/errors.js';
import type { Runtime } from '../../core/runtime.js';
import { traceAttributes } from '../../core/tracing.js';
import type { OrderRepository } from '../orders/repository.js';
import type { OrderService } from '../orders/service.js';

// Redis 令牌闸门（可选）：名额耗尽时直接拒绝，不进入数据库事务；令牌60秒过期后按数据库重新校准。
// 闸门只用于削峰，是否成交始终以数据库条件更新为准。返回 -2 表示令牌不存在，回落到数据库判断。
const TAKE="local v=redis.call('GET',KEYS[1]) if not v then return -2 end if tonumber(v)<=0 then return -1 end return redis.call('DECR',KEYS[1])";
const GIVE="if redis.call('EXISTS',KEYS[1])==1 then return redis.call('INCR',KEYS[1]) end return 0";
export class SeckillService {
  constructor(private db:Database,private repo:OrderRepository,private orders:OrderService,private runtime:Runtime) {}
  private key=(id:string)=>`${this.runtime.cacheNamespace}:seckill:${id}:tokens`;
  async list(userId?:string) {
    const now=Date.now();
    const rows=await this.db.all('SELECT s.*,p.name,p.image,p.unit,p.price AS original_price,p.stock AS product_stock FROM seckill_activities s JOIN products p ON p.id=s.product_id WHERE s.active=1 AND s.end_at>? AND p.active=1 AND p.deleted_at IS NULL ORDER BY s.start_at,s.id',[now]);
    const joined=new Set(userId?(await this.db.all('SELECT activity_id FROM seckill_participants WHERE user_id=?',[userId])).map(row=>row.activity_id):[]);
    return {now,items:rows.map(({product_stock,...row})=>{
      const remaining=Math.max(0,Math.min(Number(row.stock)-Number(row.sold),Number(product_stock)));
      return {...row,remaining,status:Number(row.start_at)>now?'upcoming':remaining?'ongoing':'soldout',joined:joined.has(row.id)};
    })};
  }
  async acquire(id:string):Promise<'token'|'soldout'|'bypass'> {
    const redis=this.runtime.redis;if(!redis?.isReady)return 'bypass';
    try {
      if(await redis.get(this.key(id))===null) {
        const row=await this.db.one('SELECT stock-sold AS remaining FROM seckill_activities WHERE id=?',[id]);if(!row)return 'bypass';
        await redis.set(this.key(id),String(Math.max(0,Number(row.remaining))),{NX:true,EX:60});
      }
      const left=Number(await redis.eval(TAKE,{keys:[this.key(id)]}));
      return left===-1?'soldout':left===-2?'bypass':'token';
    } catch {return 'bypass';}
  }
  async release(id:string) {if(this.runtime.redis?.isReady)try {await this.runtime.redis.eval(GIVE,{keys:[this.key(id)]});} catch {}}
  async order(userId:string,id:string,key:string,input:{addressId:string;deliverySlot:string;note?:string},traceId:string) {
    const gate=await this.acquire(id);traceAttributes({'seckill.id':id,'seckill.gate':gate});
    ensure(gate!=='soldout',409,'SECKILL_SOLD_OUT','手慢了，秒杀名额已抢光');
    try {
      const {order,created}=await this.orders.seckill(userId,id,key,input,traceId);
      // 幂等重放没有新成交，退回本次拿到的令牌
      if(gate==='token' && !created)await this.release(id);
      return order;
    } catch(error) {if(gate==='token')await this.release(id);throw error;}
  }
  async adminList(query:any) {
    const page=query.page || 1,pageSize=query.pageSize || 20;
    const items=await this.db.all('SELECT s.*,p.name AS product_name,p.image,p.price AS original_price,p.stock AS product_stock FROM seckill_activities s JOIN products p ON p.id=s.product_id ORDER BY s.start_at DESC,s.id LIMIT ? OFFSET ?',[pageSize,(page-1)*pageSize]);
    return {items,total:Number((await this.db.one('SELECT COUNT(*) AS count FROM seckill_activities'))!.count),page,pageSize};
  }
  async save(input:any,actor:string,traceId:string,id?:string) {
    ensure(input.end_at>input.start_at,400,'INVALID_SECKILL','结束时间需晚于开始时间');
    const activityId=id || randomUUID();
    await this.db.transaction(async tx=>{
      const product=await tx.one('SELECT id,price FROM products WHERE id=? AND deleted_at IS NULL',[input.product_id]);
      ensure(product,400,'PRODUCT_NOT_FOUND','商品不存在');
      ensure(input.price<Number(product.price),400,'INVALID_SECKILL','秒杀价需低于商品当前售价');
      if(id) {
        const old=await tx.one('SELECT * FROM seckill_activities WHERE id=?'+(this.db.dialect==='postgres'?' FOR UPDATE':''),[id]);
        ensure(old,404,'SECKILL_NOT_FOUND','秒杀活动不存在');
        ensure(!Number(old.sold) || (old.product_id===input.product_id && Number(old.price)===input.price),409,'SECKILL_LOCKED','已有成交，不能修改商品和秒杀价');
        ensure(input.stock>=Number(old.sold),409,'INVALID_SECKILL',`秒杀名额不能少于已售出的${old.sold}件`);
        await tx.run('UPDATE seckill_activities SET product_id=?,title=?,price=?,stock=?,start_at=?,end_at=?,active=? WHERE id=?',[input.product_id,input.title,input.price,input.stock,input.start_at,input.end_at,input.active,id]);
      } else {
        ensure(input.end_at>Date.now(),400,'INVALID_SECKILL','结束时间需晚于当前时间');
        await tx.run('INSERT INTO seckill_activities(id,product_id,title,price,stock,start_at,end_at,active,created_at) VALUES(?,?,?,?,?,?,?,?,?)',[activityId,input.product_id,input.title,input.price,input.stock,input.start_at,input.end_at,input.active,Date.now()]);
      }
      await this.repo.audit(tx,actor,id?'seckill.update':'seckill.create',activityId,{productId:input.product_id,price:input.price,stock:input.stock,active:input.active},traceId);
    });
    // 名额或启停变化后删除令牌，下次请求按数据库重新校准
    if(this.runtime.redis?.isReady)try {await this.runtime.redis.del(this.key(activityId));} catch {}
    return this.db.one('SELECT * FROM seckill_activities WHERE id=?',[activityId]);
  }
}
