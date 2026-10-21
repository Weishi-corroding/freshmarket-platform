// 由 api/src/modules/catalog/seed.ts 生成 database/seed.sql：npm run build -w api && node scripts/export-seed.mjs
// seed.ts 是演示数据的唯一来源，不要手工编辑 seed.sql
import {writeFileSync} from 'node:fs';
import {categoryData,couponData,productData,seckillData} from '../api/dist/modules/catalog/seed.js';
import {hashPassword} from '../api/dist/core/security.js';
const quote=v=>v===null?'NULL':typeof v==='number'?String(v):"'"+String(v).replaceAll("'","''")+"'";
const insert=(table,fields,row)=>`INSERT INTO ${table} (${fields}) VALUES (${row.map(quote).join(',')}) ON CONFLICT(id) DO NOTHING;`;
const section=title=>['',`-- ${'-'.repeat(77)}`,`-- ${title}`,`-- ${'-'.repeat(77)}`];
const now=Date.now(),day=86400000,lines=[
  `-- ${'='.repeat(77)}`,
  '-- 鲜境 FreshMarket 演示数据脚本（SQLite / PostgreSQL 通用）',
  '--',
  '-- 仅用于实验与本地演示：6 个演示账号的密码为公开的 Fresh@123456，禁止导入公网环境。',
  '-- Docker 部署无需导入本文件，API 首次启动时由 seed.ts 写入并使用 .env.docker 中的 DEMO_PASSWORD。',
  '--',
  '-- 先执行 schema.sql，再执行本文件；全部语句为 ON CONFLICT(id) DO NOTHING，可重复执行，',
  '-- 不覆盖已有记录的价格、库存与状态。',
  '--   sqlite3 freshmarket.sqlite < database/seed.sql',
  '--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/seed.sql',
  '--',
  `-- 生成时间 ${new Date(now).toISOString()}；优惠券有效期 365 天、秒杀活动 7 天，均从生成时间起算。`,
  `-- ${'='.repeat(77)}`,
  'BEGIN;'
];
lines.push(...section(`商品分类（${categoryData.length}）`));
for(const row of categoryData)lines.push(insert('categories','id,name,icon',row));
lines.push(...section(`商品（${productData.length}），金额单位为分`));
for(const row of productData){const [id,category,name,subtitle,price,original,stock,image,unit,origin,storage,tag,views]=row;lines.push(insert('products','id,category_id,name,subtitle,description,price,original_price,stock,sales,views,image,unit,origin,storage,tag,active,created_at',[id,category,name,subtitle,`${name}，${subtitle}。严选产区与合作供应商，批次验收后发货。商品以实际重量与包装标注为准。请按储存建议保存并尽快食用。`,price,original,stock,0,views,`/images/${image}.jpg`,unit,origin,storage,tag,1,now]));}
const accounts=[['member','林小鲜'],['operator','运营专员'],['warehouse','仓库专员'],['support','客服专员'],['finance','财务专员'],['admin','平台管理员']];
lines.push(...section(`演示账号（${accounts.length}）：member 为会员，其余为员工，密码 Fresh@123456`));
const hash=hashPassword('Fresh@123456');
for(const [role,name]of accounts)lines.push(insert('users','id,username,name,password_hash,role,created_at',[`u-${role}`,role,name,hash,role,now]));
lines.push(...section('会员默认收货地址'));
lines.push(insert('addresses','id,user_id,name,phone,detail,is_default',['a-demo','u-member','林小鲜','13800138000','上海市浦东新区 张江路88号 1栋602室',1]));
lines.push(...section(`优惠券模板（${couponData.length}），每种发行 1000 张`));
for(const [id,name,kind,threshold,value,maxDiscount,category] of couponData)lines.push(insert('coupons','id,name,kind,threshold,value,max_discount,category_id,total,valid_from,valid_to,active,created_at',[id,name,kind,threshold,value,maxDiscount,category,1000,now,now+365*day,1,now]));
lines.push(...section(`限时秒杀活动（${seckillData.length}）`));
for(const [id,product,title,price,stock] of seckillData)lines.push(insert('seckill_activities','id,product_id,title,price,stock,start_at,end_at,active,created_at',[id,product,title,price,stock,now,now+7*day,1,now]));
lines.push('','COMMIT;');
writeFileSync('database/seed.sql',lines.join('\n')+'\n');console.log('Exported database/seed.sql (demo fixtures)');
