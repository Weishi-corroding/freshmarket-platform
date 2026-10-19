/** Record the actual Docker application with a separate narration overlay. */
import {chromium,expect} from '@playwright/test';
import {readFileSync,writeFileSync,mkdirSync,renameSync,statSync} from 'node:fs';
import path from 'node:path';
const root=process.env.DEMO_URL || 'http://127.0.0.1:8080';
const speed=Number(process.env.DEMO_SPEED ?? 1);
const textFile=p=>{const b=readFileSync(p);return(b[0]===255&&b[1]===254?b.subarray(2).toString('utf16le'):b.toString('utf8')).replace(/^\uFEFF/,'');};
const env=Object.fromEntries(textFile('.env.docker').split(/\r?\n/).filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
const report=JSON.parse(textFile('docs/evidence/summary.json'));
mkdirSync('deliverables',{recursive:true});mkdirSync('.runtime/recordings',{recursive:true});
const browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined});
const context=await browser.newContext({viewport:{width:1440,height:1000},recordVideo:{dir:'.runtime/recordings',size:{width:1440,height:1000}}});
await context.addInitScript(()=>{
  window.__demoCaption=(title,body)=>{
    sessionStorage.setItem('__demoCaption',JSON.stringify({title,body}));
    let el=document.getElementById('__demoCaption');
    if(!el){el=document.createElement('aside');el.id='__demoCaption';el.setAttribute('aria-hidden','true');el.style.cssText='position:fixed;left:22px;right:22px;bottom:18px;z-index:2147483647;background:rgba(13,62,71,.96);box-shadow:0 5px 24px #163a4550;color:white;padding:17px 26px;border-radius:12px;font-family:Microsoft YaHei,sans-serif;pointer-events:none;border:1px solid #75b6b080';document.body.append(el);}
    el.replaceChildren();const a=document.createElement('strong');a.style.cssText='display:block;font-size:23px;margin-bottom:7px;color:#8ce1d5';a.textContent=title;
    const b=document.createElement('div');b.style.cssText='font-size:18px;line-height:1.6';b.textContent=body;el.append(a,b);
  };
  document.addEventListener('DOMContentLoaded',()=>{const caption=sessionStorage.getItem('__demoCaption');if(caption){const{title,body}=JSON.parse(caption);window.__demoCaption(title,body);}});
});
const page=await context.newPage();page.setDefaultTimeout(25000);
const video=page.video(),steps=[],errors=[],started=Date.now();page.on('pageerror',e=>errors.push(e.message));
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const frame=(title,content)=>`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${esc(title)}</title><style>body{margin:0;background:#f2f7f8;font-family:'Microsoft YaHei',sans-serif;color:#244a54}header{padding:32px 55px;background:#0d5863;color:white;font-size:32px}header small{display:block;font-size:14px;color:#b5d6d6;letter-spacing:2px;margin-bottom:12px}main{padding:28px 55px}h2{color:#087f83;font-size:27px}p,li{font-size:21px;line-height:1.6}pre{background:white;padding:25px;border:1px solid #dfebee;border-radius:14px;font-size:19px;line-height:1.6;white-space:pre-wrap}table{background:white;border-collapse:collapse;width:100%;font-size:20px}td,th{padding:17px;border-bottom:1px solid #e0ebed;text-align:left}th{background:#e3f2ee}img{display:block;max-width:100%;max-height:660px;margin:auto}.grid{display:grid;grid-template-columns:1fr 1fr;gap:30px}.card{background:white;padding:24px;border-radius:12px}b{color:#087f83}</style><header><small>FRESHMARKET · 实际系统录屏 / 讲解页</small>${esc(title)}</header><main>${content}</main></html>`;
async function explain(id,title,content){await page.route(`**/__demo/${id}`,route=>route.fulfill({contentType:'text/html',body:frame(title,content)}));await page.goto(root+'/__demo/'+id);}
async function caption(title,body,ms=7000){await page.evaluate(({title,body})=>window.__demoCaption(title,body),{title,body});steps.push({atSeconds:+((Date.now()-started)/1000).toFixed(1),title,body});console.log('Recorded:',title);await page.waitForTimeout(ms*speed);}
async function go(route){await page.goto(root+route);}
let staffSession=false;
async function logout(){await go(staffSession?'/admin':'/');const scope=staffSession?page:page.getByRole('banner');await scope.getByRole('button',{name:'退出登录',exact:true}).click();staffSession=false;}
async function login(username,password=env.DEMO_PASSWORD){staffSession=['admin','operator','warehouse','support','finance'].includes(username);await go(staffSession?'/admin/login':'/');if(!staffSession)await page.getByRole('banner').getByRole('button',{name:'登录 / 注册',exact:true}).click();await page.getByLabel('账号',{exact:true}).fill(username);await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:staffSession?'登录工作台':'登录',exact:true}).click();if(staffSession)await expect(page.locator('.admin-sidebar')).toBeVisible();else await expect(page.getByRole('dialog')).toBeHidden();}
async function request(route,method='GET'){return await page.evaluate(async({route,method})=>{const token=sessionStorage.getItem(route.startsWith('/api/admin/')?'fresh-staff-token':'fresh-member-token');const response=await fetch(route,{method,headers:{Authorization:'Bearer '+token}});return{httpStatus:response.status,response:await response.json()};},{route,method});}
async function submitOrder(){const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/orders'&&r.request().method()==='POST');await page.getByRole('button',{name:'提交订单',exact:true}).click();const created=await response;if(created.status()!==200)throw new Error('Checkout failed');const id=(await created.json()).data.id;await page.locator('.order-card').filter({hasText:id}).waitFor();return id;}
async function order(pay=true){await go('/');await page.getByRole('button',{name:'加入购物车 丹东红颜草莓',exact:true}).click();await expect(page.getByRole('button',{name:'购物车 1 件',exact:true})).toBeVisible();await go('/checkout');const id=await submitOrder(),card=page.locator('.order-card').filter({hasText:id});if(pay){await card.getByRole('button',{name:'去付款',exact:true}).click();await page.getByRole('button',{name:'确认沙箱支付',exact:true}).click();await expect(page.getByRole('dialog')).toBeHidden();await card.getByText('待拣货',{exact:true}).waitFor();}return id;}
const recorded={};
try{
  await go('/');await expect(page.locator('.product-card')).toHaveCount(12);
  await page.evaluate(async()=>Promise.all(Array.from(document.images).map(img=>{img.loading='eager';return img.decode();})));
  await caption('鲜境 FreshMarket｜企业级生鲜购物平台','独立品牌，借鉴盒马生鲜选购体验。实际运行的是 Nginx、React、Fastify、PostgreSQL、Redis、RabbitMQ 与监控服务。');
  await page.getByRole('textbox',{name:'搜索商品',exact:true}).fill('三文鱼');await page.getByRole('button',{name:'搜索',exact:true}).click();await expect(page.locator('.product-card')).toHaveCount(1);
  await caption('01 浏览与搜索','商品支持分类、分页、价格排序与关键词查询。页面通过真实 JSON API 获取数据，食材图片随源码本地保存。');
  await page.getByRole('link',{name:'挪威冰鲜三文鱼',exact:true}).first().click();await page.getByRole('heading',{name:'挪威冰鲜三文鱼',exact:true}).waitFor();
  await caption('02 商品详情','展示规格、产地、储存条件与评价；实际库存和下单价格由服务端数据库负责。');
  await go('/');await page.getByRole('banner').getByRole('button',{name:'登录 / 注册',exact:true}).click();await page.getByRole('button',{name:'立即注册',exact:true}).click();
  const username='video_'+Date.now(),password='Customer12345';await page.getByLabel('昵称',{exact:true}).fill('录屏鲜客');await page.getByLabel('账号',{exact:true}).fill(username);await page.getByLabel('密码',{exact:true}).fill(password);
  await caption('03 会员注册与账号安全','新注册账号固定为会员；密码使用 scrypt 与随机盐保存。不同岗位在后续演示中使用独立角色账号。',5000);
  await page.getByRole('button',{name:'注册并登录',exact:true}).click();await expect(page.getByRole('dialog')).toBeHidden();await go('/account');await page.getByRole('button',{name:'新增地址',exact:true}).click();
  await page.getByLabel('收货人',{exact:true}).fill('录屏鲜客');await page.getByLabel('手机号',{exact:true}).fill('13900139000');await page.getByLabel('详细地址',{exact:true}).fill('上海市浦东新区张江路88号 鲜境演示楼602室');await page.getByRole('button',{name:'保存地址',exact:true}).click();await expect(page.getByRole('dialog')).toBeHidden();
  await caption('04 地址与消息','地址归属于当前会员，手机号在页面脱敏显示；订单事件处理后会形成顾客消息。');
  await go('/');await page.getByRole('button',{name:'加入购物车 丹东红颜草莓',exact:true}).click();await page.getByRole('button',{name:'加入购物车 智利车厘子 JJ级',exact:true}).click();await page.getByRole('button',{name:'购物车 2 件',exact:true}).click();
  await caption('05 购物车与服务端金额','数量、库存与金额实时由 API 校验；满99元免配送费。本次演示不产生真实扣款。');
  await page.getByRole('link',{name:'去结算（2件）',exact:true}).click();await page.getByRole('heading',{name:'确认您的订单',exact:true}).waitFor();await page.getByPlaceholder('可填写包装、联系等需求（选填）').fill('系统录屏：冷链包装，送达请联系');
  await caption('06 幂等下单与库存预扣','订单以服务端价格、地址快照和整数分金额创建；同一幂等key重试返回原订单，库存不足时整笔事务回滚。');
  const firstOrder=await submitOrder();recorded.fulfilledOrder=firstOrder;
  await page.getByRole('button',{name:'去付款',exact:true}).first().click();await caption('07 支付沙箱','15分钟内完成支付，否则后台任务取消并归还库存。付款金额从订单读取，客户端不能修改金额。');
  await page.getByRole('button',{name:'确认沙箱支付',exact:true}).click();await expect(page.getByRole('dialog')).toBeHidden();
  const repeatPay=await request('/api/orders/'+firstOrder+'/pay','POST');if(repeatPay.httpStatus!==200)throw new Error('Repeat payment was not idempotent');recorded.repeatPayStatus=repeatPay.httpStatus;
  await caption('08 重复支付异常流程','本页刚完成付款后，再次向同一订单发起付款实际返回200并保持原业务结果；付款只记一笔，不重复增加销量。');
  await go('/admin');await page.getByRole('heading',{name:'您没有工作台访问权限'}).waitFor();await caption('09 会员访问工作台被拦截','会员可以访问本人购物数据；运营、库存、财务、角色管理与审计按员工职责开放。');
  await logout();await login('warehouse');await go('/admin/orders');const row=page.locator('tr').filter({hasText:firstOrder});await row.getByRole('button',{name:'查看详情',exact:true}).click();
  await caption('10 仓库角色：待拣货','仓库工作台只开放经营、库存和履约相关能力。订单详情中的手机号经过脱敏处理。');
  await page.getByRole('button',{name:'开始拣货',exact:true}).click();await page.getByRole('button',{name:'确认发出配送',exact:true}).waitFor();await caption('11 状态机：拣货中','履约必须依次转换，不能从待付款直接发出。售后待审核会冻结后续履约。',5000);
  await page.getByRole('button',{name:'确认发出配送',exact:true}).click();await page.getByRole('dialog').getByText('配送中',{exact:true}).waitFor();await page.getByRole('button',{name:'关闭',exact:true}).click();
  const denial=await request('/api/admin/users');if(denial.httpStatus!==403)throw new Error('Warehouse RBAC not enforced');recorded.rbacDenial=denial;
  await explain('rbac','服务端真实权限拦截',`<h2>warehouse → GET /api/admin/users</h2><p><b>实际返回 HTTP ${denial.httpStatus}</b></p><pre>${esc(JSON.stringify(denial.response,null,2))}</pre><p>角色在每次请求中重新从数据库读取，旧JWT权限可以即时撤销。</p>`);
  await caption('12 服务端 RBAC：真实 HTTP 403','这是一条刚执行的实际请求结果，包含traceId。前端隐藏菜单之外，直接请求接口同样被拒绝。',9000);
  await logout();await login(username,password);await go('/orders');await page.getByRole('button',{name:'确认收货',exact:true}).first().click();await page.getByRole('button',{name:'确认收到商品',exact:true}).click();await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByRole('button',{name:'评价商品',exact:true}).first().click();await page.getByLabel('评价内容',{exact:true}).fill('食材新鲜，冷链包装完整，购物流程顺畅');await page.getByRole('button',{name:'发布评价',exact:true}).click();await expect(page.getByRole('dialog')).toBeHidden();
  await caption('13 收货与真实购买评价','只有订单本人可以确认收货；评价须为已收货且购买过的商品，每件商品在同一订单只能评价一次。');
  const secondOrder=await order();recorded.refundedOrder=secondOrder;await page.locator('.order-card').filter({hasText:secondOrder}).getByRole('button',{name:'申请售后',exact:true}).click();await page.getByLabel('售后原因',{exact:true}).fill('录屏演示：商品尚未发货，需要调整采购计划');await page.getByRole('button',{name:'提交售后申请',exact:true}).click();await expect(page.getByRole('dialog')).toBeHidden();
  await caption('14 售后申请与互斥','第二笔已付款订单申请整单退款。待审核时冻结履约和财务结算，避免同时发货、退款或重复记账。');
  await logout();await login('support');await go('/admin/refunds');const refund=page.locator('tr').filter({hasText:secondOrder});await refund.getByRole('button',{name:'同意退款',exact:true}).click();
  await page.getByPlaceholder('填写核实结果与处理理由',{exact:true}).fill('核实未配送，同意整单退款并归还预扣库存');await page.getByRole('button',{name:'确认退款',exact:true}).click();await expect(page.getByRole('dialog')).toBeHidden();await refund.getByText('已通过',{exact:true}).waitFor();
  await caption('15 客服审核退款','未配送的商品归还库存；已配送的生鲜不回可售库存。审核结果、金额和操作人记录到审计日志。');
  await logout();await login('finance');await go('/admin/settlements');await page.getByRole('button',{name:'结算已完成订单',exact:true}).click();await page.getByRole('button',{name:'确认结算',exact:true}).click();await expect(page.getByRole('dialog')).toBeHidden();await page.locator('table').getByText(firstOrder,{exact:true}).waitFor();
  await caption('16 财务结算','结算第一笔已收货订单；退款订单与待审核售后排除。每个订单结算记录具有唯一约束。');
  await page.getByRole('button',{name:'结算已完成订单',exact:true}).click();await page.getByRole('button',{name:'确认结算',exact:true}).click();await expect(page.getByRole('dialog')).toBeHidden();await expect(page.getByRole('status').filter({hasText:'已结算0笔订单'})).toBeVisible();
  await caption('17 重复结算返回0笔','刚重复执行同一结算批次，系统跳过已结算订单；避免重复账务。本平台账务仍为实验沙箱。',5000);
  await logout();await login('admin');await go('/admin/audit');await page.getByRole('heading',{name:'审计日志',exact:true}).waitFor();
  await caption('18 管理员审计','操作人、业务对象、事件、时间和traceId可追踪；密码与JWT不会写进审计详情。');await go('/admin');await page.getByRole('heading',{name:'经营概览',exact:true}).waitFor();
  await caption('19 实际经营与服务状态','订单、成交、售后、库存和待发送消息均取自当前数据库。没有订单时显示真实空状态。');
  const architecture=readFileSync('docs/diagrams/architecture.png').toString('base64');await explain('architecture','架构与技术选型',`<img src="data:image/png;base64,${architecture}" alt="实际架构">`);
  await caption('20 架构讲解','React只通过JSON接口交互；Controller处理鉴权参数，Service维护业务不变量，Repository负责事务与行锁。模块化单体通过环境变量配置。',11000);
  await explain('consistency','关键难点：库存、幂等与消息一致性',`<div class="grid"><section><h2>库存与状态竞争</h2><pre>UPDATE products\nSET stock = stock - quantity\nWHERE stock &gt;= quantity AND active = 1;</pre><p>按商品id排序扣减；失败全回滚。</p><p>用户行锁 + user/key唯一 + 请求摘要。</p><p>付款/取消竞争锁定同一个订单。</p></section><section><h2>可靠事件：Outbox</h2><p>订单 + 审计 + Outbox 同事务提交。</p><p>processing租约 / 失败重试。</p><p>RabbitMQ持久化消息 + 发布确认。</p><p>processed_events唯一；通知提交后Ack。</p><p>重复传输产生一次业务效果。</p></section></div>`);
  await caption('21 企业级一致性与可靠性','两种数据库验证并发争抢最后3件、8次幂等下单、重复支付及付款取消竞争；真实RabbitMQ验证确认发布和消费去重。',11000);
  await explain('tests','测试与实测结果',`<table><tr><th>验证项目</th><th>本次实际结果</th></tr><tr><td>SQLite / PostgreSQL后端</td><td>各28/28通过</td></tr><tr><td>行覆盖率 / 分支覆盖率</td><td>SQLite 87.02% / 80.63%；PG 88.20% / 80.89%</td></tr><tr><td>本地与Docker浏览器E2E</td><td>分别5/5通过</td></tr><tr><td>实际缓存与队列</td><td>8/8通过；Prometheus target UP=1</td></tr><tr><td>依赖审计 / 类型 / 构建</td><td>0项已知告警 / 通过 / 通过</td></tr><tr><td>本机商品接口短时测量</td><td>200请求，并发10；p95 ${report.load.p95Ms}ms，错误率0%</td></tr></table><p>最后一项仅约0.168秒突发测量；不代表持续容量或生产SLA。原始数据与日志位于 docs/evidence。</p>`);
  await caption('22 测试范围与结果','测试包括并发、回滚、越权、状态机、售后冻结、超时与重复结算。覆盖率按两套报告分别记录，不相加。',11000);
  await page.goto('http://127.0.0.1:3000/login');await page.locator('input[name="user"]').fill('admin');await page.locator('input[name="password"]').fill(env.GRAFANA_PASSWORD);await page.locator('button[type="submit"]').click();await page.waitForURL(u=>!u.pathname.endsWith('/login'));
  await page.goto('http://127.0.0.1:3000/d/freshmarket?orgId=1&from=now-30m&to=now&timezone=browser');await page.getByText('API健康',{exact:true}).waitFor();await page.waitForTimeout(2500);
  await caption('23 实际 Grafana 监控','Prometheus采集实际请求计数、响应延迟、进程内存与事件循环指标；告警规则提供服务掉线、5xx和延迟阈值。',10000);
  await go('/api/docs/');await page.getByRole('heading',{name:/鲜境 FreshMarket API/}).waitFor();await caption('24 接口与工程化','统一 Result、分页和异常；traceId贯穿请求。Swagger/OpenAPI、锁文件、CI门禁与Docker配置随源码交付。');
  await explain('ai','AI使用与可复现过程',`<h2>原始用户Prompt</h2><pre>按照所给文档的要求完成系统搭建，目标是仿盒马搭建企业级生鲜购物平台</pre><div class="grid"><div><h2>工具与记录</h2><p>Codex / GPT-6系列，2026-10-06。</p><p>需求、选型、数据、编码、测试、部署与优化阶段留痕。</p><p>采纳依据、实际修正与证据在AI日志及ADR。</p></div><div><h2>实际修正</h2><p>扫描教材 → 渲染章节视觉读取。</p><p>Windows权限 → 工具审批后执行。</p><p>E2E登录定位歧义 → 限定header。</p><p>Swagger依赖告警 → 升级并回归。</p></div></div>`);
  await caption('25 AI辅助开发与决策','生成结果经类型检查、自动测试、依赖审计和真实组件验证后采纳。没有补造团队评审、远端CI运行或人工签名。',10000);
  await explain('delivery','交付、复现与下一步',`<div class="grid"><section><h2>本地开发</h2><pre>Node.js 24+\nnpm ci\nnpm run dev</pre><h2>完整Docker</h2><pre>scripts/init-env.ps1\ndocker compose --env-file .env.docker\nup -d --build</pre><p>商城localhost:8080；Grafana localhost:3000。</p></section><section><h2>交付物</h2><p>源码 / SQL / 部署脚本 / 锁文件。</p><p>3类Word、实验报告、PPT、实际录屏。</p><p>测试原始证据、图片来源、归档SHA256。</p><h2>范围与改进</h2><p>真实支付、配送、部分退款、批次溯源。</p><p>HA、集群限流、长时压测及恢复演练。</p><p>姓名、学号、分工和签名由提交人填写。</p></section></div>`);
  await caption('26 总结与复现','鲜境已实现购物、角色、履约、售后、评价及结算闭环，并实际连接数据库、缓存、消息与监控。交付包提供可复现启动及验证步骤。',11000);
  if(errors.length)throw new Error('Browser page errors: '+errors.join('; '));
  await context.close();const raw=await video.path(),dest=path.resolve(speed===0?'.runtime/recording-check.webm':'deliverables/鲜境_系统演示.webm');renameSync(raw,dest);
  const duration=+( (Date.now()-started)/1000).toFixed(1);if(duration>=900 || statSync(dest).size<50000)throw new Error('Recording duration/size invalid');
  writeFileSync(speed===0?'.runtime/recording-check.json':'deliverables/video-manifest.json',JSON.stringify({file:path.basename(dest),durationSeconds:duration,viewport:{width:1440,height:1000},format:'WebM / VP8',narration:'Chinese captions over actual browser operation; no spoken audio',fullDockerUrl:root,recorded,steps,browser:browser.version(),errors},null,2));
  console.log('Completed actual system recording:',duration,'seconds;',statSync(dest).size,'bytes.');
}catch(error){await page.screenshot({path:'.runtime/recording-failure.png'}).catch(()=>{});await context.close().catch(()=>{});throw error;}
finally{await browser.close();}
