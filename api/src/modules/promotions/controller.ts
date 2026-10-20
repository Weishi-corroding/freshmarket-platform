import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Context } from '../../core/context.js';
import { deliverySlot, idParams, pageQuery, result, text } from '../../core/http.js';

const int=(minimum:number,maximum:number)=>({type:'integer',minimum,maximum});
const time=int(0,4102444800000),active={type:'integer',enum:[0,1]};
const couponBody={type:'object',additionalProperties:false,required:['name','kind','threshold','value','max_discount','category_id','total','valid_from','valid_to','active'],properties:{name:{...text(40),pattern:'\\S'},kind:{type:'string',enum:['amount','percent']},threshold:int(0,10000000),value:int(1,10000000),max_discount:int(0,10000000),category_id:{type:'string',maxLength:40},total:int(1,1000000),valid_from:time,valid_to:time,active}};
const seckillBody={type:'object',additionalProperties:false,required:['product_id','title','price','stock','start_at','end_at','active'],properties:{product_id:text(100),title:{...text(40),pattern:'\\S'},price:int(1,10000000),stock:int(1,100000),start_at:time,end_at:time,active}};
const checkoutBody={type:'object',required:['addressId','deliverySlot'],additionalProperties:false,properties:{addressId:text(100),deliverySlot,note:{type:'string',maxLength:200}}};
// 抢券/秒杀按会员限流：键取自验签后的令牌主体，重复登录或伪造令牌不能获得新的计数桶；无效令牌退回按客户端 IP
const memberKey=(req:FastifyRequest)=>{const token=/^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1];if(token)try{return 'member:'+(req.server.jwt.verify(token) as {sub:string}).sub;}catch{}return 'ip:'+req.ip;};
const perMember=(max:number)=>({rateLimit:{max,timeWindow:'1 minute',keyGenerator:memberKey}});
export async function promotionRoutes(app:FastifyInstance,ctx:Context) {
  const security=[{bearerAuth:[]}];
  app.get('/api/coupons',{schema:{tags:['优惠券']}},async req=>result(req,await ctx.coupons.center(await ctx.viewer(req))));
  app.post<{Params:{id:string}}>('/api/coupons/:id/claim',{preHandler:ctx.memberOnly,config:perMember(30),schema:{tags:['优惠券'],security,params:idParams}},async req=>result(req,await ctx.coupons.claim(req.actor.id,req.params.id,req.id)));
  app.get('/api/my/coupons',{preHandler:ctx.memberOnly,schema:{tags:['优惠券'],security}},async req=>result(req,await ctx.coupons.mine(req.actor.id)));
  app.get('/api/cart/coupons',{preHandler:ctx.memberOnly,schema:{tags:['优惠券'],security}},async req=>result(req,await ctx.coupons.checkout(req.actor.id)));
  // 首页一次请求同时返回秒杀与领券中心，减少首屏请求数
  app.get('/api/promotions',{schema:{tags:['秒杀','优惠券']}},async req=>{const viewer=await ctx.viewer(req),seckill=await ctx.seckill.list(viewer);return result(req,{now:seckill.now,seckill:seckill.items,coupons:await ctx.coupons.center(viewer)});});
  app.get('/api/seckill',{schema:{tags:['秒杀']}},async req=>result(req,await ctx.seckill.list(await ctx.viewer(req))));
  app.post<{Params:{id:string};Body:{addressId:string;deliverySlot:string;note?:string};Headers:{'idempotency-key':string}}>('/api/seckill/:id/orders',{
    preHandler:ctx.memberOnly,config:perMember(20),schema:{tags:['秒杀'],security,params:idParams,headers:{type:'object',required:['idempotency-key'],properties:{'idempotency-key':{type:'string',minLength:8,maxLength:100}}},body:checkoutBody}
  },async req=>{const order=await ctx.seckill.order(req.actor.id,req.params.id,req.headers['idempotency-key'],req.body,req.id);await ctx.runtime.invalidate();return result(req,order);});
  const staff=(schema:any={})=>({preHandler:ctx.permit('promotions'),schema:{tags:['营销活动'],security,...schema}});
  const searchQuery={...pageQuery,properties:{...pageQuery.properties,q:{type:'string',maxLength:80}}};
  app.get<{Querystring:Record<string,any>}>('/api/admin/coupons',staff({querystring:searchQuery}),async req=>result(req,await ctx.coupons.list(req.query)));
  app.post<{Body:Record<string,any>}>('/api/admin/coupons',staff({body:couponBody}),async req=>result(req,await ctx.coupons.save(req.body,req.actor.id,req.id)));
  app.put<{Params:{id:string};Body:Record<string,any>}>('/api/admin/coupons/:id',staff({params:idParams,body:couponBody}),async req=>result(req,await ctx.coupons.save(req.body,req.actor.id,req.id,req.params.id)));
  app.get<{Querystring:Record<string,any>}>('/api/admin/seckill',staff({querystring:pageQuery}),async req=>result(req,await ctx.seckill.adminList(req.query)));
  app.post<{Body:Record<string,any>}>('/api/admin/seckill',staff({body:seckillBody}),async req=>{const item=await ctx.seckill.save(req.body,req.actor.id,req.id);await ctx.runtime.invalidate();return result(req,item);});
  app.put<{Params:{id:string};Body:Record<string,any>}>('/api/admin/seckill/:id',staff({params:idParams,body:seckillBody}),async req=>{const item=await ctx.seckill.save(req.body,req.actor.id,req.id,req.params.id);await ctx.runtime.invalidate();return result(req,item);});
}
