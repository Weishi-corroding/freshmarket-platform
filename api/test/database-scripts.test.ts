import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,rmSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {buildApp} from '../src/app.js';
import {createDatabase} from '../src/core/database.js';
import {categoryData,couponData,productData,seckillData} from '../src/modules/catalog/seed.js';

// 直接执行 database/*.sql，验证手工初始化脚本本身可用，并与 seed.ts 保持一致
const schema=readFileSync(new URL('../../database/schema.sql',import.meta.url),'utf8');
const seedSql=readFileSync(new URL('../../database/seed.sql',import.meta.url),'utf8');
const expected={categories:categoryData.length,products:productData.length,users:6,addresses:1,coupons:couponData.length,seckill_activities:seckillData.length};

// 用脚本建库并导入演示数据（各执行两次验证可重复），返回连接串供 createDatabase 使用及清理函数
async function scripted():Promise<{url?:string;path?:string;count:(table:string)=>Promise<number>;cleanup:()=>Promise<void>}> {
  if(process.env.TEST_DATABASE_URL){
    const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL}),name='test_'+randomUUID().replaceAll('-','');
    await pool.query('CREATE SCHEMA '+name);const url=new URL(process.env.TEST_DATABASE_URL);url.searchParams.set('options','-c search_path='+name);
    const client=new Pool({connectionString:url.toString(),max:1});
    for(const sql of [schema,schema,seedSql,seedSql])await client.query(sql);
    return {url:url.toString(),count:async table=>Number((await client.query(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n),
      cleanup:async()=>{await client.end();await pool.query('DROP SCHEMA '+name+' CASCADE');await pool.end();}};
  }
  const dir=mkdtempSync(join(tmpdir(),'fm-db-')),path=join(dir,'scripted.sqlite'),sqlite=new DatabaseSync(path);
  sqlite.exec('PRAGMA foreign_keys=ON');for(const sql of [schema,schema,seedSql,seedSql])sqlite.exec(sql);
  return {path,count:async table=>Number((sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {n:number}).n),
    cleanup:async()=>{sqlite.close();rmSync(dir,{recursive:true,force:true});}};
}

test('schema.sql 与 seed.sql 可重复执行，演示数据与 seed.ts 一致',async()=>{
  const db=await scripted();
  try{for(const [table,n] of Object.entries(expected))assert.equal(await db.count(table),n,table);}
  finally{await db.cleanup();}
});

test('脚本初始化的数据库可直接由 API 启动，迁移与种子不重复写入',async()=>{
  const db=await scripted();
  try{
    const database=await createDatabase(db.url,db.path);
    const {app}=await buildApp({db:database,logger:false,workers:false});
    try{
      for(const [table,n] of Object.entries(expected))assert.equal(await db.count(table),n,table);
      const login=await app.inject({method:'POST',url:'/api/auth/login',payload:{username:'member',password:'Fresh@123456'}});
      assert.equal(login.statusCode,200);
      const products=await app.inject({url:'/api/products?pageSize=100'});
      assert.equal(products.json().data.total,productData.length);
    }finally{await app.close();await database.close();}
  }finally{await db.cleanup();}
});

test('schema.sql 为每个外键列建立前导索引',()=>{
  const sqlite=new DatabaseSync(':memory:');sqlite.exec(schema);
  const tables=(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {name:string}[]).map(t=>t.name);
  const missing:string[]=[];
  for(const table of tables){
    const leading=new Set<string>();
    for(const index of sqlite.prepare(`PRAGMA index_list(${table})`).all() as {name:string}[]){
      const first=(sqlite.prepare(`PRAGMA index_info(${index.name})`).all() as {seqno:number;name:string}[]).find(c=>c.seqno===0);
      if(first)leading.add(first.name);
    }
    for(const fk of sqlite.prepare(`PRAGMA foreign_key_list(${table})`).all() as {from:string}[])if(!leading.has(fk.from))missing.push(`${table}.${fk.from}`);
  }
  sqlite.close();
  assert.deepEqual(missing,[]);
});
