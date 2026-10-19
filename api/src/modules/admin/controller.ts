import type { FastifyInstance } from 'fastify';
import type { Context } from '../../core/context.js';
import { ensure } from '../../core/errors.js';
import { idParams, pagination, pageQuery, result, text } from '../../core/http.js';
import { maskPhone, publicUser, staffRoles, type Role } from '../../core/security.js';
import { catalogQuery } from '../catalog/controller.js';

const productBody={type:'object',additionalProperties:false,required:['category_id','name','subtitle','description','price','original_price','image','unit','origin','storage','tag','active'],properties:{category_id:text(40),name:text(80),subtitle:text(120),description:text(3000),price:{type:'integer',minimum:1,maximum:10000000},original_price:{type:'integer',minimum:1,maximum:10000000},image:{type:'string',pattern:'^/images/[a-zA-Z0-9_-]+\\.jpg$',maxLength:150},unit:text(80),origin:text(80),storage:text(100),tag:text(30),active:{type:'integer',enum:[0,1]}}};
const username={type:'string',pattern:'^[a-zA-Z0-9_@.]{3,60}$'};
const password={type:'string',minLength:10,maxLength:128,pattern:'^(?=.*[A-Za-z])(?=.*[0-9]).+$'};
const active={type:'integer',enum:[0,1]};
const searchQuery={...pageQuery,properties:{...pageQuery.properties,q:{type:'string',maxLength:80}}};
const orderQuery={...searchQuery,properties:{...searchQuery.properties,status:{type:'string',enum:['','pending','paid','picking','delivering','completed','cancelled','refunded']}}};
const refundQuery={...searchQuery,properties:{...searchQuery.properties,status:{type:'string',enum:['','pending','approved','rejected']}}};
const like=(q:string)=>'%'+q.trim().normalize('NFKC').toLowerCase().replace(/[!%_]/g,'!$&')+'%';
function hidePhone(item:Record<string,any>) {item.address.phone=maskPhone(item.address.phone);delete item.address_snapshot;return item;}
export async function adminRoutes(app:FastifyInstance,ctx:Context) {
  const options=(cap:string,schema:any={})=>({preHandler:ctx.permit(cap),schema:{tags:['管理后台'],security:[{bearerAuth:[]}],...schema}});
  app.get('/api/admin/dashboard',options('dashboard'),async req=>{
    const totals=await ctx.db.one("SELECT COUNT(*) AS orders, COALESCE(SUM(CASE WHEN status IN ('paid','picking','delivering','completed') THEN total ELSE 0 END),0) AS revenue, SUM(CASE WHEN status='paid' THEN 1 ELSE 0 END) AS pending_fulfillment FROM orders WHERE deleted_at IS NULL");
    const members=Number((await ctx.db.one("SELECT COUNT(*) AS count FROM users WHERE role='member' AND deleted_at IS NULL"))!.count);
    const refunds=Number((await ctx.db.one("SELECT COUNT(*) AS count FROM refunds WHERE status='pending'"))!.count);
    const lowStock=await ctx.db.all('SELECT id,name,stock,image FROM products WHERE stock<20 AND active=1 AND deleted_at IS NULL ORDER BY stock LIMIT 8');
    const statuses=await ctx.db.all('SELECT status,COUNT(*) AS count FROM orders WHERE deleted_at IS NULL GROUP BY status');
    const daily=[];for(let i=6;i>=0;i--){const day=new Date();day.setHours(0,0,0,0);day.setDate(day.getDate()-i);const from=day.getTime();const row=await ctx.db.one("SELECT COUNT(*) AS orders,COALESCE(SUM(amount),0) AS amount FROM payments WHERE created_at>=? AND created_at<? AND status='success'",[from,from+86400000]);daily.push({label:`${day.getMonth()+1}/${day.getDate()}`,orders:Number(row!.orders),amount:Number(row!.amount)});}
    return result(req,{...totals,members,refunds,lowStock,statuses,daily,outbox:await ctx.db.one("SELECT COUNT(*) AS pending FROM outbox WHERE status!='sent'")});
  });
  app.get<{Querystring:Record<string,any>}>('/api/admin/products',options('catalog.read',{querystring:{...catalogQuery,properties:{...catalogQuery.properties,active:{type:'string',enum:['','0','1']}}}}),async req=>result(req,await ctx.catalog.list(req.query,true)));
  app.get<{Params:{id:string}}>('/api/admin/products/:id',options('catalog.read',{params:idParams}),async req=>{
    const item=await ctx.db.one('SELECT * FROM products WHERE id=? AND deleted_at IS NULL',[req.params.id]);ensure(item,404,'PRODUCT_NOT_FOUND','商品不存在');return result(req,item);
  });
  app.delete<{Params:{id:string}}>('/api/admin/products/:id',options('products.delete',{params:idParams}),async req=>{await ctx.catalog.remove(req.params.id,req.actor.id,req.id);return result(req,null);});
  app.post<{Body:Record<string,any>}>('/api/admin/products',options('products',{body:productBody}),async req=>result(req,await ctx.catalog.save(req.body,req.actor.id,req.id)));
  app.put<{Params:{id:string};Body:Record<string,any>}>('/api/admin/products/:id',options('products',{params:idParams,body:productBody}),async req=>result(req,await ctx.catalog.save(req.body,req.actor.id,req.id,req.params.id)));
  app.post<{Params:{id:string};Body:{delta:number;reason:string}}>('/api/admin/products/:id/stock',options('stock',{params:idParams,body:{type:'object',required:['delta','reason'],additionalProperties:false,properties:{delta:{type:'integer',minimum:-100000,maximum:100000},reason:text(200)}}}),async req=>result(req,await ctx.catalog.stock(req.params.id,req.body.delta,req.actor.id,req.body.reason,req.id)));
  app.get<{Querystring:Record<string,any>}>('/api/admin/orders',options('orders',{querystring:orderQuery}),async req=>{
    const p=pagination(req.query),clauses=['deleted_at IS NULL'],params:any[]=[];
    if(req.query.status){clauses.push('status=?');params.push(req.query.status);}
    if(req.query.q?.trim()){clauses.push("(LOWER(id) LIKE ? ESCAPE '!' OR LOWER(address_snapshot) LIKE ? ESCAPE '!')");params.push(like(req.query.q),like(req.query.q));}
    const where=' WHERE '+clauses.join(' AND ');
    const rows=await ctx.db.all('SELECT id FROM orders'+where+' ORDER BY created_at DESC LIMIT ? OFFSET ?',[...params,p.pageSize,p.offset]);
    const items=await Promise.all(rows.map(row=>ctx.repo.detail(row.id)));
    for(const item of items) {item.address.phone=maskPhone(item.address.phone);delete item.address_snapshot;}
    return result(req,{items,total:Number((await ctx.db.one('SELECT COUNT(*) AS count FROM orders'+where,params))!.count),page:p.page,pageSize:p.pageSize});
  });
  app.get<{Params:{id:string}}>('/api/admin/orders/:id',options('orders',{params:idParams}),async req=>result(req,hidePhone(await ctx.repo.detail(req.params.id))));
  app.put<{Params:{id:string};Body:{name:string;phone:string;detail:string;deliverySlot:string;note:string}}>('/api/admin/orders/:id',options('orders.manage',{params:idParams,body:{type:'object',additionalProperties:false,required:['name','phone','detail','deliverySlot','note'],properties:{name:text(40),phone:{type:'string',pattern:'^(|1[3-9][0-9]{9})$'},detail:{...text(200),minLength:8},deliverySlot:{type:'string',enum:['尽快送达','今日 18:00–20:00','明日 09:00–12:00','明日 14:00–18:00']},note:{type:'string',maxLength:200}}}}),async req=>result(req,hidePhone(await ctx.orders.updateDelivery(req.params.id,req.body,req.actor.id,req.id))));
  app.post<{Params:{id:string}}>('/api/admin/orders/:id/cancel',options('orders.manage',{params:idParams}),async req=>{const item=await ctx.orders.cancel(req.params.id,undefined,req.id,req.actor.id);await ctx.runtime.invalidate();return result(req,hidePhone(item));});
  app.delete<{Params:{id:string}}>('/api/admin/orders/:id',options('orders.delete',{params:idParams}),async req=>{await ctx.orders.remove(req.params.id,req.actor.id,req.id);return result(req,null);});
  app.post<{Params:{id:string};Body:{status:string}}>('/api/admin/orders/:id/status',options('fulfillment',{params:idParams,body:{type:'object',required:['status'],additionalProperties:false,properties:{status:{type:'string',enum:['picking','delivering']}}}}),async req=>{const item=await ctx.orders.transition(req.params.id,req.body.status,req.actor.id,req.id);item.address.phone=maskPhone(item.address.phone);delete item.address_snapshot;return result(req,item);});
  app.get<{Querystring:Record<string,any>}>('/api/admin/refunds',options('refunds',{querystring:refundQuery}),async req=>{
    const p=pagination(req.query),clauses:string[]=[],params:any[]=[];
    if(req.query.status){clauses.push('status=?');params.push(req.query.status);}
    if(req.query.q?.trim()){clauses.push("(LOWER(order_id) LIKE ? ESCAPE '!' OR LOWER(reason) LIKE ? ESCAPE '!')");params.push(like(req.query.q),like(req.query.q));}
    const where=clauses.length?' WHERE '+clauses.join(' AND '):'';
    return result(req,{items:await ctx.db.all('SELECT * FROM refunds'+where+' ORDER BY created_at DESC LIMIT ? OFFSET ?',[...params,p.pageSize,p.offset]),total:Number((await ctx.db.one('SELECT COUNT(*) AS count FROM refunds'+where,params))!.count),page:p.page,pageSize:p.pageSize});
  });
  app.get<{Params:{id:string}}>('/api/admin/refunds/:id',options('refunds',{params:idParams}),async req=>{
    const item=await ctx.db.one('SELECT * FROM refunds WHERE id=?',[req.params.id]);ensure(item,404,'REFUND_NOT_FOUND','退款申请不存在');return result(req,{...item,order:hidePhone(await ctx.repo.detail(item.order_id))});
  });
  app.post<{Params:{id:string};Body:{approve:boolean;note:string}}>('/api/admin/refunds/:id/decision',options('refunds',{params:idParams,body:{type:'object',required:['approve','note'],additionalProperties:false,properties:{approve:{type:'boolean'},note:{...text(200),pattern:'\\S'}}}}),async req=>{await ctx.orders.decideRefund(req.params.id,req.body.approve,req.actor.id,req.body.note,req.id);await ctx.runtime.invalidate();return result(req,null);});
  app.get<{Querystring:Record<string,any>}>('/api/admin/settlements',options('settlements',{querystring:searchQuery}),async req=>{
    const p=pagination(req.query),where=req.query.q?.trim()?" WHERE LOWER(id) LIKE ? ESCAPE '!' OR LOWER(order_id) LIKE ? ESCAPE '!' OR LOWER(operator_id) LIKE ? ESCAPE '!'":'',params=where?Array(3).fill(like(req.query.q)):[];
    return result(req,{items:await ctx.db.all('SELECT * FROM settlements'+where+' ORDER BY created_at DESC,id LIMIT ? OFFSET ?',[...params,p.pageSize,p.offset]),total:Number((await ctx.db.one('SELECT COUNT(*) AS count FROM settlements'+where,params))!.count),amount:Number((await ctx.db.one('SELECT COALESCE(SUM(amount),0) AS amount FROM settlements'+where,params))!.amount),page:p.page,pageSize:p.pageSize});
  });
  app.post('/api/admin/settlements',options('settlements'),async req=>result(req,await ctx.orders.settle(req.actor.id,req.id)));
  for(const [path,type] of [['users','staff'],['members','member']] as const) {
    const accountQuery={...searchQuery,properties:{...searchQuery.properties,active:{type:'string',enum:['','0','1']},role:{type:'string',enum:['',...(type==='staff'?staffRoles:['member'])]}}};
    const properties={username,name:{...text(40),pattern:'\\S'},password,...(type==='staff'?{role:{type:'string',enum:staffRoles}}:{})};
    app.get<{Querystring:Record<string,any>}>('/api/admin/'+path,options('users',{querystring:accountQuery}),async req=>{
      const p=pagination(req.query),clauses=['deleted_at IS NULL',type==='member'?"role='member'":"role IN ('operator','warehouse','support','finance','admin')"],params:any[]=[];
      if(req.query.q?.trim()){clauses.push("(LOWER(username) LIKE ? ESCAPE '!' OR LOWER(name) LIKE ? ESCAPE '!')");params.push(like(req.query.q),like(req.query.q));}
      if(req.query.active==='0' || req.query.active==='1'){clauses.push('active=?');params.push(Number(req.query.active));}
      if(req.query.role){clauses.push('role=?');params.push(req.query.role);}
      const where=' WHERE '+clauses.join(' AND ');
      const users=await ctx.db.all('SELECT id,username,name,role,active,created_at FROM users'+where+' ORDER BY created_at DESC,id LIMIT ? OFFSET ?',[...params,p.pageSize,p.offset]);
      return result(req,{items:users.map(publicUser),total:Number((await ctx.db.one('SELECT COUNT(*) AS count FROM users'+where,params))!.count),page:p.page,pageSize:p.pageSize});
    });
    app.get<{Params:{id:string}}>('/api/admin/'+path+'/:id',options('users',{params:idParams}),async req=>{
      const user=await ctx.db.one('SELECT id,username,name,role,active,created_at FROM users WHERE id=? AND deleted_at IS NULL',[req.params.id]);
      ensure(user && (type==='member'?user.role==='member':staffRoles.includes(user.role)),404,'USER_NOT_FOUND','账号不存在');return result(req,publicUser(user));
    });
    app.post<{Body:{username:string;name:string;password:string;role:Role}}>('/api/admin/'+path,options('users',{body:{type:'object',additionalProperties:false,required:['username','name','password',...(type==='staff'?['role']:[])],properties}}),async req=>result(req,type==='staff'?await ctx.accounts.createStaff(req.body,req.actor.id,req.id):await ctx.accounts.createMember(req.body,req.actor.id,req.id)));
    app.put<{Params:{id:string};Body:{username:string;name:string;password?:string;role?:Role;active:number}}>('/api/admin/'+path+'/:id',options('users',{params:idParams,body:{type:'object',additionalProperties:false,required:['username','name','active',...(type==='staff'?['role']:[])],properties:{...properties,active}}}),async req=>result(req,await ctx.accounts.updateAccount(req.params.id,type,req.body,req.actor.id,req.id)));
    app.delete<{Params:{id:string}}>('/api/admin/'+path+'/:id',options('users.delete',{params:idParams}),async req=>{await ctx.accounts.removeAccount(req.params.id,type,req.actor.id,req.id);return result(req,null);});
  }
  app.put<{Params:{id:string};Body:{role:Role}}>('/api/admin/users/:id/role',options('users',{params:idParams,body:{type:'object',required:['role'],additionalProperties:false,properties:{role:{type:'string',enum:staffRoles}}}}),async req=>{
    return result(req,await ctx.accounts.updateAccount(req.params.id,'staff',req.body,req.actor.id,req.id));
  });
  app.get<{Querystring:Record<string,any>}>('/api/admin/audit',options('audit',{querystring:searchQuery}),async req=>{
    const p=pagination(req.query),where=req.query.q?.trim()?" WHERE LOWER(action) LIKE ? ESCAPE '!' OR LOWER(actor_id) LIKE ? ESCAPE '!' OR LOWER(entity_id) LIKE ? ESCAPE '!' OR LOWER(trace_id) LIKE ? ESCAPE '!'":'',params=where?Array(4).fill(like(req.query.q)):[];
    return result(req,{items:await ctx.db.all('SELECT * FROM audit_logs'+where+' ORDER BY created_at DESC,id LIMIT ? OFFSET ?',[...params,p.pageSize,p.offset]),total:Number((await ctx.db.one('SELECT COUNT(*) AS count FROM audit_logs'+where,params))!.count),page:p.page,pageSize:p.pageSize});
  });
}
