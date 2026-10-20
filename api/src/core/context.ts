import type { Database, Row } from './database.js';
import type { Runtime } from './runtime.js';
import type { AccountService } from '../modules/accounts/service.js';
import type { CatalogService } from '../modules/catalog/service.js';
import type { OrderService } from '../modules/orders/service.js';
import type { OrderRepository } from '../modules/orders/repository.js';
import type { CouponService } from '../modules/promotions/coupons.js';
import type { SeckillService } from '../modules/promotions/seckill.js';
import type { FastifyRequest } from 'fastify';
import type { AccountType } from './security.js';
export interface Context { db:Database;runtime:Runtime;accounts:AccountService;catalog:CatalogService;orders:OrderService;repo:OrderRepository;coupons:CouponService;seckill:SeckillService;authenticate:(req:FastifyRequest)=>Promise<void>;memberOnly:(req:FastifyRequest)=>Promise<void>;staffOnly:(req:FastifyRequest)=>Promise<void>;permit:(capability:string)=>(req:FastifyRequest)=>Promise<void>;viewer:(req:FastifyRequest)=>Promise<string|undefined>; }
declare module 'fastify' { interface FastifyRequest { actor:Row; } }
declare module '@fastify/jwt' { interface FastifyJWT {payload:{sub:string;accountType:AccountType;sessionVersion?:number};user:{sub:string;accountType:AccountType;sessionVersion?:number};} }
