import { DatabaseSync } from 'node:sqlite';
import { Pool, type PoolClient } from 'pg';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type Row = Record<string, any>;
export interface Query {
  all<T extends Row = Row>(sql: string, params?: any[]): Promise<T[]>;
  one<T extends Row = Row>(sql: string, params?: any[]): Promise<T | undefined>;
  run(sql: string, params?: any[]): Promise<number>;
}
export interface Database extends Query {
  dialect: 'sqlite' | 'postgres';
  transaction<T>(fn: (tx: Query) => Promise<T>): Promise<T>;
  migrate(): Promise<void>;
  close(): Promise<void>;
}
function pgSql(sql: string) { let n = 0; return sql.replace(/\?/g, () => `$${++n}`); }
function postgresQuery(client: Pool | PoolClient): Query {
  return {
    async all<T extends Row>(sql: string, params: any[] = []) { return (await client.query(pgSql(sql), params)).rows as T[]; },
    async one<T extends Row>(sql: string, params: any[] = []): Promise<T | undefined> { return (await client.query(pgSql(sql),params)).rows[0] as T | undefined; },
    async run(sql: string, params: any[] = []) { return (await client.query(pgSql(sql), params)).rowCount || 0; }
  };
}
export async function createDatabase(url?: string, path = '.runtime/freshmarket.sqlite'): Promise<Database> {
  const schema = readFileSync(new URL('../../../database/schema.sql', import.meta.url), 'utf8');
  const additions:Record<string,Record<string,string>>={
    users:{active:'INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))',session_version:'INTEGER NOT NULL DEFAULT 0',deleted_at:'BIGINT'},
    products:{views:'INTEGER NOT NULL DEFAULT 0',deleted_at:'BIGINT'},
    orders:{deleted_at:'BIGINT',discount:'INTEGER NOT NULL DEFAULT 0',coupon_id:'TEXT',seckill_id:'TEXT'},
    order_items:{discount:'INTEGER NOT NULL DEFAULT 0'},outbox:{trace_context:"TEXT NOT NULL DEFAULT ''"}
  };
  if (url) {
    const pool = new Pool({ connectionString: url, max: 15, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000 });
    pool.on('error', err => console.error('postgres_pool_error', err.message));
    const query = postgresQuery(pool);
    return { ...query, dialect: 'postgres',
      async migrate() {
        // 多副本同时启动时以会话级咨询锁串行化建表/补列，避免并发 DDL 冲突
        const client=await pool.connect();
        try {
          await client.query('SELECT pg_advisory_lock(7303052026)');
          await client.query(schema);
          for(const [table,columns] of Object.entries(additions))for(const [name,type] of Object.entries(columns))
            await client.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${name} ${type}`);
        } finally { await client.query('SELECT pg_advisory_unlock(7303052026)').catch(()=>{});client.release(); }
      },
      async transaction<T>(fn: (tx: Query) => Promise<T>) {
        const client = await pool.connect();
        try { await client.query('BEGIN'); const value = await fn(postgresQuery(client)); await client.query('COMMIT'); return value; }
        catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
      }, async close() { await pool.end(); }
    };
  }
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const sqlite = new DatabaseSync(path);
  sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  let queue: Promise<unknown> = Promise.resolve();
  function locked<T>(fn: () => Promise<T>): Promise<T> {
    const next = queue.then(fn); queue = next.catch(() => {}); return next;
  }
  const direct: Query = {
    async all<T extends Row>(sql: string, params: any[] = []) { return sqlite.prepare(sql).all(...params) as T[]; },
    async one<T extends Row>(sql: string, params: any[] = []): Promise<T | undefined> { return sqlite.prepare(sql).get(...params) as T | undefined; },
    async run(sql: string, params: any[] = []) { return Number(sqlite.prepare(sql).run(...params).changes); }
  };
  return {
    dialect: 'sqlite',
    all: (sql, params) => locked(() => direct.all(sql, params)),
    one: (sql, params) => locked(() => direct.one(sql, params)),
    run: (sql, params) => locked(() => direct.run(sql, params)),
    async migrate() {
      sqlite.exec(schema);
      for(const [table,columns] of Object.entries(additions)) {
        const existing=sqlite.prepare(`PRAGMA table_info(${table})`).all() as {name:string}[];
        for(const [name,type] of Object.entries(columns))if(!existing.some(column=>column.name===name))
          sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
      }
    },
    transaction: fn => locked(async () => {
      sqlite.exec('BEGIN IMMEDIATE');
      try { const value = await fn(direct); sqlite.exec('COMMIT'); return value; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    }), async close() { await queue; sqlite.close(); }
  };
}
