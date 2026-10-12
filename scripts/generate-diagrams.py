from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import math
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'docs/diagrams';OUT.mkdir(parents=True,exist_ok=True)
FONT=Path('C:/Windows/Fonts/msyh.ttc')
BOLD=Path('C:/Windows/Fonts/msyhbd.ttc')
if not FONT.exists():FONT=Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf');BOLD=FONT
def font(size,bold=False):return ImageFont.truetype(str(BOLD if bold else FONT),size)
def diagram(name,title,nodes,edges,size=(1600,1000),footer='FreshMarket · 根据实际代码和数据库结构绘制'):
    im=Image.new('RGB',size,'#f7fafb');d=ImageDraw.Draw(im)
    d.rectangle((0,0,size[0],105),fill='#0c5863');d.text((48,27),title,font=font(34,True),fill='white')
    lookup={n[0]:n for n in nodes}
    for edge in edges:
        a,b=edge[:2];n1,n2=lookup[a],lookup[b];x1,y1,w1,h1=n1[1:5];x2,y2,w2,h2=n2[1:5];cx1,cy1=x1+w1/2,y1+h1/2;cx2,cy2=x2+w2/2,y2+h2/2
        dx,dy=cx2-cx1,cy2-cy1
        scale1=max(abs(dx)/(w1/2),abs(dy)/(h1/2));scale2=max(abs(dx)/(w2/2),abs(dy)/(h2/2))
        start=(cx1+dx/scale1,cy1+dy/scale1);end=(cx2-dx/scale2,cy2-dy/scale2)
        color='#92b0b7' if len(edge)<3 else '#d69972'
        if name=='architecture' and a=='consume' and b=='pg':
            start=(x1+w1,cy1);end=(x2+w2,cy2)
            d.line([start,(1540,cy1),(1540,cy2),end],fill=color,width=3)
            angle=math.pi
        else:
            d.line([start,end],fill=color,width=3)
            angle=math.atan2(dy,dx)
        wing=12
        d.polygon([end,(end[0]-wing*math.cos(angle-.4),end[1]-wing*math.sin(angle-.4)),(end[0]-wing*math.cos(angle+.4),end[1]-wing*math.sin(angle+.4))],fill=color)
    for n in nodes:
        _,x,y,w,h,label,*rest=n;lines=label.split('\n');kind=rest[0] if rest else 'normal'
        bg={'normal':'#ffffff','teal':'#e5f4ef','blue':'#eaf1fa','orange':'#fff1e4','dark':'#17626a'}[kind]
        d.rounded_rectangle((x,y,x+w,y+h),radius=12,fill=bg,outline='#adc7cc',width=2)
        for i,line in enumerate(lines):
            f=font(23 if i==0 else 17,i==0);box=d.textbbox((0,0),line,font=f);tx=x+(w-(box[2]-box[0]))/2
            total_height=len(lines)*30;ty=y+(h-total_height)/2+i*30
            d.text((tx,ty),line,font=f,fill='white' if kind=='dark' else '#204a51' if i==0 else '#758d92')
    d.text((45,size[1]-42),footer,font=font(16),fill='#839ca2');im.save(OUT/(name+'.png'))
    return OUT/(name+'.png')

diagram('architecture','鲜境：部署与分层架构',[
 ('user',60,150,245,95,'顾客 / 员工浏览器\n响应式商城与工作台','teal'),('nginx',370,150,245,95,'Nginx 网关\nSPA / JSON / 限流'),('api',700,150,270,95,'Fastify Controller\nJWT / Schema / Result','dark'),('pg',1180,150,300,110,'PostgreSQL 17\n业务数据 / 审计 / Outbox','blue'),
 ('react',370,345,245,95,'React + TypeScript\n独立前端工程'),('service',700,345,270,105,'业务 Service\nAccount / Catalog / Order'),('repo',700,540,270,100,'Repository / Query\n事务 / 参数化 / 连接池'),('redis',1180,345,300,100,'Redis 缓存\n30秒TTL / 共享版本','orange'),
 ('worker',700,740,270,105,'后台任务\n订单超时 / Outbox投递'),('mq',1180,560,300,105,'RabbitMQ\n发布确认 / 持久化 / DLQ','blue'),('consume',1180,770,300,105,'事件消费者\n事务去重 / 通知 / Ack'),('prom',370,560,245,105,'Prometheus\nQPS / p95 / 5xx'),('graf',60,760,245,105,'Grafana\n仪表盘与告警查看')
],[('user','nginx'),('nginx','api'),('nginx','react'),('api','service'),('service','repo'),('repo','pg'),('service','redis'),('worker','mq'),('mq','consume'),('consume','pg'),('repo','worker'),('api','prom'),('prom','graf')])
diagram('use-cases','用例与角色：按职责开放业务能力',[
 ('guest',65,145,240,88,'游客','blue'),('member',65,265,240,88,'会员','teal'),('operator',65,385,240,88,'运营员工'),('warehouse',65,505,240,88,'仓库员工'),('support',65,625,240,88,'客服员工'),('finance',65,745,240,88,'财务员工'),('admin',65,865,240,88,'管理员','dark'),
 ('browse',465,145,960,88,'分类 / 搜索 / 详情\n规格、产地、冷链储存与顾客评价'),('shop',465,265,960,88,'购物车 / 地址 / 下单 / 沙箱支付 / 收货 / 售后 / 评价','teal'),('product',465,385,960,88,'商品维护与上下架\n经营概览、全部订单查看'),('stock',465,505,960,88,'采购入库 / 损耗调整 / 拣货 / 配送'),('refund',465,625,960,88,'售后审核 / 查看订单\n退款与库存、结算规则联动'),('settle',465,745,960,88,'已收货订单财务结算\n排除售后冻结，重复批次不重复入账'),('role',465,865,960,88,'全部员工能力 / 角色调整 / 审计追踪','dark')
],[('guest','browse'),('member','shop'),('operator','product'),('warehouse','stock'),('support','refund'),('finance','settle'),('admin','role')],size=(1600,1040))
diagram('business-flow','业务闭环：选购、支付、履约、售后与结算',[
 ('browse',60,165,255,100,'01 浏览 / 搜索\n按分类与关键字选食材'),('cart',365,165,255,100,'02 加入购物车\n地址 / 数量 / 配送时段'),('order',670,165,255,100,'03 幂等提交\n事务预扣 / 快照 / Outbox','teal'),('pending',975,165,255,100,'04 待付款\n15分钟内支付','orange'),('pay',1280,165,255,100,'05 沙箱支付\n防重复记账','blue'),
 ('pick',1280,445,255,100,'06 仓库拣货\n职能权限校验'),('deliver',975,445,255,100,'07 发出配送\n订单状态机'),('receive',670,445,255,100,'08 确认收货\n本人订单归属校验'),('review',365,445,255,100,'09 顾客评价\n已购商品 / 一次评价'),('settle',60,445,255,100,'10 财务结算\n收货且无售后 / 防重复','teal'),
 ('cancel',1010,735,270,110,'取消 / 超时\n归还库存，仅一次','orange'),('refund',650,735,285,110,'申请售后 / 客服审核\npending冻结履约和结算','orange'),('fresh',260,735,280,110,'整单退款\n已配送的生鲜不回库存','blue')
],[('browse','cart'),('cart','order'),('order','pending'),('pending','pay'),('pay','pick'),('pick','deliver'),('deliver','receive'),('receive','review'),('review','settle'),('pending','cancel','branch'),('receive','refund','branch'),('refund','fresh','branch')],size=(1600,980))
diagram('er','核心数据实体：15张表与关键关系',[
 ('users',55,155,260,100,'users 用户\nPK id / UNIQUE username'),('categories',365,155,260,100,'categories 分类\nPK id'),('products',685,155,300,100,'products 商品\nPK id / FK category_id'),('outbox',1090,155,360,100,'outbox 本地事件\n事件id / topic / status','orange'),
 ('cart',55,385,260,100,'cart_items 购物车\nPK user_id + product_id'),('orders',365,385,260,100,'orders 订单\nUNIQUE user + key','teal'),('items',685,385,300,100,'order_items 快照\nFK order_id + product_id'),('payments',1090,385,360,100,'payments 沙箱付款\nUNIQUE order_id','blue'),
 ('addresses',55,620,260,100,'addresses 地址\nFK user_id'),('refunds',365,620,260,100,'refunds 退款\nUNIQUE order_id'),('reviews',685,620,300,100,'reviews 评价\nUNIQUE order + product + user'),('settlements',1090,620,360,100,'settlements 结算\nUNIQUE order_id','teal'),
 ('audit',55,835,260,100,'audit_logs 审计\nactor / entity / traceId'),('events',365,835,260,100,'processed_events\nPK event id / 去重','orange'),('notifications',685,835,300,100,'notifications 顾客消息\nFK user_id')
],[('users','cart'),('users','addresses'),('users','orders'),('categories','products'),('products','items'),('orders','items'),('orders','payments'),('orders','refunds'),('orders','settlements'),('items','reviews'),('outbox','events'),('events','notifications')],size=(1600,1020),footer='完整字段/索引见 database/schema.sql；事件表关系为逻辑对应，订单地址为JSON快照。')
diagram('state-machine','订单状态机与互斥规则',[
 ('pending',70,180,245,110,'待付款 pending\n预扣库存 / 15分钟','orange'),('paid',370,180,245,110,'待拣货 paid\n唯一付款记录','teal'),('picking',670,180,245,110,'拣货中 picking\n仓库权限'),('delivering',970,180,245,110,'配送中 delivering\n仓库权限'),('completed',1270,180,245,110,'已完成 completed\n本人确认收货','blue'),
 ('cancelled',70,530,300,120,'已取消 cancelled\n本人取消/定时过期\n库存只归还一次'),('refund',560,530,440,120,'退款审核 pending\n同订单行锁 / 冻结履约与结算\n结算唯一约束'),('refunded',1150,530,360,120,'已退款 refunded\n付款金额一致\n配送过的生鲜不回库存','orange')
],[('pending','paid'),('paid','picking'),('picking','delivering'),('delivering','completed'),('pending','cancelled','branch'),('paid','refund','branch'),('completed','refund','branch'),('refund','refunded','branch')],size=(1600,860),footer='PostgreSQL行锁；条件扣库存；付款/取消只有一个有效转换；退款审核与结算互斥。')
diagram('domain-model','领域模型：订单聚合与核心业务对象',[
 ('member',80,200,280,110,'Member 会员\n身份 / 角色 / 收货地址'),('product',80,530,280,110,'Product 商品\n价格 / 库存 / 规格 / 产地'),('order',590,200,340,140,'Order 订单聚合\n金额、地址与明细快照\n状态 / 幂等 / 支付期限','dark'),('items',590,530,340,110,'OrderItem 订单明细\n商品引用与价格快照'),('payment',1150,145,330,110,'Payment 付款\n订单唯一 / 金额 / 状态','blue'),('refund',1150,355,330,110,'Refund 售后\n原状态 / 原因 / 审核'),('settlement',1150,565,330,110,'Settlement 结算\n订单唯一 / 金额 / 操作者','teal')
],[('member','order'),('product','items'),('order','items'),('order','payment'),('order','refund'),('order','settlement')],size=(1600,820))
print('Generated six architecture/business/domain diagrams.')
