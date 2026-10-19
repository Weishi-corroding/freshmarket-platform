import { randomUUID } from 'node:crypto';
import type { Database, Query } from '../../core/database.js';
import { BusinessError, ensure } from '../../core/errors.js';
import { accountType, hashPassword, publicUser, verifyPassword, type AccountType, type Role } from '../../core/security.js';
import { OrderRepository } from '../orders/repository.js';

export class AccountService {
  constructor(private db: Database,private repo: OrderRepository) {}
  async register(input: {username:string;name:string;password:string},traceId:string) {
    return this.createAccount(input,'member',traceId);
  }
  async createStaff(input: {username:string;name:string;password:string;role:Role},actorId:string,traceId:string) {
    ensure(accountType(input.role)==='staff',400,'INVALID_STAFF_ROLE','请选择员工岗位');
    return this.createAccount(input,input.role,traceId,actorId);
  }
  async createMember(input:{username:string;name:string;password:string},actorId:string,traceId:string) {
    return this.createAccount(input,'member',traceId,actorId);
  }
  private async createAccount(input: {username:string;name:string;password:string},role:Role,traceId:string,actorId?:string) {
    ensure(input.name.trim(),400,'INVALID_NAME','姓名不能为空');
    const hash=hashPassword(input.password);
    return this.db.transaction(async tx => {
      ensure(!await tx.one('SELECT id FROM users WHERE username=?',[input.username]),409,'USERNAME_EXISTS','账号已存在');
      const id=randomUUID();
      const inserted=await tx.run('INSERT INTO users(id,username,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(username) DO NOTHING',[id,input.username,input.name.trim(),hash,role,Date.now()]);
      ensure(inserted===1,409,'USERNAME_EXISTS','账号已存在');
      await this.repo.audit(tx,actorId || id,actorId?'user.create':'auth.register',id,{role},traceId);
      return publicUser((await tx.one('SELECT * FROM users WHERE id=?',[id]))!);
    });
  }
  async login(username: string,password: string,traceId: string,type:AccountType) {
    const user=await this.db.one('SELECT * FROM users WHERE username=? AND deleted_at IS NULL',[username]);
    // A valid dummy hash keeps unknown-user and wrong-password paths comparable.
    const valid=verifyPassword(password,user?.password_hash || '00000000000000000000000000000000:'.padEnd(161,'0'));
    ensure(user && valid,401,'INVALID_CREDENTIALS','账号或密码错误');
    ensure(user.active===1,403,'ACCOUNT_DISABLED','账号已停用，请联系管理员');
    ensure(accountType(user.role)===type,403,'ACCOUNT_TYPE_MISMATCH',type==='member'?'员工账号请使用员工登录入口':'会员账号请使用商城登录入口');
    await this.repo.audit(this.db,user.id,'auth.login',user.id,{accountType:type},traceId);
    return {user:publicUser(user),claims:{sub:user.id as string,accountType:type,sessionVersion:Number(user.session_version)}};
  }
  private async lockAdministrators(tx:Query,actor:string) {
    // Serialize administrator removal/demotion so concurrent requests cannot remove the last one.
    await tx.all("SELECT id FROM users WHERE role='admin' ORDER BY id"+(this.db.dialect==='postgres'?' FOR UPDATE':''));
    const current=await tx.one('SELECT role,active,deleted_at FROM users WHERE id=?',[actor]);
    ensure(current?.role==='admin' && current.active===1 && current.deleted_at==null,403,'FORBIDDEN','当前账号无权管理账号');
  }
  private async protectAdministrator(tx:Query,target:Record<string,any>,removing:boolean) {
    if(target.role!=='admin' || target.active!==1 || !removing)return;
    const count=Number((await tx.one("SELECT COUNT(*) AS count FROM users WHERE role='admin' AND active=1 AND deleted_at IS NULL"))!.count);
    ensure(count>1,409,'LAST_ADMIN','必须保留至少一名启用的管理员');
  }
  async updateAccount(id:string,type:AccountType,input:{username?:string;name?:string;role?:Role;active?:number;password?:string},actor:string,traceId:string) {
    const hash=input.password?hashPassword(input.password):undefined;
    return this.db.transaction(async tx=>{
      await this.lockAdministrators(tx,actor);
      const target=await tx.one('SELECT * FROM users WHERE id=? AND deleted_at IS NULL'+(this.db.dialect==='postgres'?' FOR UPDATE':''),[id]);
      ensure(target,404,'USER_NOT_FOUND','账号不存在');
      ensure(accountType(target.role)===type,400,'ACCOUNT_TYPE_IMMUTABLE','会员与员工不能互相转换，请使用对应账号管理入口');
      const name=input.name?.trim() ?? target.name,username=input.username ?? target.username,role=input.role ?? target.role,active=input.active ?? target.active;
      ensure(name,400,'INVALID_NAME','姓名不能为空');
      ensure(accountType(role)===type,400,'ACCOUNT_TYPE_IMMUTABLE','会员与员工不能互相转换');
      ensure(id!==actor || role===target.role,400,'SELF_ROLE_CHANGE','请由另一位管理员调整您的权限');
      ensure(id!==actor || active===1,400,'SELF_DISABLE','不能停用当前登录的管理员');
      await this.protectAdministrator(tx,target,role!=='admin' || active!==1);
      ensure(!await tx.one('SELECT id FROM users WHERE username=? AND id<>?',[username,id]),409,'USERNAME_EXISTS','账号已存在（含已删除账号）');
      try {
        await tx.run('UPDATE users SET username=?,name=?,role=?,active=?,password_hash=?,session_version=session_version+? WHERE id=?',
          [username,name,role,active,hash ?? target.password_hash,hash || active!==target.active?1:0,id]);
      } catch(error:any) {
        if(error.code==='23505' || String(error.message).includes('UNIQUE constraint failed: users.username'))throw new BusinessError(409,'USERNAME_EXISTS','账号已存在');
        throw error;
      }
      await this.repo.audit(tx,actor,'user.update',id,{accountType:type,username,name,role,active,passwordReset:!!hash},traceId);
      return publicUser((await tx.one('SELECT * FROM users WHERE id=?',[id]))!);
    });
  }
  async removeAccount(id:string,type:AccountType,actor:string,traceId:string) {
    ensure(id!==actor,400,'SELF_DELETE','不能删除当前登录的管理员');
    await this.db.transaction(async tx=>{
      await this.lockAdministrators(tx,actor);
      const target=await tx.one('SELECT * FROM users WHERE id=? AND deleted_at IS NULL'+(this.db.dialect==='postgres'?' FOR UPDATE':''),[id]);
      ensure(target && accountType(target.role)===type,404,'USER_NOT_FOUND','账号不存在');
      await this.protectAdministrator(tx,target,true);
      const ongoing=await tx.one("SELECT id FROM orders WHERE user_id=? AND status IN ('pending','paid','picking','delivering') LIMIT 1",[id]);
      const refund=await tx.one("SELECT id FROM refunds WHERE user_id=? AND status='pending' LIMIT 1",[id]);
      ensure(!ongoing && !refund,409,'ACCOUNT_IN_USE','账号有未完成订单或待审核售后，请先处理业务；需要限制登录时可停用账号');
      await tx.run('UPDATE users SET active=0,deleted_at=?,session_version=session_version+1 WHERE id=?',[Date.now(),id]);
      await tx.run('DELETE FROM cart_items WHERE user_id=?',[id]);
      await this.repo.audit(tx,actor,'user.delete',id,{accountType:type,username:target.username,name:target.name,role:target.role},traceId);
    });
  }
  async cart(userId: string) {
    const items=await this.db.all('SELECT p.*,c.quantity FROM cart_items c JOIN products p ON p.id=c.product_id WHERE c.user_id=? ORDER BY p.id',[userId]);
    const subtotal=items.reduce((n,p)=>n+p.price*p.quantity,0), deliveryFee=items.length && subtotal<9900 ? 600 : 0;
    return {items,subtotal,deliveryFee,total:subtotal+deliveryFee,count:items.reduce((n,p)=>n+p.quantity,0)};
  }
  async setCart(userId: string,productId: string,quantity: number,add: boolean) {
    await this.db.transaction(async tx => {
      const user=await tx.one('SELECT id,active,deleted_at FROM users WHERE id=?' + (this.db.dialect === 'postgres' ? ' FOR UPDATE' : ''),[userId]);
      ensure(user?.active===1 && user.deleted_at==null,401,'UNAUTHORIZED','账号不可用');
      if (!quantity && !add) { await tx.run('DELETE FROM cart_items WHERE user_id=? AND product_id=?',[userId,productId]); return; }
      const product=await tx.one('SELECT * FROM products WHERE id=? AND active=1 AND deleted_at IS NULL'+(this.db.dialect==='postgres'?' FOR UPDATE':''),[productId]);
      ensure(product,404,'PRODUCT_NOT_FOUND','商品不存在或已下架');
      const current=await tx.one('SELECT quantity FROM cart_items WHERE user_id=? AND product_id=?',[userId,productId]);
      const next=add ? (current?.quantity || 0)+quantity : quantity;
      ensure(next<=99 && next<=product.stock,409,'OUT_OF_STOCK','数量超过库存或限购数量');
      await tx.run('INSERT INTO cart_items(user_id,product_id,quantity) VALUES(?,?,?) ON CONFLICT(user_id,product_id) DO UPDATE SET quantity=excluded.quantity',[userId,productId,next]);
    });return this.cart(userId);
  }
  async saveAddress(userId: string,input: {name:string;phone:string;detail:string;isDefault:boolean},id?:string) {
    return this.db.transaction(async tx => {
      const user=await tx.one('SELECT id,active,deleted_at FROM users WHERE id=?' + (this.db.dialect === 'postgres' ? ' FOR UPDATE' : ''),[userId]);
      ensure(user?.active===1 && user.deleted_at==null,401,'UNAUTHORIZED','账号不可用');
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
