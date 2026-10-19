import type { FastifyInstance } from 'fastify';
import type { Context } from '../../core/context.js';
import { idParams, result, text } from '../../core/http.js';
import { publicUser } from '../../core/security.js';

const addressBody={type:'object',required:['name','phone','detail','isDefault'],additionalProperties:false,properties:{name:text(40),phone:{type:'string',pattern:'^1[3-9][0-9]{9}$'},detail:{...text(200),minLength:8},isDefault:{type:'boolean'}}};
export async function accountRoutes(app:FastifyInstance,ctx:Context) {
  app.post<{Body:{username:string;password:string;name:string}}>('/api/auth/register',{
    config:{rateLimit:{max:8,timeWindow:'1 minute'}},schema:{tags:['账号'],body:{type:'object',required:['username','password','name'],additionalProperties:false,properties:{username:{type:'string',pattern:'^[a-zA-Z0-9_@.]{3,60}$'},password:{type:'string',minLength:10,maxLength:128,pattern:'^(?=.*[A-Za-z])(?=.*[0-9]).+$'},name:text(40)}}}
  },async req=>{const user=await ctx.accounts.register(req.body,req.id);return result(req,{user,token:app.jwt.sign({sub:user.id,accountType:'member',sessionVersion:0})});});
  app.post<{Body:{username:string;password:string}}>('/api/auth/login',{
    config:{rateLimit:{max:10,timeWindow:'1 minute'}},schema:{tags:['账号'],body:{type:'object',required:['username','password'],additionalProperties:false,properties:{username:text(60),password:text(128)}}}
  },async req=>{const {user,claims}=await ctx.accounts.login(req.body.username,req.body.password,req.id,'member');return result(req,{user,token:app.jwt.sign(claims)});});
  app.post<{Body:{username:string;password:string}}>('/api/admin/auth/login',{
    config:{rateLimit:{max:10,timeWindow:'1 minute'}},schema:{tags:['员工账号'],body:{type:'object',required:['username','password'],additionalProperties:false,properties:{username:text(60),password:text(128)}}}
  },async req=>{const {user,claims}=await ctx.accounts.login(req.body.username,req.body.password,req.id,'staff');return result(req,{user,token:app.jwt.sign(claims)});});
  app.get('/api/admin/auth/me',{preHandler:ctx.staffOnly,schema:{tags:['员工账号'],security:[{bearerAuth:[]}]}},async req=>result(req,publicUser(req.actor)));
  app.get('/api/auth/me',{preHandler:ctx.memberOnly,schema:{tags:['账号'],security:[{bearerAuth:[]}]}},async req=>result(req,publicUser(req.actor)));
  app.get('/api/cart',{preHandler:ctx.memberOnly,schema:{tags:['购物车'],security:[{bearerAuth:[]}]}},async req=>result(req,await ctx.accounts.cart(req.actor.id)));
  app.post<{Body:{productId:string;quantity:number}}>('/api/cart',{preHandler:ctx.memberOnly,schema:{tags:['购物车'],security:[{bearerAuth:[]}],body:{type:'object',required:['productId','quantity'],additionalProperties:false,properties:{productId:text(100),quantity:{type:'integer',minimum:1,maximum:99}}}}},async req=>result(req,await ctx.accounts.setCart(req.actor.id,req.body.productId,req.body.quantity,true)));
  app.put<{Params:{id:string};Body:{quantity:number}}>('/api/cart/:id',{preHandler:ctx.memberOnly,schema:{tags:['购物车'],security:[{bearerAuth:[]}],params:idParams,body:{type:'object',required:['quantity'],additionalProperties:false,properties:{quantity:{type:'integer',minimum:0,maximum:99}}}}},async req=>result(req,await ctx.accounts.setCart(req.actor.id,req.params.id,req.body.quantity,false)));
  app.get('/api/addresses',{preHandler:ctx.memberOnly,schema:{tags:['地址'],security:[{bearerAuth:[]}]}},async req=>result(req,await ctx.db.all('SELECT * FROM addresses WHERE user_id=? ORDER BY is_default DESC,id',[req.actor.id])));
  app.post<{Body:{name:string;phone:string;detail:string;isDefault:boolean}}>('/api/addresses',{preHandler:ctx.memberOnly,schema:{tags:['地址'],security:[{bearerAuth:[]}],body:addressBody}},async req=>result(req,await ctx.accounts.saveAddress(req.actor.id,req.body)));
  app.put<{Params:{id:string};Body:{name:string;phone:string;detail:string;isDefault:boolean}}>('/api/addresses/:id',{preHandler:ctx.memberOnly,schema:{tags:['地址'],security:[{bearerAuth:[]}],params:idParams,body:addressBody}},async req=>result(req,await ctx.accounts.saveAddress(req.actor.id,req.body,req.params.id)));
  app.delete<{Params:{id:string}}>('/api/addresses/:id',{preHandler:ctx.memberOnly,schema:{tags:['地址'],security:[{bearerAuth:[]}],params:idParams}},async req=>{await ctx.db.run('DELETE FROM addresses WHERE id=? AND user_id=?',[req.params.id,req.actor.id]);return result(req,null);});
  app.get('/api/notifications',{preHandler:ctx.memberOnly,schema:{tags:['账号'],security:[{bearerAuth:[]}]}},async req=>result(req,await ctx.db.all('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 30',[req.actor.id])));
}
