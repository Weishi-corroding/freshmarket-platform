import type { Database, Query } from '../../core/database.js';
import { ensure } from '../../core/errors.js';
import { randomUUID } from 'node:crypto';
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
    await tx.run('INSERT INTO outbox(id,topic,payload,created_at) VALUES(?,?,?,?)',[randomUUID(),topic,JSON.stringify(payload),Date.now()]);
  }
  async restock(tx: Query,id: string) {
    const items = await tx.all('SELECT product_id,quantity FROM order_items WHERE order_id=? ORDER BY product_id',[id]);
    for (const item of items) await tx.run('UPDATE products SET stock=stock+? WHERE id=?',[item.quantity,item.product_id]);
  }
}
