import { createHash, randomUUID } from 'node:crypto';
import { OrderRepository } from './repository.js';
import { ensure } from '../../core/errors.js';

export class OrderService {
  constructor(public repo: OrderRepository, private ttlMinutes = 15) {}
  async create(userId: string, key: string, input: {addressId: string; deliverySlot: string; note?: string}, traceId: string) {
    const fingerprint = createHash('sha256').update(JSON.stringify([input.addressId,input.deliverySlot,input.note || ''])).digest('hex');
    // In PostgreSQL, locking the member serializes their checkout, including the first idempotency insert.
    const id = await this.repo.db.transaction(async tx => {
      await tx.one('SELECT id FROM users WHERE id=?' + (this.repo.db.dialect === 'postgres' ? ' FOR UPDATE' : ''),[userId]);
      const existing = await tx.one('SELECT id,request_hash FROM orders WHERE user_id=? AND idempotency_key=?',[userId,key]);
      if (existing) { ensure(existing.request_hash === fingerprint,409,'IDEMPOTENCY_CONFLICT','同一请求标识不能用于不同订单'); return existing.id; }
      const address = await tx.one('SELECT * FROM addresses WHERE id=? AND user_id=?',[input.addressId,userId]);
      ensure(address,400,'ADDRESS_INVALID','请选择有效的收货地址');
      const cart = await tx.all('SELECT p.*,c.quantity FROM cart_items c JOIN products p ON p.id=c.product_id WHERE c.user_id=? ORDER BY p.id',[userId]);
      ensure(cart.length,400,'CART_EMPTY','购物车还是空的');
      const subtotal = cart.reduce((sum,p) => sum + p.price*p.quantity,0);
      const fee = subtotal >= 9900 ? 0 : 600;
      for (const product of cart) {
        const changed = await tx.run('UPDATE products SET stock=stock-? WHERE id=? AND active=1 AND stock>=?',[product.quantity,product.id,product.quantity]);
        ensure(changed === 1,409,'OUT_OF_STOCK',`${product.name}库存不足或已下架，请调整购物车`);
      }
      const orderId = `FM${Date.now()}${randomUUID().slice(0,8)}`, now = Date.now();
      const snapshot = {name: address.name,phone: address.phone,detail: address.detail};
      await tx.run('INSERT INTO orders(id,user_id,status,subtotal,delivery_fee,total,address_snapshot,delivery_slot,note,idempotency_key,request_hash,created_at,expires_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [orderId,userId,'pending',subtotal,fee,subtotal+fee,JSON.stringify(snapshot),input.deliverySlot,input.note || '',key,fingerprint,now,now+this.ttlMinutes*60000,now]);
      for (const p of cart) await tx.run('INSERT INTO order_items(id,order_id,product_id,name,image,unit,price,quantity) VALUES(?,?,?,?,?,?,?,?)',[randomUUID(),orderId,p.id,p.name,p.image,p.unit,p.price,p.quantity]);
      await tx.run('DELETE FROM cart_items WHERE user_id=?',[userId]);
      await this.repo.audit(tx,userId,'order.create',orderId,{total: subtotal+fee},traceId);
      await this.repo.emit(tx,'order.created',{orderId,userId});
      return orderId;
    });
    return this.repo.detail(id,userId);
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
  async cancel(id: string,userId?: string,traceId = 'scheduler') {
    await this.repo.db.transaction(async tx => {
      const order = await this.repo.get(tx,id,true);
      ensure(!userId || order.user_id === userId,404,'ORDER_NOT_FOUND','订单不存在');
      if (order.status === 'cancelled') return;
      // Scheduler checks expiry inside the row lock to avoid racing a payment.
      if (!userId && (order.status !== 'pending' || Number(order.expires_at) > Date.now())) return;
      ensure(order.status === 'pending',409,'INVALID_STATE','仅待付款订单可取消');
      await this.repo.restock(tx,id);
      await tx.run('UPDATE orders SET status=?,updated_at=? WHERE id=?',['cancelled',Date.now(),id]);
      await this.repo.emit(tx,'order.cancelled',{orderId:id,userId:order.user_id});
      await this.repo.audit(tx,userId || 'system','order.cancel',id,{},traceId);
    }); return this.repo.detail(id,userId);
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
      const orderItems = await tx.all('SELECT product_id,price,quantity FROM order_items WHERE order_id=?',[id]);
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
        amount = refundItems.reduce((sum,item) => sum + orderItems.find(o => o.product_id === item.productId)!.price*item.quantity,0);
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
    for (const order of orders) await this.cancel(order.id);
  }
}
