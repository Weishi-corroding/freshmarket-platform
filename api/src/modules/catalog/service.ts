import { randomUUID } from 'node:crypto';
import type { Database } from '../../core/database.js';
import { ensure } from '../../core/errors.js';
import { OrderRepository } from '../orders/repository.js';
import type { Runtime } from '../../core/runtime.js';
import { createProductSearch } from './search.js';

export class CatalogService {
  constructor(private db: Database,private repo: OrderRepository,private runtime: Runtime) {}
  async list(query: any,admin=false) {
    const page=query.page || 1, pageSize=query.pageSize || 12;
    const clauses=admin?['deleted_at IS NULL']:['active=1','deleted_at IS NULL'], params:any[]=[];
    if(query.category) {clauses.push('category_id=?');params.push(query.category);}
    if(admin && (query.active==='0' || query.active==='1')) {clauses.push('active=?');params.push(Number(query.active));}
    const where=clauses.length?' WHERE '+clauses.join(' AND '):'';
    // 综合推荐排序：销量*0.5 + 浏览量*0.3 + 新品权重*0.2（最近30天视为新品）。
    // 未搜索时，运营后台按上架时间倒序，便于查看最新维护的商品。
    const sort=query.sort || 'default';
    const RECOMMEND_WINDOW_MS=30*24*60*60*1000;
    let order='created_at DESC,id', orderParams:any[]=[];
    if(sort==='priceAsc') order='price ASC,id';
    else if(sort==='priceDesc') order='price DESC,id';
    else if(sort==='sales') order='sales DESC,id';
    else if(sort==='default' && !admin) { order='(sales*0.5 + views*0.3 + (CASE WHEN created_at>=? THEN 1 ELSE 0 END)*0.2) DESC,id'; orderParams=[Date.now()-RECOMMEND_WINDOW_MS]; }
    const key=`${this.runtime.cacheNamespace}:catalog:search-v2:${await this.runtime.version()}:${JSON.stringify(query)}:${admin}`;
    const cached=await this.runtime.cacheGet(key);if(cached)return cached;
    const search=createProductSearch(query.q || '');
    if(search) {
      // Match before pagination so totals and later pages cover every relevant product.
      // SQL still applies visibility/category filters and the chosen business sort.
      const candidates=await this.db.all('SELECT * FROM products'+where+' ORDER BY '+order,[...params,...orderParams]);
      const matches=candidates.flatMap(product=>{
        const score=search({name:product.name,subtitle:product.subtitle,origin:product.origin});
        return score===undefined?[]:[{product,score}];
      });
      // Keep only the six most relevant weak overlaps, independently of pagination/sort.
      // Accurate and single-edit matches are not capped.
      const ranked=[...matches].sort((a,b)=>b.score-a.score || (a.score<1?
        (b.product.sales-a.product.sales)*0.5+(b.product.views-a.product.views)*0.3 || String(a.product.id).localeCompare(String(b.product.id)):0));
      const partialIds=new Set(ranked.filter(match=>match.score<1).slice(0,6).map(match=>match.product.id));
      const relevant=(sort==='default'?ranked:matches).filter(match=>match.score>=1 || partialIds.has(match.product.id));
      const items=relevant.slice((page-1)*pageSize,page*pageSize).map(match=>match.product);
      const data={items,total:relevant.length,page,pageSize};await this.runtime.cacheSet(key,data);return data;
    }
    const total=Number((await this.db.one('SELECT COUNT(*) AS count FROM products'+where,params))!.count);
    const items=await this.db.all('SELECT * FROM products'+where+' ORDER BY '+order+' LIMIT ? OFFSET ?',[...params,...orderParams,pageSize,(page-1)*pageSize]);
    const data={items,total,page,pageSize};await this.runtime.cacheSet(key,data);return data;
  }
  async detail(id:string) {
    const product=await this.db.one('SELECT * FROM products WHERE id=? AND active=1 AND deleted_at IS NULL',[id]);ensure(product,404,'PRODUCT_NOT_FOUND','商品不存在或已下架');
    // 记录一次浏览，作为综合推荐的“浏览量”权重来源
    await this.db.run('UPDATE products SET views=views+1 WHERE id=?',[id]);
    const reviews=await this.db.all('SELECT r.rating,r.content,r.created_at,u.name FROM reviews r JOIN users u ON u.id=r.user_id WHERE r.product_id=? ORDER BY r.created_at DESC LIMIT 30',[id]);
    return {...product,reviews};
  }
  async save(input: any,actor:string,traceId:string,id?:string) {
    const productId=id || randomUUID();
    await this.db.transaction(async tx => {
      ensure(await tx.one('SELECT id FROM categories WHERE id=?',[input.category_id]),400,'INVALID_CATEGORY','商品分类不存在');
      if(id) {
        ensure(await tx.one('SELECT id FROM products WHERE id=? AND deleted_at IS NULL'+(this.db.dialect==='postgres'?' FOR UPDATE':''),[id]),404,'PRODUCT_NOT_FOUND','商品不存在');
        await tx.run('UPDATE products SET category_id=?,name=?,subtitle=?,description=?,price=?,original_price=?,image=?,unit=?,origin=?,storage=?,tag=?,active=? WHERE id=?',[input.category_id,input.name,input.subtitle,input.description,input.price,input.original_price,input.image,input.unit,input.origin,input.storage,input.tag,input.active, id]);
      } else await tx.run('INSERT INTO products(id,category_id,name,subtitle,description,price,original_price,stock,sales,image,unit,origin,storage,tag,active,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[productId,input.category_id,input.name,input.subtitle,input.description,input.price,input.original_price,0,0,input.image,input.unit,input.origin,input.storage,input.tag,input.active,Date.now()]);
      await this.repo.audit(tx,actor,id?'product.update':'product.create',productId,{name:input.name,price:input.price,active:input.active},traceId);
    });await this.runtime.invalidate();return this.db.one('SELECT * FROM products WHERE id=?',[productId]);
  }
  async stock(id:string,delta:number,actor:string,reason:string,traceId:string) {
    ensure(delta!==0 && reason.trim(),400,'INVALID_STOCK','调整数量不能为0，且需填写调整原因');
    await this.db.transaction(async tx=>{
      const changed=await tx.run('UPDATE products SET stock=stock+? WHERE id=? AND deleted_at IS NULL AND stock+?>=0',[delta,id,delta]);
      ensure(changed,409,'INVALID_STOCK','商品不存在或调整后库存为负数');
      await this.repo.audit(tx,actor,'stock.adjust',id,{delta,reason},traceId);
    });await this.runtime.invalidate();return this.db.one('SELECT * FROM products WHERE id=?',[id]);
  }
  async remove(id:string,actor:string,traceId:string) {
    await this.db.transaction(async tx=>{
      const product=await tx.one('SELECT * FROM products WHERE id=? AND deleted_at IS NULL'+(this.db.dialect==='postgres'?' FOR UPDATE':''),[id]);
      ensure(product,404,'PRODUCT_NOT_FOUND','商品不存在或已删除');
      // Preserve order/refund references and the seed ID; a restart must not recreate deleted demo goods.
      await tx.run('UPDATE products SET active=0,deleted_at=? WHERE id=?',[Date.now(),id]);
      await tx.run('DELETE FROM cart_items WHERE product_id=?',[id]);
      await this.repo.audit(tx,actor,'product.delete',id,{name:product.name,stock:product.stock},traceId);
    });
    await this.runtime.invalidate();
  }
}
