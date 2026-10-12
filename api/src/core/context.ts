import type { Database, Row } from './database.js';
import type { Runtime } from './runtime.js';
import type { AccountService } from '../modules/accounts/service.js';
import type { CatalogService } from '../modules/catalog/service.js';
import type { OrderService } from '../modules/orders/service.js';
import type { OrderRepository } from '../modules/orders/repository.js';
import type { FastifyRequest } from 'fastify';
export interface Context { db:Database;runtime:Runtime;accounts:AccountService;catalog:CatalogService;orders:OrderService;repo:OrderRepository;authenticate:(req:FastifyRequest)=>Promise<void>;permit:(capability:string)=>(req:FastifyRequest)=>Promise<void>; }
declare module 'fastify' { interface FastifyRequest { actor:Row; } }
declare module '@fastify/jwt' { interface FastifyJWT {payload:{sub:string};user:{sub:string};} }
