import Fastify, {type FastifyError} from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import { Registry, Histogram, Counter, Gauge, collectDefaultMetrics } from 'prom-client';
import { createDatabase,type Database } from './core/database.js';
import { BusinessError,ensure } from './core/errors.js';
import { result } from './core/http.js';
import { accountType,capabilities,type Role } from './core/security.js';
import { Runtime } from './core/runtime.js';
import { endRequestSpan, flushTracing, initTracing, requestSpan, runInRequest, startRequestSpan, traceDatabase, tracingMode } from './core/tracing.js';
import type { Context } from './core/context.js';
import { seed } from './modules/catalog/seed.js';
import { OrderRepository } from './modules/orders/repository.js';
import { OrderService } from './modules/orders/service.js';
import { AccountService } from './modules/accounts/service.js';
import { CatalogService } from './modules/catalog/service.js';
import { CouponService } from './modules/promotions/coupons.js';
import { SeckillService } from './modules/promotions/seckill.js';
import { promotionRoutes } from './modules/promotions/controller.js';
import { accountRoutes } from './modules/accounts/controller.js';
import { catalogRoutes } from './modules/catalog/controller.js';
import { orderRoutes } from './modules/orders/controller.js';
import { adminRoutes } from './modules/admin/controller.js';

// TRUST_PROXY：数字表示信任的代理层数（Docker 中 Nginx 为 1），也可填 IP/CIDR 列表；未设置时不信任转发头，避免伪造 X-Forwarded-For 绕过限流
const trustProxy=(value?:string)=>!value?false:/^\d+$/.test(value)?(_address:string,hop:number)=>hop<Number(value):value.split(',').map(v=>v.trim());
export async function buildApp(options:{db?:Database;logger?:boolean;workers?:boolean;seed?:boolean}={}) {
  const secret=process.env.JWT_SECRET || 'local-development-only-change-this-secret-2026';
  if(process.env.NODE_ENV==='production') {
    ensure(secret.length>=32 && !secret.startsWith('local-development'),500,'CONFIG_INVALID','Production JWT_SECRET must be a unique secret with at least 32 characters');
    ensure(process.env.DATABASE_URL,500,'CONFIG_INVALID','Production requires PostgreSQL DATABASE_URL');
    if(process.env.SEED_DEMO!=='false')ensure(process.env.DEMO_PASSWORD && process.env.DEMO_PASSWORD.length>=12 && process.env.DEMO_PASSWORD!=='Fresh@123456',500,'CONFIG_INVALID','Production demo seeding requires a unique DEMO_PASSWORD of at least 12 characters');
  }
  initTracing();
  // 请求 ID 即 W3C traceId：接收上游 traceparent 时沿用其 trace，否则新建
  const app=Fastify({logger:options.logger===false?false:{level:process.env.LOG_LEVEL || 'info',redact:['req.headers.authorization','password','password_hash']},genReqId:raw=>startRequestSpan(raw),trustProxy:trustProxy(process.env.TRUST_PROXY),bodyLimit:64*1024,ajv:{customOptions:{removeAdditional:false}}});
  app.decorateRequest('actor',null as unknown as import('./core/database.js').Row);
  const db=traceDatabase(options.db || await createDatabase(process.env.DATABASE_URL,process.env.SQLITE_PATH || '.runtime/freshmarket.sqlite'));
  await db.migrate();if(options.seed!==false && process.env.SEED_DEMO!=='false')await seed(db);
  const repo=new OrderRepository(db),orders=new OrderService(repo,Number(process.env.ORDER_TTL_MINUTES || 15),Number(process.env.SECKILL_TTL_MINUTES || 5));
  const runtime=new Runtime(db,app.log),accounts=new AccountService(db,repo),catalog=new CatalogService(db,repo,runtime);
  const coupons=new CouponService(db,repo),seckill=new SeckillService(db,repo,orders,runtime);
  await app.register(cors,{origin:(process.env.CORS_ORIGIN || 'http://localhost:5173').split(','),credentials:false});
  await app.register(helmet);
  await app.register(jwt,{secret,sign:{expiresIn:'2h'}});
  await app.register(rateLimit,{max:300,timeWindow:'1 minute'});
  await app.register(swagger,{openapi:{info:{title:'鲜境 FreshMarket API',description:'金额单位为分。开发模式为持久化 SQLite，生产部署为 PostgreSQL。支付端点仅为沙箱。',version:'1.0.0'},components:{securitySchemes:{bearerAuth:{type:'http',scheme:'bearer',bearerFormat:'JWT'}}}}});
  await app.register(swaggerUI,{routePrefix:'/api/docs'});
  const registry=new Registry();collectDefaultMetrics({register:registry});
  new Gauge({name:'fresh_dependency_up',help:'Database probe and configured cache/queue connection readiness',labelNames:['dependency'],registers:[registry],async collect(){
    try {await db.one('SELECT 1 AS ok');this.set({dependency:'database'},1);}catch {this.set({dependency:'database'},0);}
    if(process.env.REDIS_URL)this.set({dependency:'cache'},runtime.redis?.isReady?1:0);
    if(process.env.AMQP_URL)this.set({dependency:'queue'},runtime.channel?1:0);
  }});
  new Gauge({name:'fresh_outbox_oldest_pending_seconds',help:'Age of oldest pending or processing event',registers:[registry],async collect(){
    try {const row=await db.one("SELECT MIN(created_at) AS oldest FROM outbox WHERE status IN ('pending','processing')");this.set(row?.oldest==null?0:Math.max(0,(Date.now()-Number(row.oldest))/1000));}catch {this.set(NaN);}
  }});
  const latency=new Histogram({name:'fresh_http_duration_seconds',help:'HTTP request duration',labelNames:['method','route','status'],buckets:[.01,.025,.05,.1,.25,.5,1,2,5],registers:[registry]});
  const count=new Counter({name:'fresh_http_requests_total',help:'HTTP requests',labelNames:['method','route','status'],registers:[registry]});
  const starts=new WeakMap<object,bigint>();
  app.addHook('onRequest',(req,reply,done)=>{starts.set(req,process.hrtime.bigint());reply.header('x-trace-id',req.id);runInRequest(req.raw,done);});
  app.addHook('onResponse',async(req,reply)=>{endRequestSpan(req.raw,req.routeOptions.url || 'unknown',req.method,reply.statusCode,req.actor?.id);if(req.url==='/api/metrics')return;const labels={method:req.method,route:req.routeOptions.url || 'unknown',status:String(reply.statusCode)};count.inc(labels);latency.observe(labels,Number(process.hrtime.bigint()-(starts.get(req) || process.hrtime.bigint()))/1e9);});
  app.setErrorHandler((unknownError,req,reply)=>{
    const error=unknownError as FastifyError;
    const status=error instanceof BusinessError?error.status:(error.validation?400:((error.statusCode && error.statusCode<500)?error.statusCode:500));
    const code=error instanceof BusinessError?error.code:(error.validation?'VALIDATION_ERROR':status===401?'UNAUTHORIZED':status===429?'RATE_LIMITED':'INTERNAL_ERROR');
    const message=error instanceof BusinessError?error.message:error.validation?'请检查输入内容':status===401?'请先登录':status===429?'操作太频繁，请稍后重试':'服务暂时不可用，请稍后重试';
    if(status>=500){req.log.error({err:error,traceId:req.id},'request_failed');requestSpan(req.raw)?.recordException(error);}
    reply.code(status).send({code,message,data:null,traceId:req.id});
  });
  app.setNotFoundHandler((req,reply)=>reply.code(404).send({code:'NOT_FOUND',message:'接口不存在',data:null,traceId:req.id}));
  const authenticate:Context['authenticate']=async req=>{
    await req.jwtVerify();
    const user=await db.one('SELECT id,username,name,role,active,session_version,created_at FROM users WHERE id=? AND deleted_at IS NULL',[req.user.sub]);
    ensure(user,401,'UNAUTHORIZED','账号已删除或登录已失效');
    ensure(user.active===1,401,'ACCOUNT_DISABLED','账号已停用，请联系管理员');
    ensure((req.user.sessionVersion ?? 0)===user.session_version,401,'SESSION_CHANGED','账号安全设置已更新，请重新登录');
    ensure(req.user.accountType && req.user.accountType===accountType(user.role),401,'SESSION_CHANGED','账号身份已变更，请从对应入口重新登录');req.actor=user;
  };
  const memberOnly:Context['memberOnly']=async req=>{await authenticate(req);ensure(req.actor.role==='member',403,'MEMBER_ONLY','此功能仅限会员账号，请从商城入口登录会员账号');};
  const staffOnly:Context['staffOnly']=async req=>{await authenticate(req);ensure(accountType(req.actor.role)==='staff',403,'STAFF_ONLY','请从员工入口登录已授权的员工账号');};
  const permit:Context['permit']=cap=>async req=>{await staffOnly(req);ensure(capabilities[req.actor.role as Role]?.includes(cap),403,'FORBIDDEN','当前账号无权执行此操作');};
  // 公开接口的可选会员身份：有效会员令牌返回用户ID，否则按游客处理
  const viewer:Context['viewer']=async req=>{if(!req.headers.authorization)return undefined;try {await memberOnly(req);return req.actor.id;} catch {return undefined;}};
  const ctx:Context={db,repo,orders,accounts,catalog,coupons,seckill,runtime,authenticate,memberOnly,staffOnly,permit,viewer};
  await accountRoutes(app,ctx);await catalogRoutes(app,ctx);await orderRoutes(app,ctx);await adminRoutes(app,ctx);await promotionRoutes(app,ctx);
  app.get('/api/health',{schema:{tags:['运维']}},async req=>{await db.one('SELECT 1 AS ok');return result(req,{status:'ok',database:db.dialect,cache:runtime.redis?.isReady?'connected':process.env.REDIS_URL?'degraded':'local-disabled',queue:runtime.channel?'connected':process.env.AMQP_URL?'degraded':'local-outbox',tracing:tracingMode(),time:new Date().toISOString()});});
  app.get('/api/openapi.json',{schema:{hide:true}},async()=>app.swagger());
  app.get('/api/metrics',{schema:{hide:true}},async(_req,reply)=>{reply.type(registry.contentType);return registry.metrics();});
  app.addHook('onClose',async()=>{await runtime.stop();await flushTracing();registry.clear();if(!options.db)await db.close();});
  await app.ready();
  if(options.workers!==false){await runtime.connect();runtime.start(orders);}
  return {app,ctx};
}
