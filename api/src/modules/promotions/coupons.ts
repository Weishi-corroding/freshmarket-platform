import { randomUUID } from 'node:crypto';
import type { Database, Query, Row } from '../../core/database.js';
import { ensure } from '../../core/errors.js';
import { traceAttributes } from '../../core/tracing.js';
import type { OrderRepository } from '../orders/repository.js';

export type Line = {product_id:string;category_id:string;price:number;quantity:number};
// 免配送费按优惠后的商品实付金额判断
export const deliveryFee = (goods:number,hasItems=true) => hasItems && goods<9900 ? 600 : 0;
const yuan = (fen:number) => (fen/100).toFixed(fen%100?2:0);
export const couponState = (row:Row,now=Date.now()) => row.status==='used'?'used':Number(row.valid_to)<=now?'expired':Number(row.valid_from)>now?'pending':'unused';

// 计算优惠额，并按行金额比例分摊到商品行；分摊合计严格等于优惠额，部分退款按分摊扣回
export function quote(coupon:Row,lines:Line[]) {
  const eligible=lines.filter(line=>!coupon.category_id || line.category_id===coupon.category_id);
  const base=eligible.reduce((sum,line)=>sum+line.price*line.quantity,0),threshold=Number(coupon.threshold);
  if(!base)return {discount:0,base,allocation:{} as Record<string,number>,reason:'购物车中没有适用商品'};
  if(base<threshold)return {discount:0,base,allocation:{} as Record<string,number>,reason:`适用商品还差¥${yuan(threshold-base)}`};
  let discount=coupon.kind==='amount'?Math.min(Number(coupon.value),base):Math.floor(base*(100-Number(coupon.value))/100);
  if(Number(coupon.max_discount)>0)discount=Math.min(discount,Number(coupon.max_discount));
  const allocation:Record<string,number>={};let left=discount;
  for(const line of eligible){const share=Math.floor(discount*line.price*line.quantity/base);allocation[line.product_id]=share;left-=share;}
  // 取整余数按行金额从大到小逐分补齐，且不超过行金额
  const ordered=[...eligible].sort((a,b)=>b.price*b.quantity-a.price*a.quantity || a.product_id.localeCompare(b.product_id));
  for(let i=0;left>0;i=(i+1)%ordered.length){const line=ordered[i];if(allocation[line.product_id]<line.price*line.quantity){allocation[line.product_id]++;left--;}}
  return {discount,base,allocation,reason:discount?'':'优惠金额不足1分'};
}
const couponColumns='c.name,c.kind,c.threshold,c.value,c.max_discount,c.category_id,c.valid_from,c.valid_to,cat.name AS category_name';
// 下单事务内校验优惠券并计算分摊，订单写入后再用 markCouponUsed 条件核销
export async function lockCoupon(tx:Query,userId:string,userCouponId:string,lines:Line[]) {
  const row=await tx.one(`SELECT uc.status,${couponColumns} FROM user_coupons uc JOIN coupons c ON c.id=uc.coupon_id LEFT JOIN categories cat ON cat.id=c.category_id WHERE uc.id=? AND uc.user_id=?`,[userCouponId,userId]);
  ensure(row,400,'COUPON_INVALID','优惠券不存在');
  const state=couponState(row);
  ensure(state!=='used',409,'COUPON_USED','优惠券已使用');
  ensure(state==='unused',409,'COUPON_EXPIRED','优惠券不在有效期内');
  const result=quote(row,lines);
  ensure(result.discount>0,409,'COUPON_NOT_APPLICABLE',`${row.name}暂不可用：${result.reason}`);
  return result;
}
export async function markCouponUsed(tx:Query,userId:string,userCouponId:string,orderId:string) {
  const changed=await tx.run("UPDATE user_coupons SET status='used',order_id=?,used_at=? WHERE id=? AND user_id=? AND status='unused'",[orderId,Date.now(),userCouponId,userId]);
  ensure(changed===1,409,'COUPON_USED','优惠券已使用');
}

export class CouponService {
  constructor(private db:Database,private repo:OrderRepository) {}
  // 领券中心：未过期且启用的券；登录会员额外返回是否已领取
  async center(userId?:string) {
    const rows=await this.db.all('SELECT c.*,cat.name AS category_name FROM coupons c LEFT JOIN categories cat ON cat.id=c.category_id WHERE c.active=1 AND c.valid_to>? ORDER BY c.threshold,c.id',[Date.now()]);
    const claimed=new Set(userId?(await this.db.all('SELECT coupon_id FROM user_coupons WHERE user_id=?',[userId])).map(row=>row.coupon_id):[]);
    return rows.map(row=>({...row,remaining:Number(row.total)-Number(row.issued),claimed:claimed.has(row.id)}));
  }
  async claim(userId:string,couponId:string,traceId:string) {
    traceAttributes({'coupon.id':couponId});
    const id=await this.db.transaction(async tx=>{
      const coupon=await tx.one('SELECT * FROM coupons WHERE id=?',[couponId]),now=Date.now();
      ensure(coupon,404,'COUPON_NOT_FOUND','优惠券不存在');
      // 每人一张由唯一约束保证；发放量用条件更新防超发，任一失败整个事务回滚
      const id=randomUUID();
      ensure(await tx.run('INSERT INTO user_coupons(id,coupon_id,user_id,claimed_at) VALUES(?,?,?,?) ON CONFLICT(coupon_id,user_id) DO NOTHING',[id,couponId,userId,now]),409,'COUPON_CLAIMED','您已领取过这张优惠券');
      const changed=await tx.run('UPDATE coupons SET issued=issued+1 WHERE id=? AND active=1 AND issued<total AND valid_to>?',[couponId,now]);
      ensure(changed,409,'COUPON_SOLD_OUT',coupon.active===1 && Number(coupon.valid_to)>now?'优惠券已被抢光':'优惠券已停止发放');
      await this.repo.audit(tx,userId,'coupon.claim',couponId,{userCouponId:id},traceId);
      return id;
    });
    return (await this.mine(userId)).find(row=>row.id===id);
  }
  async mine(userId:string) {
    const rows=await this.db.all(`SELECT uc.id,uc.coupon_id,uc.status,uc.order_id,uc.claimed_at,uc.used_at,${couponColumns} FROM user_coupons uc JOIN coupons c ON c.id=uc.coupon_id LEFT JOIN categories cat ON cat.id=c.category_id WHERE uc.user_id=? ORDER BY uc.claimed_at DESC,uc.id`,[userId]);
    const now=Date.now();return rows.map((row):Row=>({...row,state:couponState(row,now)}));
  }
  // 结算页：按当前购物车试算每张可用券的优惠、配送费与应付金额，最优券排在最前
  async checkout(userId:string) {
    const lines=await this.db.all<Line&Row>('SELECT p.id AS product_id,p.category_id,p.price,c.quantity FROM cart_items c JOIN products p ON p.id=c.product_id WHERE c.user_id=? AND p.active=1 AND p.deleted_at IS NULL ORDER BY p.id',[userId]);
    const subtotal=lines.reduce((sum,line)=>sum+line.price*line.quantity,0);
    const items=(await this.mine(userId)).filter(row=>row.state==='unused').map((row):Row=>{
      const {discount,reason}=quote(row,lines),fee=deliveryFee(subtotal-discount,lines.length>0);
      return {...row,applicable:discount>0,discount,reason,deliveryFee:fee,total:subtotal-discount+fee};
    }).sort((a,b)=>b.discount-a.discount || Number(a.valid_to)-Number(b.valid_to));
    return {subtotal,items};
  }
  async list(query:any) {
    const page=query.page || 1,pageSize=query.pageSize || 20,q=query.q?.trim();
    const where=q?" WHERE LOWER(c.name) LIKE ? ESCAPE '!'":'',params=q?['%'+q.normalize('NFKC').toLowerCase().replace(/[!%_]/g,'!$&')+'%']:[];
    const items=await this.db.all(`SELECT c.*,cat.name AS category_name,(SELECT COUNT(*) FROM user_coupons uc WHERE uc.coupon_id=c.id AND uc.status='used') AS used FROM coupons c LEFT JOIN categories cat ON cat.id=c.category_id${where} ORDER BY c.created_at DESC,c.id LIMIT ? OFFSET ?`,[...params,pageSize,(page-1)*pageSize]);
    return {items:items.map(row=>({...row,used:Number(row.used)})),total:Number((await this.db.one('SELECT COUNT(*) AS count FROM coupons c'+where,params))!.count),page,pageSize};
  }
  async save(input:any,actor:string,traceId:string,id?:string) {
    const category=input.category_id || null,maxDiscount=input.kind==='percent'?input.max_discount:0;
    if(input.kind==='amount')ensure(input.value<input.threshold,400,'INVALID_COUPON','满减券的减免金额需小于使用门槛');
    else ensure(input.value>=10 && input.value<=99,400,'INVALID_COUPON','折扣券需在1折到9.9折之间（填写10–99）');
    ensure(input.valid_to>input.valid_from,400,'INVALID_COUPON','结束时间需晚于开始时间');
    const couponId=id || randomUUID();
    await this.db.transaction(async tx=>{
      if(category)ensure(await tx.one('SELECT id FROM categories WHERE id=?',[category]),400,'INVALID_CATEGORY','商品分类不存在');
      if(id) {
        const old=await tx.one('SELECT * FROM coupons WHERE id=?'+(this.db.dialect==='postgres'?' FOR UPDATE':''),[id]);
        ensure(old,404,'COUPON_NOT_FOUND','优惠券不存在');
        ensure(input.total>=Number(old.issued),409,'INVALID_COUPON',`发放总量不能少于已领取的${old.issued}张`);
        // 已有会员领取后锁定优惠规则，只允许改名称、总量、结束时间和启停
        const locked=Number(old.issued)>0 && (old.kind!==input.kind || Number(old.threshold)!==input.threshold || Number(old.value)!==input.value || Number(old.max_discount)!==maxDiscount || (old.category_id || null)!==category || Number(old.valid_from)!==input.valid_from);
        ensure(!locked,409,'COUPON_LOCKED','已有会员领取，不能修改优惠规则和开始时间');
        await tx.run('UPDATE coupons SET name=?,kind=?,threshold=?,value=?,max_discount=?,category_id=?,total=?,valid_from=?,valid_to=?,active=? WHERE id=?',[input.name,input.kind,input.threshold,input.value,maxDiscount,category,input.total,input.valid_from,input.valid_to,input.active,id]);
      } else {
        ensure(input.valid_to>Date.now(),400,'INVALID_COUPON','结束时间需晚于当前时间');
        await tx.run('INSERT INTO coupons(id,name,kind,threshold,value,max_discount,category_id,total,valid_from,valid_to,active,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',[couponId,input.name,input.kind,input.threshold,input.value,maxDiscount,category,input.total,input.valid_from,input.valid_to,input.active,Date.now()]);
      }
      await this.repo.audit(tx,actor,id?'coupon.update':'coupon.create',couponId,{name:input.name,kind:input.kind,threshold:input.threshold,value:input.value,total:input.total,active:input.active},traceId);
    });
    return this.db.one('SELECT * FROM coupons WHERE id=?',[couponId]);
  }
}
