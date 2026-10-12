import type { Database } from '../../core/database.js';
import { hashPassword } from '../../core/security.js';

export const categoryData = [
  ['fruit','时令水果','Cherry'],['seafood','海鲜水产','Fish'],['meat','肉禽蛋品','Beef'],
  ['vegetable','新鲜蔬菜','Carrot'],['dairy','乳品烘焙','Milk'],['ready','方便速食','CookingPot']
];
// Amounts are stored as integer fen, never floating point yuan.
export const productData = [
  ['p01','fruit','丹东红颜草莓','一口鲜甜，春日的第一颗草莓',2990,3990,86,'strawberry','500g / 盒','辽宁丹东','0–4°C 冷藏','当季鲜选',320],
  ['p02','fruit','海南金钻凤梨','树上熟，清甜多汁免泡盐水',1990,2590,120,'pineapple','1个 / 约1.2kg','海南万宁','阴凉通风处','产地直采',210],
  ['p03','fruit','秘鲁进口牛油果','绵密细腻，轻食好搭档',2490,3290,90,'avocado','3个 / 约450g','秘鲁','常温后熟','轻食优选',180],
  ['p04','fruit','智利车厘子 JJ级','果肉饱满，甜蜜脆爽',5990,7990,60,'cherry','500g / 盒','智利','0–4°C 冷藏','人气好物',640],
  ['p05','fruit','云南高原蓝莓','颗颗蓝紫，清甜微酸',1590,2190,150,'blueberry','125g / 盒','云南红河','0–4°C 冷藏','当季鲜选',260],
  ['p06','fruit','山东红富士苹果','阳光滋养，清脆爽口',2290,2990,180,'apple','4个 / 约1kg','山东烟台','阴凉通风处','产地直采',300],
  ['p07','seafood','挪威冰鲜三文鱼','鲜切厚切，细腻丰腴',6990,8990,45,'salmon','250g / 盒','挪威','0–4°C 冷藏，充分加热','冷链直达',520],
  ['p08','seafood','厄瓜多尔白虾','肉质紧实，鲜甜弹嫩',3990,4990,100,'shrimp','500g / 袋','厄瓜多尔','−18°C 冷冻','人气好物',410],
  ['p09','seafood','舟山鲜活鲈鱼','鲜嫩少刺，清蒸好选择',3590,4290,50,'fish','1条 / 约500g','浙江舟山','0–4°C 冷藏，充分加热','今日鲜到',230],
  ['p10','meat','澳洲谷饲西冷牛排','原切不拼接，浓郁肉香',5990,7590,72,'steak','200g / 片','澳大利亚','−18°C 冷冻','原切精选',460],
  ['p11','meat','散养土鸡蛋','新鲜好蛋，早餐好搭档',1990,2590,160,'eggs','10枚 / 盒','湖北黄冈','阴凉干燥处','产地直采',380],
  ['p12','meat','冷鲜黑猪五花肉','肥瘦相间，红烧更香',3290,3990,84,'pork','400g / 盒','浙江金华','0–4°C 冷藏','今日鲜到',270],
  ['p13','meat','农场冷鲜鸡腿','肉质鲜嫩，多种料理选择',2290,2890,110,'chicken','500g / 盒','山东潍坊','0–4°C 冷藏','冷链直达',250],
  ['p14','vegetable','云南高原西兰花','鲜绿脆嫩，每日膳食纤维',890,1290,200,'broccoli','1颗 / 约350g','云南昆明','0–4°C 冷藏','今日鲜到',150],
  ['p15','vegetable','有机小番茄','酸甜爆汁，轻食小零嘴',1290,1690,140,'tomato','500g / 盒','山东寿光','0–4°C 冷藏','有机精选',290],
  ['p16','vegetable','脆嫩水果黄瓜','鲜嫩爽脆，轻松凉拌',690,990,170,'cucumber','3根 / 约400g','山东寿光','0–4°C 冷藏','产地直采',170],
  ['p17','vegetable','鲜采胡萝卜','自然清甜，炖煮好搭档',590,890,200,'carrot','500g / 袋','福建厦门','0–4°C 冷藏','产地直采',160],
  ['p18','dairy','牧场鲜牛奶','巴氏杀菌，醇香好滋味',1690,2190,130,'milk','950ml / 瓶','内蒙古','0–4°C 冷藏','早餐优选',340],
  ['p19','dairy','手工酸奶杯','浓醇细腻，低糖轻负担',1290,1590,96,'yogurt','200g × 2杯','浙江杭州','0–4°C 冷藏','轻食优选',220],
  ['p20','dairy','黄油可颂','层层酥香，现烤好早餐',1590,1990,70,'croissant','3个 / 袋','本地烘焙工坊','常温，开封即食','每日鲜烤',190],
  ['p21','ready','鲜肉小馄饨','皮薄馅鲜，十分钟好味道',1990,2490,110,'dumplings','300g / 袋','上海','−18°C 冷冻','快手好菜',240],
  ['p22','ready','意式番茄意面','浓香番茄酱，轻松一餐',2490,2990,90,'pasta','350g / 盒','本地中央厨房','0–4°C 冷藏','快手好菜',200],
  ['p23','ready','轻食鸡肉沙拉','荤素均衡，健康轻盈',2890,3590,50,'salad','280g / 盒','本地中央厨房','0–4°C 冷藏，当日食用','轻食优选',310],
  ['p24','fruit','海南香甜香蕉','香甜软糯，能量补给',1290,1690,140,'banana','1把 / 约750g','海南乐东','阴凉通风处','产地直采',280]
];
export async function seed(db: Database) {
  await db.transaction(async tx => {
    if (await tx.one('SELECT id FROM users LIMIT 1')) return;
    const now = Date.now();
    for (const [id,name,icon] of categoryData) await tx.run('INSERT INTO categories(id,name,icon) VALUES(?,?,?)',[id,name,icon]);
    for (const row of productData) {
      const [id,category,name,subtitle,price,original,stock,image,unit,origin,storage,tag,views] = row;
      await tx.run('INSERT INTO products(id,category_id,name,subtitle,description,price,original_price,stock,sales,views,image,unit,origin,storage,tag,active,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [id,category,name,subtitle,`${name}，${subtitle}。严选产区与合作供应商，批次验收后发货。商品以实际重量与包装标注为准。请按储存建议保存并尽快食用。`,price,original,stock,0,views,`/images/${image}.jpg`,unit,origin,storage,tag,1,now]);
    }
    const hash = hashPassword(process.env.DEMO_PASSWORD || 'Fresh@123456');
    for (const [role,name] of [['member','林小鲜'],['operator','运营专员'],['warehouse','仓库专员'],['support','客服专员'],['finance','财务专员'],['admin','平台管理员']]) {
      await tx.run('INSERT INTO users(id,username,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)',[`u-${role}`,role,name,hash,role,now]);
    }
    await tx.run('INSERT INTO addresses(id,user_id,name,phone,detail,is_default) VALUES(?,?,?,?,?,?)',['a-demo','u-member','林小鲜','13800138000','上海市浦东新区 张江路88号 1栋602室',1]);
  });
}
