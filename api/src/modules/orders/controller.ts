import type { FastifyInstance } from 'fastify';
import type { Context } from '../../core/context.js';
import { deliverySlot, idParams, pageQuery, pagination, result, text } from '../../core/http.js';
export async function orderRoutes(app:FastifyInstance,ctx:Context) {
  const authenticated={preHandler:ctx.memberOnly};
  app.post<{Body:{addressId:string;deliverySlot:string;note?:string;couponId?:string};Headers:{'idempotency-key':string}}>('/api/orders',{
    ...authenticated,schema:{tags:['订单'],security:[{bearerAuth:[]}],headers:{type:'object',required:['idempotency-key'],properties:{'idempotency-key':{type:'string',minLength:8,maxLength:100}}},
      body:{type:'object',required:['addressId','deliverySlot'],additionalProperties:false,properties:{addressId:text(100),deliverySlot,note:{type:'string',maxLength:200},couponId:text(100)}}}
  },async req=>{const order=await ctx.orders.create(req.actor.id,req.headers['idempotency-key'],req.body,req.id);await ctx.runtime.invalidate();return result(req,order);});
  app.get<{Querystring:Record<string,any>}>('/api/orders',{...authenticated,schema:{tags:['订单'],security:[{bearerAuth:[]}],querystring:pageQuery}},async req=>{
    const p=pagination(req.query),where=' WHERE user_id=? AND deleted_at IS NULL'+(req.query.status?' AND status=?':''),params=[req.actor.id];if(req.query.status)params.push(req.query.status);
    const rows=await ctx.db.all('SELECT id FROM orders'+where+' ORDER BY created_at DESC LIMIT ? OFFSET ?',[...params,p.pageSize,p.offset]);
    return result(req,{items:await Promise.all(rows.map(row=>ctx.repo.detail(row.id,req.actor.id))),total:Number((await ctx.db.one('SELECT COUNT(*) AS count FROM orders'+where,params))!.count),page:p.page,pageSize:p.pageSize});
  });
  app.get<{Params:{id:string}}>('/api/orders/:id',{...authenticated,schema:{tags:['订单'],security:[{bearerAuth:[]}],params:idParams}},async req=>result(req,await ctx.repo.detail(req.params.id,req.actor.id)));
  app.post<{Params:{id:string}}>('/api/orders/:id/pay',{...authenticated,schema:{tags:['支付沙箱'],security:[{bearerAuth:[]}],params:idParams}},async req=>{const order=await ctx.orders.pay(req.params.id,req.actor.id,req.id);await ctx.runtime.invalidate();return result(req,order);});
  app.post<{Params:{id:string}}>('/api/orders/:id/cancel',{...authenticated,schema:{tags:['订单'],security:[{bearerAuth:[]}],params:idParams}},async req=>{const order=await ctx.orders.cancel(req.params.id,req.actor.id,req.id);await ctx.runtime.invalidate();return result(req,order);});
  app.post<{Params:{id:string}}>('/api/orders/:id/receive',{...authenticated,schema:{tags:['订单'],security:[{bearerAuth:[]}],params:idParams}},async req=>result(req,await ctx.orders.transition(req.params.id,'completed',req.actor.id,req.id,true)));
  app.post<{Params:{id:string};Body:{reason:string;amount?:number;items?:{productId:string;quantity:number}[]}}>('/api/orders/:id/refund',{...authenticated,schema:{tags:['售后'],security:[{bearerAuth:[]}],params:idParams,body:{type:'object',required:['reason'],additionalProperties:false,properties:{reason:{...text(300),minLength:5},amount:{type:'integer',minimum:1,maximum:100000000},items:{type:'array',maxItems:50,items:{type:'object',required:['productId','quantity'],additionalProperties:false,properties:{productId:text(100),quantity:{type:'integer',minimum:1,maximum:99}}}}}}}},async req=>result(req,await ctx.orders.requestRefund(req.params.id,req.actor.id,req.body,req.id)));
  app.post<{Params:{id:string};Body:{productId:string;rating:number;content:string}}>('/api/orders/:id/reviews',{...authenticated,schema:{tags:['评价'],security:[{bearerAuth:[]}],params:idParams,body:{type:'object',required:['productId','rating','content'],additionalProperties:false,properties:{productId:text(100),rating:{type:'integer',minimum:1,maximum:5},content:{...text(500),minLength:3}}}}},async req=>result(req,await ctx.accounts.review(req.actor.id,req.params.id,req.body,req.id)));
}
