import {writeFileSync} from 'node:fs';
import {categoryData,couponData,productData,seckillData} from '../api/dist/modules/catalog/seed.js';
import {hashPassword} from '../api/dist/core/security.js';
const quote=v=>v===null?'NULL':typeof v==='number'?String(v):"'"+String(v).replaceAll("'","''")+"'";
const insert=(table,fields,row)=>`INSERT INTO ${table} (${fields}) VALUES (${row.map(quote).join(',')}) ON CONFLICT(id) DO NOTHING;`;
const now=Date.now(),lines=['-- LAB DEMO ONLY: default public password Fresh@123456. Never import these accounts into a public deployment.','-- Production/lab Docker seeding uses DEMO_PASSWORD from .env.docker instead.','BEGIN;'];
for(const row of categoryData)lines.push(insert('categories','id,name,icon',row));
for(const row of productData){const [id,category,name,subtitle,price,original,stock,image,unit,origin,storage,tag,views]=row;lines.push(insert('products','id,category_id,name,subtitle,description,price,original_price,stock,sales,views,image,unit,origin,storage,tag,active,created_at',[id,category,name,subtitle,`${name}，${subtitle}。严选产区与合作供应商，批次验收后发货。商品以实际重量与包装标注为准。请按储存建议保存并尽快食用。`,price,original,stock,0,views,`/images/${image}.jpg`,unit,origin,storage,tag,1,now]));}
const hash=hashPassword('Fresh@123456');
for(const [role,name]of[['member','林小鲜'],['operator','运营专员'],['warehouse','仓库专员'],['support','客服专员'],['finance','财务专员'],['admin','平台管理员']])lines.push(insert('users','id,username,name,password_hash,role,created_at',[`u-${role}`,role,name,hash,role,now]));
for(const [id,name,kind,threshold,value,maxDiscount,category] of couponData)lines.push(insert('coupons','id,name,kind,threshold,value,max_discount,category_id,total,valid_from,valid_to,active,created_at',[id,name,kind,threshold,value,maxDiscount,category,1000,now,now+365*86400000,1,now]));
for(const [id,product,title,price,stock] of seckillData)lines.push(insert('seckill_activities','id,product_id,title,price,stock,start_at,end_at,active,created_at',[id,product,title,price,stock,now,now+7*86400000,1,now]));
lines.push(insert('addresses','id,user_id,name,phone,detail,is_default',['a-demo','u-member','林小鲜','13800138000','上海市浦东新区 张江路88号 1栋602室',1]),'COMMIT;');
writeFileSync('database/seed.sql',lines.join('\n')+'\n');console.log('Exported database/seed.sql (demo fixtures)');
