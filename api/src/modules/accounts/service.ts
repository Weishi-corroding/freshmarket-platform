import { randomUUID } from 'node:crypto';
import type { Database } from '../../core/database.js';
import { ensure } from '../../core/errors.js';
import { hashPassword, publicUser, verifyPassword } from '../../core/security.js';
import { OrderRepository } from '../orders/repository.js';

export class AccountService {
  constructor(private db: Database,private repo: OrderRepository) {}
  async register(input: {username:string;name:string;password:string},traceId:string) {
    const hash=hashPassword(input.password);
    return this.db.transaction(async tx => {
      ensure(!await tx.one('SELECT id FROM users WHERE username=?',[input.username]),409,'USERNAME_EXISTS','账号已存在');
      const id=randomUUID();
      const inserted=await tx.run('INSERT INTO users(id,username,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(username) DO NOTHING',[id,input.username,input.name,hash,'member',Date.now()]);
      ensure(inserted===1,409,'USERNAME_EXISTS','账号已存在');
      await this.repo.audit(tx,id,'auth.register',id,{},traceId);
      return publicUser((await tx.one('SELECT * FROM users WHERE id=?',[id]))!);
    });
  }
  async login(username: string,password: string,traceId: string) {
    const user=await this.db.one('SELECT * FROM users WHERE username=?',[username]);
    // A valid dummy hash keeps unknown-user and wrong-password paths comparable.
    const valid=verifyPassword(password,user?.password_hash || '00000000000000000000000000000000:'.padEnd(161,'0'));
    ensure(user && valid,401,'INVALID_CREDENTIALS','账号或密码错误');
    await this.repo.audit(this.db,user.id,'auth.login',user.id,{},traceId);
    return publicUser(user);
  }
  async cart(userId: string) {
    const items=await this.db.all('SELECT p.*,c.quantity FROM cart_items c JOIN products p ON p.id=c.product_id WHERE c.user_id=? ORDER BY p.id',[userId]);
    const subtotal=items.reduce((n,p)=>n+p.price*p.quantity,0), deliveryFee=items.length && subtotal<9900 ? 600 : 0;
    return {items,subtotal,deliveryFee,total:subtotal+deliveryFee,count:items.reduce((n,p)=>n+p.quantity,0)};
  }
  async setCart(userId: string,productId: string,quantity: number,add: boolean) {
    await this.db.transaction(async tx => {
      await tx.one('SELECT id FROM users WHERE id=?' + (this.db.dialect === 'postgres' ? ' FOR UPDATE' : ''),[userId]);
      if (!quantity && !add) { await tx.run('DELETE FROM cart_items WHERE user_id=? AND product_id=?',[userId,productId]); return; }
      const product=await tx.one('SELECT * FROM products WHERE id=? AND active=1',[productId]);
      ensure(product,404,'PRODUCT_NOT_FOUND','商品不存在或已下架');
      const current=await tx.one('SELECT quantity FROM cart_items WHERE user_id=? AND product_id=?',[userId,productId]);
      const next=add ? (current?.quantity || 0)+quantity : quantity;
      ensure(next<=99 && next<=product.stock,409,'OUT_OF_STOCK','数量超过库存或限购数量');
      await tx.run('INSERT INTO cart_items(user_id,product_id,quantity) VALUES(?,?,?) ON CONFLICT(user_id,product_id) DO UPDATE SET quantity=excluded.quantity',[userId,productId,next]);
    });return this.cart(userId);
  }
  async saveAddress(userId: string,input: {name:string;phone:string;detail:string;isDefault:boolean},id?:string) {
    return this.db.transaction(async tx => {
      await tx.one('SELECT id FROM users WHERE id=?' + (this.db.dialect === 'postgres' ? ' FOR UPDATE' : ''),[userId]);
      if(id) ensure(await tx.one('SELECT id FROM addresses WHERE id=? AND user_id=?',[id,userId]),404,'ADDRESS_NOT_FOUND','地址不存在');
      const count=Number((await tx.one('SELECT COUNT(*) AS count FROM addresses WHERE user_id=?',[userId]))!.count);
      ensure(id || count<20,400,'ADDRESS_LIMIT','最多保存20个地址');
      const isDefault=input.isDefault || count===0;
      if(isDefault) await tx.run('UPDATE addresses SET is_default=0 WHERE user_id=?',[userId]);
      const addressId=id || randomUUID();
      if(id) await tx.run('UPDATE addresses SET name=?,phone=?,detail=?,is_default=? WHERE id=? AND user_id=?',[input.name,input.phone,input.detail,isDefault?1:0,id,userId]);
      else await tx.run('INSERT INTO addresses(id,user_id,name,phone,detail,is_default) VALUES(?,?,?,?,?,?)',[addressId,userId,input.name,input.phone,input.detail,isDefault?1:0]);
      return tx.one('SELECT * FROM addresses WHERE id=?',[addressId]);
    });
  }
  async review(userId:string,orderId:string,input:{productId:string;rating:number;content:string},traceId:string) {
    return this.db.transaction(async tx => {
      const order=await this.repo.get(tx,orderId,true);
      ensure(order.user_id===userId,404,'ORDER_NOT_FOUND','订单不存在');
      ensure(order.status==='completed',409,'INVALID_STATE','收货后才可以评价');
      ensure(await tx.one('SELECT id FROM order_items WHERE order_id=? AND product_id=?',[orderId,input.productId]),400,'INVALID_PRODUCT','该商品不在订单中');
      ensure(!await tx.one('SELECT id FROM reviews WHERE order_id=? AND product_id=? AND user_id=?',[orderId,input.productId,userId]),409,'ALREADY_REVIEWED','已经评价过该商品');
      const id=randomUUID();
      await tx.run('INSERT INTO reviews(id,order_id,product_id,user_id,rating,content,created_at) VALUES(?,?,?,?,?,?,?)',[id,orderId,input.productId,userId,input.rating,input.content,Date.now()]);
      await this.repo.audit(tx,userId,'review.create',orderId,{productId:input.productId,rating:input.rating},traceId);
      return tx.one('SELECT * FROM reviews WHERE id=?',[id]);
    });
  }
}
