import type { FastifyRequest } from 'fastify';
export function result(req: FastifyRequest,data: unknown) { return {code:0,message:'success',data,traceId:req.id}; }
export const pageQuery = {type:'object',properties:{page:{type:'integer',minimum:1,default:1},pageSize:{type:'integer',minimum:1,maximum:100,default:20},status:{type:'string',maxLength:40}},additionalProperties:false};
export function pagination(query: any) { const page=Number(query?.page || 1), pageSize=Number(query?.pageSize || 20); return {page,pageSize,offset:(page-1)*pageSize}; }
export const idParams = {type:'object',required:['id'],properties:{id:{type:'string',minLength:1,maxLength:100}},additionalProperties:false};
export const text = (maxLength=200) => ({type:'string',minLength:1,maxLength});
export const deliverySlots = ['尽快送达','今日 18:00–20:00','明日 09:00–12:00','明日 14:00–18:00'];
export const deliverySlot = {type:'string',enum:deliverySlots};
