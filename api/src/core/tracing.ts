import { context, propagation, trace, ROOT_CONTEXT, SpanKind, SpanStatusCode, type Attributes, type Context as TraceContext, type Span } from '@opentelemetry/api';
import { NodeTracerProvider, BatchSpanProcessor, type SpanProcessor } from '@opentelemetry/sdk-trace-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { randomBytes } from 'node:crypto';
import type { Database, Query, Row } from './database.js';

// 进程级 TracerProvider：首次调用生效（测试可传入内存导出器）。未配置 OTLP 地址时仍生成 W3C traceId，只是不导出 span。
let provider: NodeTracerProvider | undefined;
export function initTracing(processors?: SpanProcessor[]) {
  if (provider) return provider;
  const spanProcessors = processors || (process.env.OTEL_EXPORTER_OTLP_ENDPOINT ? [new BatchSpanProcessor(new OTLPTraceExporter())] : []);
  provider = new NodeTracerProvider({ resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'freshmarket-api', [ATTR_SERVICE_VERSION]: process.env.APP_VERSION || 'local' }), spanProcessors });
  provider.register();return provider;
}
export const tracingMode = () => process.env.OTEL_EXPORTER_OTLP_ENDPOINT ? 'otlp' : 'local';
export async function flushTracing() { await provider?.forceFlush().catch(() => {}); }
const tracer = () => trace.getTracer('freshmarket-api');
export const currentTraceId = () => trace.getActiveSpan()?.spanContext().traceId;
export const traceAttributes = (attributes: Attributes) => trace.getActiveSpan()?.setAttributes(attributes);

export async function withSpan<T>(name: string, options: {kind?: SpanKind; attributes?: Attributes; parent?: TraceContext}, fn: (span: Span) => Promise<T>): Promise<T> {
  const run = () => tracer().startActiveSpan(name, {kind: options.kind ?? SpanKind.INTERNAL, attributes: options.attributes}, async span => {
    try { return await fn(span); }
    catch (error) { span.recordException(error as Error); span.setStatus({code: SpanStatusCode.ERROR, message: (error as Error).message}); throw error; }
    finally { span.end(); }
  });
  return options.parent ? context.with(options.parent, run) : run();
}
// 只在已有父 span 时记录依赖调用，避免 2 秒轮询任务产生大量孤立 trace。
export function childSpan<T>(name: string, attributes: Attributes, fn: () => Promise<T>): Promise<T> {
  return trace.getActiveSpan() ? withSpan(name, {kind: SpanKind.CLIENT, attributes}, fn) : fn();
}

// 跨进程/异步边界：业务事务把 W3C traceparent 写入 Outbox，发布与消费时恢复为父上下文。
export function injectContext() { const carrier: Record<string, string> = {}; propagation.inject(context.active(), carrier); return carrier; }
export function extractContext(carrier: unknown) {
  const headers = carrier && typeof carrier === 'object' ? Object.fromEntries(Object.entries(carrier).filter(([, value]) => typeof value === 'string' || Buffer.isBuffer(value)).map(([key, value]) => [key, String(value)])) : {};
  return propagation.extract(ROOT_CONTEXT, headers);
}

// HTTP 入口 span：genReqId 阶段创建，traceId 同时作为 Fastify 请求 ID、响应 traceId 与审计 trace_id。
const requestSpans = new WeakMap<object, {span: Span; parent: TraceContext}>();
export function startRequestSpan(raw: {method?: string; url?: string; headers: Record<string, unknown>}) {
  // 健康检查与指标抓取频繁且无业务价值，只分配 traceId，不产生 span
  if (/^\/api\/(health|metrics)(\?|$)/.test(raw.url || '')) return randomBytes(16).toString('hex');
  const parent = extractContext(raw.headers);
  const span = tracer().startSpan(`${raw.method} ${raw.url?.split('?')[0]}`, {kind: SpanKind.SERVER, attributes: {'http.request.method': raw.method || 'GET', 'url.path': raw.url?.split('?')[0] || '/'}}, parent);
  requestSpans.set(raw, {span, parent});return span.spanContext().traceId;
}
export const requestSpan = (raw: object) => requestSpans.get(raw)?.span;
export function runInRequest(raw: object, next: () => void) {
  const entry = requestSpans.get(raw);
  return entry ? context.with(trace.setSpan(entry.parent, entry.span), next) : next();
}
export function endRequestSpan(raw: object, route: string, method: string, status: number, userId?: string) {
  const entry = requestSpans.get(raw);if (!entry) return;requestSpans.delete(raw);
  entry.span.updateName(`${method} ${route}`);
  entry.span.setAttributes({'http.route': route, 'http.response.status_code': status, ...(userId ? {'enduser.id': userId} : {})});
  if (status >= 500) entry.span.setStatus({code: SpanStatusCode.ERROR});
  entry.span.end();
}

// 在统一 Query 接口外层埋点，SQLite 与 PostgreSQL 都能看到 SQL 子 span（只记录语句模板，不记录参数值）。
export function traceDatabase(db: Database): Database {
  const span = <T>(sql: string, fn: () => Promise<T>) => { const operation = sql.trimStart().split(/\s/, 1)[0].toUpperCase(); return childSpan(`${db.dialect} ${operation}`, {'db.system.name': db.dialect === 'postgres' ? 'postgresql' : 'sqlite', 'db.operation.name': operation, 'db.query.text': sql.slice(0, 500)}, fn); };
  const wrap = (query: Query): Query => ({
    all<T extends Row = Row>(sql: string, params?: any[]) { return span(sql, () => query.all<T>(sql, params)); },
    one<T extends Row = Row>(sql: string, params?: any[]) { return span(sql, () => query.one<T>(sql, params)); },
    run(sql: string, params?: any[]) { return span(sql, () => query.run(sql, params)); }
  });
  return {...db, ...wrap(db), transaction: fn => childSpan('db.transaction', {'db.system.name': db.dialect === 'postgres' ? 'postgresql' : 'sqlite'}, () => db.transaction(tx => fn(wrap(tx))))};
}
