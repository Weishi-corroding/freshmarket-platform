import type { Database, Query } from '../../core/database.js';
import { ensure } from '../../core/errors.js';
import { randomUUID } from 'node:crypto';
import { injectContext } from '../../core/tracing.js';
export class OrderRepository {
  constructor(public db: Database) {}
  async get(tx: Query, id: string, lock = false) {
    const row = await tx.one('SELECT * FROM orders WHERE id=? AND deleted_at IS NULL' + (lock && this.db.dialect === 'postgres' ? ' FOR UPDATE' : ''),[id]);
    ensure(row,404,'ORDER_NOT_FOUND','订单不存在'); return row;
  }
  async detail(id: string, userId?: string): Promise<import('../../core/database.js').Row> {
    const row = await this.get(this.db,id);
    ensure(!userId || row.user_id === userId,404,'ORDER_NOT_FOUND','订单不存在');
    const refund = await this.db.one('SELECT * FROM refunds WHERE order_id=?',[id]) || null;
    if (refund) refund.items = await this.db.all('SELECT product_id,quantity FROM refund_items WHERE refund_id=? ORDER BY product_id',[refund.id]);
    return { ...row, address: JSON.parse(row.address_snapshot), items: await this.db.all('SELECT * FROM order_items WHERE order_id=?',[id]),
      refund, reviews: await this.db.all('SELECT * FROM reviews WHERE order_id=?',[id]) };
  }
  async audit(tx: Query, actor: string, action: string, id: string, detail: unknown, traceId: string) {
    await tx.run('INSERT INTO audit_logs(id,actor_id,action,entity_id,detail,trace_id,created_at) VALUES(?,?,?,?,?,?,?)',[randomUUID(),actor,action,id,JSON.stringify(detail),traceId,Date.now()]);
  }
  async emit(tx: Query, topic: string, payload: unknown) {
    // 同事务保存当前 W3C 链路上下文，异步发布/消费时接回同一条 trace
    await tx.run('INSERT INTO outbox(id,topic,payload,created_at,trace_context) VALUES(?,?,?,?,?)',[randomUUID(),topic,JSON.stringify(payload),Date.now(),JSON.stringify(injectContext())]);
  }
  async restock(tx: Query,id: string) {
    const items = await tx.all('SELECT product_id,quantity FROM order_items WHERE order_id=? ORDER BY product_id',[id]);
    for (const item of items) await tx.run('UPDATE products SET stock=stock+? WHERE id=?',[item.quantity,item.product_id]);
  }
  // 取消/整单退款时退回优惠券（过期券退回后在列表中显示为已过期）
  async releaseCoupon(tx: Query,orderId: string) {
    await tx.run("UPDATE user_coupons SET status='unused',order_id=NULL,used_at=NULL WHERE order_id=? AND status='used'",[orderId]);
  }
  // 未付款取消时归还秒杀名额，并允许该会员重新参与；退款不归还名额
  async releaseSeckill(tx: Query,order: import('../../core/database.js').Row) {
    if (!order.seckill_id) return;
    if (await tx.run('DELETE FROM seckill_participants WHERE activity_id=? AND order_id=?',[order.seckill_id,order.id]))
      await tx.run('UPDATE seckill_activities SET sold=sold-1 WHERE id=? AND sold>0',[order.seckill_id]);
  }
}
