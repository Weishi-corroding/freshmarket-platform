import { createHash, randomUUID } from 'node:crypto';
import { OrderRepository } from './repository.js';
import { ensure } from '../../core/errors.js';
import type { Query, Row } from '../../core/database.js';
import { traceAttributes, withSpan } from '../../core/tracing.js';
import { deliveryFee, lockCoupon, markCouponUsed } from '../promotions/coupons.js';

type Checkout = {addressId: string; deliverySlot: string; note?: string};
const digest = (value: unknown[]) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class OrderService {
  constructor(public repo: OrderRepository, private ttlMinutes = 15, private seckillTtlMinutes = 5) {}
  // In PostgreSQL, locking the member serializes their checkout, including the first idempotency insert.
  private async begin(tx: Query, userId: string, key: string, fingerprint: string): Promise<string | undefined> {
    const member=await tx.one('SELECT id,role FROM users WHERE id=?' + (this.repo.db.dialect === 'postgres' ? ' FOR UPDATE' : ''),[userId]);
    ensure(member?.role==='member',403,'MEMBER_ONLY','仅会员账号可以下单');
    ensure(await tx.one('SELECT id FROM users WHERE id=? AND active=1 AND deleted_at IS NULL',[userId]),401,'UNAUTHORIZED','账号不可用');
    const existing = await tx.one('SELECT id,request_hash FROM orders WHERE user_id=? AND idempotency_key=?',[userId,key]);
    if (existing) { ensure(existing.request_hash === fingerprint,409,'IDEMPOTENCY_CONFLICT','同一请求标识不能用于不同订单'); return existing.id; }
  }
  private async address(tx: Query, userId: string, addressId: string) {
    const address = await tx.one('SELECT * FROM addresses WHERE id=? AND user_id=?',[addressId,userId]);
    ensure(address,400,'ADDRESS_INVALID','请选择有效的收货地址');
    return {name: address.name,phone: address.phone,detail: address.detail};
  }
  // 写订单金额/地址/商品快照（含每行优惠分摊）、审计与 Outbox，调用方已完成库存扣减
  private async insert(tx: Query, o: {userId: string; key: string; fingerprint: string; input: Checkout; snapshot: object; lines: Row[]; discount: number; couponId?: string; seckillId?: string; ttl: number}, traceId: string) {
    const subtotal = o.lines.reduce((sum,p) => sum + p.price*p.quantity,0), fee = deliveryFee(subtotal-o.discount), total = subtotal-o.discount+fee;
    const orderId = `FM${Date.now()}${randomUUID().slice(0,8)}`, now = Date.now();
    await tx.run('INSERT INTO orders(id,user_id,status,subtotal,delivery_fee,total,discount,coupon_id,seckill_id,address_snapshot,delivery_slot,note,idempotency_key,request_hash,created_at,expires_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [orderId,o.userId,'pending',subtotal,fee,total,o.discount,o.couponId || null,o.seckillId || null,JSON.stringify(o.snapshot),o.input.deliverySlot,o.input.note || '',o.key,o.fingerprint,now,now+o.ttl*60000,now]);
    for (const p of o.lines) await tx.run('INSERT INTO order_items(id,order_id,product_id,name,image,unit,price,quantity,discount) VALUES(?,?,?,?,?,?,?,?,?)',[randomUUID(),orderId,p.id,p.name,p.image,p.unit,p.price,p.quantity,p.discount || 0]);
    await this.repo.audit(tx,o.userId,'order.create',orderId,{total,...(o.discount?{discount:o.discount,couponId:o.couponId}:{}),...(o.seckillId?{seckillId:o.seckillId}:{})},traceId);
    await this.repo.emit(tx,'order.created',{orderId,userId:o.userId});
    traceAttributes({'order.id':orderId,'order.total':total,'order.discount':o.discount});
    return orderId;
  }
  async create(userId: string, key: string, input: Checkout & {couponId?: string}, traceId: string) {
    const fingerprint = digest([input.addressId,input.deliverySlot,input.note || '',...(input.couponId?[input.couponId]:[])]);
    const id = await this.repo.db.transaction(async tx => {
      const existing = await this.begin(tx,userId,key,fingerprint);
      if (existing) return existing;
      const snapshot = await this.address(tx,userId,input.addressId);
      const cart = await tx.all('SELECT p.*,c.quantity FROM cart_items c JOIN products p ON p.id=c.product_id WHERE c.user_id=? ORDER BY p.id',[userId]);
      ensure(cart.length,400,'CART_EMPTY','购物车还是空的');
      const coupon = input.couponId ? await lockCoupon(tx,userId,input.couponId,cart.map(p => ({product_id:p.id,category_id:p.category_id,price:p.price,quantity:p.quantity}))) : undefined;
      for (const product of cart) {
        const changed = await tx.run('UPDATE products SET stock=stock-? WHERE id=? AND active=1 AND deleted_at IS NULL AND stock>=?',[product.quantity,product.id,product.quantity]);
        ensure(changed === 1,409,'OUT_OF_STOCK',`${product.name}库存不足或已下架，请调整购物车`);
      }
      const orderId = await this.insert(tx,{userId,key,fingerprint,input,snapshot,lines:cart.map(p => ({...p,discount:coupon?.allocation[p.id] || 0})),discount:coupon?.discount || 0,couponId:input.couponId,ttl:this.ttlMinutes},traceId);
      if (input.couponId) await markCouponUsed(tx,userId,input.couponId,orderId);
      await tx.run('DELETE FROM cart_items WHERE user_id=?',[userId]);
      return orderId;
    });
    return this.repo.detail(id,userId);
  }
  // 秒杀下单：不经过购物车，每人每场限1件；活动名额与商品库存都用条件更新扣减，任一失败整单回滚
  async seckill(userId: string, activityId: string, key: string, input: Checkout, traceId: string) {
    const fingerprint = digest(['seckill',activityId,input.addressId,input.deliverySlot,input.note || '']);
    let created = false;
    const id = await this.repo.db.transaction(async tx => {
      const existing = await this.begin(tx,userId,key,fingerprint);
      if (existing) return existing;
      const snapshot = await this.address(tx,userId,input.addressId), now = Date.now();
      const activity = await tx.one('SELECT * FROM seckill_activities WHERE id=? AND active=1',[activityId]);
      ensure(activity,404,'SECKILL_NOT_FOUND','秒杀活动不存在或已结束');
      ensure(Number(activity.start_at) <= now,409,'SECKILL_NOT_STARTED','秒杀尚未开始，请稍后再来');
      ensure(Number(activity.end_at) > now,409,'SECKILL_ENDED','本场秒杀已结束');
      ensure(!await tx.one('SELECT order_id FROM seckill_participants WHERE activity_id=? AND user_id=?',[activityId,userId]),409,'SECKILL_LIMIT','每人限购1件，您已参与过本场秒杀');
      ensure(await tx.run('UPDATE seckill_activities SET sold=sold+1 WHERE id=? AND active=1 AND sold<stock AND start_at<=? AND end_at>?',[activityId,now,now]) === 1,409,'SECKILL_SOLD_OUT','手慢了，秒杀名额已抢光');
      ensure(await tx.run('UPDATE products SET stock=stock-1 WHERE id=? AND active=1 AND deleted_at IS NULL AND stock>=1',[activity.product_id]) === 1,409,'SECKILL_SOLD_OUT','商品库存不足或已下架');
      const product = (await tx.one('SELECT * FROM products WHERE id=?',[activity.product_id]))!;
      const orderId = await this.insert(tx,{userId,key,fingerprint,input,snapshot,lines:[{...product,price:Number(activity.price),quantity:1}],discount:0,seckillId:activityId,ttl:this.seckillTtlMinutes},traceId);
      // 主键 (activity_id,user_id) 兜底并发重复抢购
      ensure(await tx.run('INSERT INTO seckill_participants(activity_id,user_id,order_id,created_at) VALUES(?,?,?,?) ON CONFLICT(activity_id,user_id) DO NOTHING',[activityId,userId,orderId,now]) === 1,409,'SECKILL_LIMIT','每人限购1件，您已参与过本场秒杀');
      created = true;
      return orderId;
    });
    return {order: await this.repo.detail(id,userId),created};
  }
  async pay(id: string,userId: string,traceId: string) {
    await this.repo.db.transaction(async tx => {
      const order = await this.repo.get(tx,id,true);
      ensure(order.user_id === userId,404,'ORDER_NOT_FOUND','订单不存在');
      if (await tx.one('SELECT id FROM payments WHERE order_id=?',[id])) { ensure(order.status !== 'refunded',409,'ORDER_REFUNDED','订单已退款'); return; }
      ensure(order.status === 'pending',409,'INVALID_STATE','当前订单不可支付');
      ensure(Number(order.expires_at) > Date.now(),409,'ORDER_EXPIRED','支付已超时，请重新下单');
      await tx.run('INSERT INTO payments(id,order_id,amount,status,created_at) VALUES(?,?,?,?,?)',[randomUUID(),id,order.total,'success',Date.now()]);
      await tx.run('UPDATE orders SET status=?,updated_at=? WHERE id=?',['paid',Date.now(),id]);
      for (const item of await tx.all('SELECT product_id,quantity FROM order_items WHERE order_id=? ORDER BY product_id',[id])) await tx.run('UPDATE products SET sales=sales+? WHERE id=?',[item.quantity,item.product_id]);
      await this.repo.emit(tx,'order.paid',{orderId:id,userId});
      await this.repo.audit(tx,userId,'payment.sandbox',id,{amount:order.total},traceId);
    }); return this.repo.detail(id,userId);
  }
  async cancel(id: string,userId?: string,traceId = 'scheduler',staffActor?:string) {
    await this.repo.db.transaction(async tx => {
      const order = await this.repo.get(tx,id,true);
      ensure(!userId || order.user_id === userId,404,'ORDER_NOT_FOUND','订单不存在');
      if (order.status === 'cancelled') return;
      // Scheduler checks expiry inside the row lock to avoid racing a payment.
      if (!userId && !staffActor && (order.status !== 'pending' || Number(order.expires_at) > Date.now())) return;
      ensure(order.status === 'pending',409,'INVALID_STATE','仅待付款订单可取消');
      await this.repo.restock(tx,id);
      await this.repo.releaseCoupon(tx,id);
      await this.repo.releaseSeckill(tx,order);
      await tx.run('UPDATE orders SET status=?,updated_at=? WHERE id=?',['cancelled',Date.now(),id]);
      await this.repo.emit(tx,'order.cancelled',{orderId:id,userId:order.user_id});
      await this.repo.audit(tx,staffActor || userId || 'system','order.cancel',id,{},traceId);
    }); return this.repo.detail(id,userId);
  }
  async updateDelivery(id:string,input:{name:string;phone:string;detail:string;deliverySlot:string;note:string},actor:string,traceId:string) {
    await this.repo.db.transaction(async tx=>{
      const order=await this.repo.get(tx,id,true);
      ensure(['pending','paid'].includes(order.status),409,'INVALID_STATE','仅待付款或待拣货订单可以修改配送信息');
      ensure(!await tx.one("SELECT id FROM refunds WHERE order_id=? AND status='pending'",[id]),409,'REFUND_PENDING','售后处理中，暂不能修改配送信息');
      const old=JSON.parse(order.address_snapshot);
      // Staff see masked phones. Omitting a replacement keeps the original phone intact.
      const address={name:input.name.trim(),phone:input.phone || old.phone,detail:input.detail.trim()};
      ensure(address.name && address.detail.length>=8,400,'ADDRESS_INVALID','请填写完整的收货信息');
      await tx.run('UPDATE orders SET address_snapshot=?,delivery_slot=?,note=?,updated_at=? WHERE id=?',[JSON.stringify(address),input.deliverySlot,input.note,Date.now(),id]);
      await this.repo.audit(tx,actor,'order.delivery.update',id,{deliverySlot:input.deliverySlot,phoneChanged:!!input.phone},traceId);
    });
    return this.repo.detail(id);
  }
  async remove(id:string,actor:string,traceId:string) {
    await this.repo.db.transaction(async tx=>{
      const order=await this.repo.get(tx,id,true);
      ensure(order.status==='cancelled',409,'INVALID_STATE','仅已取消且未付款的错误订单可以删除，请先取消待付款订单');
      for(const table of ['payments','refunds','settlements'])ensure(!await tx.one(`SELECT id FROM ${table} WHERE order_id=?`,[id]),409,'ORDER_HAS_TRANSACTIONS','有支付、售后或结算记录的订单不能删除');
      await tx.run('UPDATE orders SET deleted_at=?,updated_at=? WHERE id=?',[Date.now(),Date.now(),id]);
      await this.repo.audit(tx,actor,'order.delete',id,{status:order.status,total:order.total},traceId);
    });
  }
  async transition(id: string,target: string,actor: string,traceId: string,member = false) {
    await this.repo.db.transaction(async tx => {
      const order = await this.repo.get(tx,id,true);
      ensure(!member || order.user_id === actor,404,'ORDER_NOT_FOUND','订单不存在');
      const map: Record<string,string> = member ? {delivering:'completed'} : {paid:'picking',picking:'delivering'};
      ensure(map[order.status] === target,409,'INVALID_STATE','订单状态不允许此操作');
      ensure(!await tx.one("SELECT id FROM refunds WHERE order_id=? AND status='pending'",[id]),409,'REFUND_PENDING','售后处理中，请先处理退款');
      await tx.run('UPDATE orders SET status=?,updated_at=? WHERE id=?',[target,Date.now(),id]);
      await this.repo.emit(tx,`order.${target}`,{orderId:id,userId:order.user_id});
      await this.repo.audit(tx,actor,'order.transition',id,{from:order.status,to:target},traceId);
    }); return this.repo.detail(id,member ? actor : undefined);
  }
  async requestRefund(id: string,userId: string,input: {reason:string;amount?:number;items?:{productId:string;quantity:number}[]},traceId: string) {
    return this.repo.db.transaction(async tx => {
      const order = await this.repo.get(tx,id,true);
      ensure(order.user_id === userId,404,'ORDER_NOT_FOUND','订单不存在');
      ensure(['paid','picking','delivering','completed'].includes(order.status),409,'INVALID_STATE','该订单不能申请退款');
      ensure(!await tx.one('SELECT id FROM settlements WHERE order_id=?',[id]),409,'ALREADY_SETTLED','订单已结算，请联系客服人工处理');
      const existing = await tx.one('SELECT * FROM refunds WHERE order_id=?',[id]);
      if (existing) return existing;
      const orderItems = await tx.all('SELECT product_id,price,quantity,discount FROM order_items WHERE order_id=?',[id]);
      const requested = (input.items || []).filter(item => item.quantity > 0);
      // 默认整单退款；传入 items 时按所选商品计算金额；传入 amount 时按指定金额（不调整库存）
      let amount = order.total, refundItems: {productId:string;quantity:number}[] = [];
      if (requested.length) {
        const merged: Record<string,number> = {};
        for (const item of requested) {
          const ordered = orderItems.find(o => o.product_id === item.productId);
          ensure(ordered,400,'INVALID_PRODUCT','退款商品不在订单中');
          ensure(item.quantity <= ordered.quantity,400,'INVALID_REFUND_QUANTITY','退款数量不能超过购买数量');
          merged[item.productId] = (merged[item.productId] || 0) + item.quantity;
        }
        refundItems = Object.entries(merged).map(([productId,quantity]) => ({productId,quantity}));
        // 使用优惠券的订单按行分摊扣回优惠（向上取整），确保退款不超过该商品实付
        amount = refundItems.reduce((sum,item) => { const line = orderItems.find(o => o.product_id === item.productId)!; return sum + line.price*item.quantity - Math.ceil(Number(line.discount)*item.quantity/line.quantity); },0);
        ensure(amount > 0,400,'INVALID_REFUND_AMOUNT','退款金额必须大于0');
      } else if (input.amount != null) {
        ensure(Number.isInteger(input.amount) && input.amount > 0 && input.amount <= order.total,400,'INVALID_REFUND_AMOUNT','退款金额需大于0且不超过订单总额');
        amount = input.amount;
      }
      const refundId=randomUUID(), now=Date.now();
      await tx.run('INSERT INTO refunds(id,order_id,user_id,reason,status,amount,original_status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',[refundId,id,userId,input.reason,'pending',amount,order.status,now,now]);
      for (const item of refundItems) await tx.run('INSERT INTO refund_items(id,refund_id,product_id,quantity) VALUES(?,?,?,?)',[randomUUID(),refundId,item.productId,item.quantity]);
      await this.repo.audit(tx,userId,'refund.request',id,{reason:input.reason,amount,partial:refundItems.length>0 || amount<order.total},traceId);
      const created = (await tx.one('SELECT * FROM refunds WHERE id=?',[refundId]))!;
      created.items = await tx.all('SELECT product_id,quantity FROM refund_items WHERE refund_id=? ORDER BY product_id',[refundId]);
      return created;
    });
  }
  async decideRefund(refundId: string,approve: boolean,actor: string,note: string,traceId: string) {
    await this.repo.db.transaction(async tx => {
      const lookup = await tx.one('SELECT order_id FROM refunds WHERE id=?',[refundId]);
      ensure(lookup,404,'REFUND_NOT_FOUND','退款申请不存在');
      const order = await this.repo.get(tx,lookup.order_id,true);
      const refund = (await tx.one('SELECT * FROM refunds WHERE id=?',[refundId]))!;
      if (refund.status === (approve ? 'approved' : 'rejected')) return;
      ensure(refund.status === 'pending',409,'INVALID_STATE','退款已处理');
      if (approve) {
        ensure(!await tx.one('SELECT id FROM settlements WHERE order_id=?',[order.id]),409,'ALREADY_SETTLED','订单已结算');
        const full = Number(refund.amount) >= Number(order.total);
        const items = await tx.all('SELECT product_id,quantity FROM refund_items WHERE refund_id=? ORDER BY product_id',[refundId]);
        if (full) {
          // 整单退款：归还全部库存并回滚全部销量，订单与支付标记为已退款
          if (['paid','picking'].includes(order.status)) await this.repo.restock(tx,order.id);
          for (const item of await tx.all('SELECT product_id,quantity FROM order_items WHERE order_id=? ORDER BY product_id',[order.id])) await tx.run('UPDATE products SET sales=sales-? WHERE id=? AND sales>=?',[item.quantity,item.product_id,item.quantity]);
          await tx.run('UPDATE orders SET status=?,updated_at=? WHERE id=?',['refunded',Date.now(),order.id]);
          await tx.run('UPDATE payments SET status=? WHERE order_id=?',['refunded',order.id]);
          await this.repo.releaseCoupon(tx,order.id);
        } else if (items.length) {
          // 部分退款（按商品）：只归还所选商品库存并回滚对应销量，订单状态保持不变
          for (const item of items) {
            if (['paid','picking'].includes(order.status)) await tx.run('UPDATE products SET stock=stock+? WHERE id=?',[item.quantity,item.product_id]);
            await tx.run('UPDATE products SET sales=sales-? WHERE id=? AND sales>=?',[item.quantity,item.product_id,item.quantity]);
          }
        }
        await this.repo.emit(tx, full ? 'order.refunded' : 'order.partially_refunded', {orderId:order.id,userId:order.user_id,amount:refund.amount});
      }
      await tx.run('UPDATE refunds SET status=?,decision_note=?,updated_at=? WHERE id=?',[approve ? 'approved' : 'rejected',note,Date.now(),refundId]);
      await this.repo.audit(tx,actor,'refund.decision',order.id,{approve,note},traceId);
    });
  }
  async settle(actor: string,traceId: string) {
    return this.repo.db.transaction(async tx => {
      const orders = await tx.all("SELECT * FROM orders WHERE status='completed' ORDER BY id" + (this.repo.db.dialect === 'postgres' ? ' FOR UPDATE' : ''));
      let amount=0,count=0;
      for (const order of orders) {
        if (await tx.one('SELECT id FROM settlements WHERE order_id=?',[order.id])) continue;
        const refund = await tx.one('SELECT * FROM refunds WHERE order_id=?',[order.id]);
        if (refund && refund.status === 'pending') continue;
        // 已通过的部分退款按净额结算；整单退款订单状态已变为 refunded，不会进入本循环
        const net = Number(order.total) - (refund && refund.status === 'approved' ? Number(refund.amount) : 0);
        if (net <= 0) continue;
        await tx.run('INSERT INTO settlements(id,order_id,amount,operator_id,created_at) VALUES(?,?,?,?,?)',[randomUUID(),order.id,net,actor,Date.now()]);
        amount += net; count++;
      }
      await this.repo.audit(tx,actor,'settlement.create','batch',{count,amount},traceId);
      return {count,amount};
    });
  }
  async expire() {
    const orders = await this.repo.db.all("SELECT id FROM orders WHERE status='pending' AND expires_at<?",[Date.now()]);
    // 每笔超时取消单独成 trace，审计 trace_id 与之对应
    for (const order of orders) await withSpan('order.expire',{attributes:{'order.id':order.id}},span => this.cancel(order.id,undefined,span.spanContext().traceId));
    // 返回取消数量，调度器据此使商品缓存失效（超时归还的库存立即可见）
    return orders.length;
  }
}
