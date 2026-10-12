import type { FastifyInstance } from 'fastify';
import type { Context } from '../../core/context.js';
import { idParams, result } from '../../core/http.js';
export const catalogQuery={type:'object',additionalProperties:false,properties:{q:{type:'string',maxLength:80},category:{type:'string',maxLength:40},sort:{type:'string',enum:['default','priceAsc','priceDesc','sales'],default:'default'},page:{type:'integer',minimum:1,default:1},pageSize:{type:'integer',minimum:1,maximum:100,default:12}}};
export async function catalogRoutes(app:FastifyInstance,ctx:Context) {
  app.get('/api/categories',{schema:{tags:['商品']}},async req=>result(req,await ctx.db.all("SELECT * FROM categories ORDER BY CASE id WHEN 'fruit' THEN 1 WHEN 'seafood' THEN 2 WHEN 'meat' THEN 3 WHEN 'vegetable' THEN 4 WHEN 'dairy' THEN 5 ELSE 6 END")));
  app.get<{Querystring:Record<string,any>}>('/api/products',{schema:{tags:['商品'],querystring:catalogQuery}},async req=>result(req,await ctx.catalog.list(req.query)));
  app.get<{Params:{id:string}}>('/api/products/:id',{schema:{tags:['商品'],params:idParams}},async req=>result(req,await ctx.catalog.detail(req.params.id)));
}
