import type { FastifyInstance } from 'fastify';
import type { Context } from '../../core/context.js';
import { ensure } from '../../core/errors.js';
import { idParams, pagination, pageQuery, result, text } from '../../core/http.js';
import { maskPhone, publicUser, roles } from '../../core/security.js';
import { catalogQuery } from '../catalog/controller.js';

const productBody={type:'object',additionalProperties:false,required:['category_id','name','subtitle','description','price','original_price','image','unit','origin','storage','tag','active'],properties:{category_id:text(40),name:text(80),subtitle:text(120),description:text(3000),price:{type:'integer',minimum:1,maximum:10000000},original_price:{type:'integer',minimum:1,maximum:10000000},image:{type:'string',pattern:'^/images/[a-zA-Z0-9_-]+\\.jpg$',maxLength:150},unit:text(80),origin:text(80),storage:text(100),tag:text(30),active:{type:'integer',enum:[0,1]}}};
export async function adminRoutes(app:FastifyInstance,ctx:Context) {
  const options=(cap:string,schema:any={})=>({preHandler:ctx.permit(cap),schema:{tags:['管理后台'],security:[{bearerAuth:[]}],...schema}});
  app.get('/api/admin/dashboard',options('dashboard'),async req=>{
    const totals=await ctx.db.one("SELECT COUNT(*) AS orders, COALESCE(SUM(CASE WHEN status IN ('paid','picking','delivering','completed') THEN total ELSE 0 END),0) AS revenue, SUM(CASE WHEN status='paid' THEN 1 ELSE 0 END) AS pending_fulfillment FROM orders");
    const members=Number((await ctx.db.one("SELECT COUNT(*) AS count FROM users WHERE role='member'"))!.count);
    const refunds=Number((await ctx.db.one("SELECT COUNT(*) AS count FROM refunds WHERE status='pending'"))!.count);
    const lowStock=await ctx.db.all('SELECT id,name,stock,image FROM products WHERE stock<20 AND active=1 ORDER BY stock LIMIT 8');
    const statuses=await ctx.db.all('SELECT status,COUNT(*) AS count FROM orders GROUP BY status');
    const daily=[];for(let i=6;i>=0;i--){const day=new Date();day.setHours(0,0,0,0);day.setDate(day.getDate()-i);const from=day.getTime();const row=await ctx.db.one("SELECT COUNT(*) AS orders,COALESCE(SUM(amount),0) AS amount FROM payments WHERE created_at>=? AND created_at<? AND status='success'",[from,from+86400000]);daily.push({label:`${day.getMonth()+1}/${day.getDate()}`,orders:Number(row!.orders),amount:Number(row!.amount)});}
    return result(req,{...totals,members,refunds,lowStock,statuses,daily,outbox:await ctx.db.one("SELECT COUNT(*) AS pending FROM outbox WHERE status!='sent'")});
  });
  app.get<{Querystring:Record<string,any>}>('/api/admin/products',options('dashboard',{querystring:catalogQuery}),async req=>result(req,await ctx.catalog.list(req.query,true)));
  app.post<{Body:Record<string,any>}>('/api/admin/products',options('products',{body:productBody}),async req=>result(req,await ctx.catalog.save(req.body,req.actor.id,req.id)));
  app.put<{Params:{id:string};Body:Record<string,any>}>('/api/admin/products/:id',options('products',{params:idParams,body:productBody}),async req=>result(req,await ctx.catalog.save(req.body,req.actor.id,req.id,req.params.id)));
  app.post<{Params:{id:string};Body:{delta:number;reason:string}}>('/api/admin/products/:id/stock',options('stock',{params:idParams,body:{type:'object',required:['delta','reason'],additionalProperties:false,properties:{delta:{type:'integer',minimum:-100000,maximum:100000},reason:text(200)}}}),async req=>result(req,await ctx.catalog.stock(req.params.id,req.body.delta,req.actor.id,req.body.reason,req.id)));
  app.get<{Querystring:Record<string,any>}>('/api/admin/orders',options('orders',{querystring:pageQuery}),async req=>{
    const p=pagination(req.query),where=req.query.status?' WHERE status=?':'',params=req.query.status?[req.query.status]:[];
    const rows=await ctx.db.all('SELECT id FROM orders'+where+' ORDER BY created_at DESC LIMIT ? OFFSET ?',[...params,p.pageSize,p.offset]);
    const items=await Promise.all(rows.map(row=>ctx.repo.detail(row.id)));
    for(const item of items) {item.address.phone=maskPhone(item.address.phone);delete item.address_snapshot;}
    return result(req,{items,total:Number((await ctx.db.one('SELECT COUNT(*) AS count FROM orders'+where,params))!.count),page:p.page,pageSize:p.pageSize});
  });
  app.post<{Params:{id:string};Body:{status:string}}>('/api/admin/orders/:id/status',options('fulfillment',{params:idParams,body:{type:'object',required:['status'],additionalProperties:false,properties:{status:{type:'string',enum:['picking','delivering']}}}}),async req=>{const item=await ctx.orders.transition(req.params.id,req.body.status,req.actor.id,req.id);item.address.phone=maskPhone(item.address.phone);delete item.address_snapshot;return result(req,item);});
  app.get<{Querystring:Record<string,any>}>('/api/admin/refunds',options('refunds',{querystring:pageQuery}),async req=>{
    const p=pagination(req.query),where=req.query.status?' WHERE status=?':'',params=req.query.status?[req.query.status]:[];
    return result(req,{items:await ctx.db.all('SELECT * FROM refunds'+where+' ORDER BY created_at DESC LIMIT ? OFFSET ?',[...params,p.pageSize,p.offset]),total:Number((await ctx.db.one('SELECT COUNT(*) AS count FROM refunds'+where,params))!.count),page:p.page,pageSize:p.pageSize});
  });
  app.post<{Params:{id:string};Body:{approve:boolean;note:string}}>('/api/admin/refunds/:id/decision',options('refunds',{params:idParams,body:{type:'object',required:['approve','note'],additionalProperties:false,properties:{approve:{type:'boolean'},note:text(200)}}}),async req=>{await ctx.orders.decideRefund(req.params.id,req.body.approve,req.actor.id,req.body.note,req.id);await ctx.runtime.invalidate();return result(req,null);});
  app.get<{Querystring:Record<string,any>}>('/api/admin/settlements',options('settlements',{querystring:pageQuery}),async req=>{
    const p=pagination(req.query);
    return result(req,{items:await ctx.db.all('SELECT * FROM settlements ORDER BY created_at DESC LIMIT ? OFFSET ?',[p.pageSize,p.offset]),total:Number((await ctx.db.one('SELECT COUNT(*) AS count FROM settlements'))!.count),amount:Number((await ctx.db.one('SELECT COALESCE(SUM(amount),0) AS amount FROM settlements'))!.amount),page:p.page,pageSize:p.pageSize});
  });
  app.post('/api/admin/settlements',options('settlements'),async req=>result(req,await ctx.orders.settle(req.actor.id,req.id)));
  app.get<{Querystring:Record<string,any>}>('/api/admin/users',options('users',{querystring:pageQuery}),async req=>{const p=pagination(req.query);const users=await ctx.db.all('SELECT * FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?',[p.pageSize,p.offset]);return result(req,{items:users.map(publicUser),total:Number((await ctx.db.one('SELECT COUNT(*) AS count FROM users'))!.count),page:p.page,pageSize:p.pageSize});});
  app.put<{Params:{id:string};Body:{role:string}}>('/api/admin/users/:id/role',options('users',{params:idParams,body:{type:'object',required:['role'],additionalProperties:false,properties:{role:{type:'string',enum:roles}}}}),async req=>{
    ensure(req.params.id!==req.actor.id,400,'SELF_ROLE_CHANGE','请由另一位管理员调整您的权限');
    await ctx.db.transaction(async tx=>{ensure(await tx.one('SELECT id FROM users WHERE id=?',[req.params.id]),404,'USER_NOT_FOUND','用户不存在');await tx.run('UPDATE users SET role=? WHERE id=?',[req.body.role,req.params.id]);await ctx.repo.audit(tx,req.actor.id,'user.role',req.params.id,{role:req.body.role},req.id);});return result(req,null);
  });
  app.get<{Querystring:Record<string,any>}>('/api/admin/audit',options('audit',{querystring:pageQuery}),async req=>{const p=pagination(req.query);return result(req,{items:await ctx.db.all('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ? OFFSET ?',[p.pageSize,p.offset]),total:Number((await ctx.db.one('SELECT COUNT(*) AS count FROM audit_logs'))!.count),page:p.page,pageSize:p.pageSize});});
}
