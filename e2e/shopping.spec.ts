import {test,expect,type Page,type APIRequestContext} from '@playwright/test';
import {mkdirSync} from 'node:fs';
mkdirSync('docs/screenshots',{recursive:true});
async function login(page:Page,username='admin'){
  await page.getByRole('banner').getByRole('button',{name:'登录 / 注册',exact:true}).click();
  await page.getByLabel('账号',{exact:true}).fill(username);
  await page.getByLabel('密码',{exact:true}).fill(process.env.DEMO_PASSWORD || 'Fresh@123456');
  await page.getByRole('button',{name:'登录',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeHidden();
}
async function register(page:Page){
  await page.getByRole('button',{name:'登录 / 注册',exact:true}).click();
  await page.getByRole('button',{name:'立即注册',exact:true}).click();
  const username='e2e_'+Date.now();
  await page.getByLabel('昵称',{exact:true}).fill('测试鲜客');
  await page.getByLabel('账号',{exact:true}).fill(username);
  await page.getByLabel('密码',{exact:true}).fill('Customer12345');
  await page.getByRole('button',{name:'注册并登录',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  return username;
}
async function address(page:Page){
  await page.goto('/account');
  await page.getByRole('button',{name:'新增地址',exact:true}).click();
  await page.getByLabel('收货人',{exact:true}).fill('测试鲜客');
  await page.getByLabel('手机号',{exact:true}).fill('13900139000');
  await page.getByLabel('详细地址',{exact:true}).fill('上海市浦东新区张江路88号 测试楼602室');
  await page.getByRole('button',{name:'保存地址',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeHidden();
}
async function buy(page:Page){
  await page.goto('/');
  await page.getByRole('button',{name:'加入购物车 丹东红颜草莓',exact:true}).click();
  await expect(page.getByRole('button',{name:'购物车 1 件',exact:true})).toBeVisible();
  await page.goto('/checkout');
  await page.getByRole('button',{name:'提交订单',exact:true}).click();
  await expect(page.getByRole('button',{name:'去付款',exact:true}).first()).toBeVisible();
  await page.getByRole('button',{name:'去付款',exact:true}).first().click();
  await page.getByRole('button',{name:'确认沙箱支付',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.locator('.order-card').first().getByText('待拣货',{exact:true})).toBeVisible();
  const text=await page.locator('.order-card-header strong').first().innerText();
  return text.replace('订单 ','');
}
async function staffToken(request:APIRequestContext){const r=await request.post('/api/auth/login',{data:{username:'admin',password:process.env.DEMO_PASSWORD || 'Fresh@123456'}});expect(r.status()).toBe(200);return (await r.json()).data.token;}

test('desktop catalog, real local images, search and product details',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width:1440,height:1050});await page.goto('/');
  await expect(page.getByRole('heading',{name:/今日鲜选/})).toBeVisible();
  await expect(page.locator('.product-card')).toHaveCount(12);
  await page.locator('.product-image img').first().evaluate((img:HTMLImageElement)=>img.decode());
  await page.evaluate(async()=>{await Promise.all(Array.from(document.images).map(img=>{img.loading='eager';return img.decode();}));});
  await page.screenshot({path:'docs/screenshots/01-home-desktop.png',fullPage:true});
  await page.getByRole('textbox',{name:'搜索商品',exact:true}).fill('三文鱼');await page.getByRole('button',{name:'搜索',exact:true}).click();
  await expect(page.locator('.product-card')).toHaveCount(1);
  await page.getByRole('link',{name:'挪威冰鲜三文鱼',exact:true}).first().click();
  await expect(page.getByRole('heading',{name:'挪威冰鲜三文鱼',exact:true})).toBeVisible();
  await expect(page.getByText('0–4°C 冷藏，充分加热',{exact:true})).toBeVisible();
  expect(errors).toEqual([]);
});
test('top navigation highlight stays in sync with the icon category bar',async({page})=>{
  await page.setViewportSize({width:1440,height:1050});await page.goto('/');
  const nav=page.locator('.main-nav'),iconBar=page.locator('.category-section');
  await expect(nav.getByRole('link',{name:'首页',exact:true})).toHaveClass(/active/);
  await nav.getByRole('link',{name:'海鲜水产',exact:true}).click();
  await expect(nav.getByRole('link',{name:'海鲜水产',exact:true})).toHaveClass(/active/);
  await expect(nav.getByRole('link',{name:'首页',exact:true})).not.toHaveClass(/active/);
  await expect(iconBar.getByRole('button',{name:'海鲜水产',exact:true})).toHaveClass(/selected/);
  await iconBar.getByRole('button',{name:'时令水果',exact:true}).click();
  await expect(nav.getByRole('link',{name:'时令水果',exact:true})).toHaveClass(/active/);
  await expect(iconBar.getByRole('button',{name:'时令水果',exact:true})).toHaveClass(/selected/);
  await nav.getByRole('link',{name:'首页',exact:true}).click();
  await expect(nav.getByRole('link',{name:'首页',exact:true})).toHaveClass(/active/);
  await expect(iconBar.getByRole('button',{name:'全部好物',exact:true})).toHaveClass(/selected/);
});
test('mobile shop has usable controls and no horizontal overflow',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/');
  await expect(page.locator('.product-card')).toHaveCount(12);
  await page.evaluate(async()=>{await Promise.all(Array.from(document.images).map(img=>{img.loading='eager';return img.decode();}));});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await expect(page.getByRole('button',{name:'加入购物车 丹东红颜草莓',exact:true})).toBeVisible();
  await page.screenshot({path:'docs/screenshots/02-home-mobile.png',fullPage:true});
});
test('member checkout, payment, staff fulfillment, receipt, review and settlement',async({page,request})=>{
  await page.goto('/');await register(page);await address(page);const order=await buy(page);
  await page.screenshot({path:'docs/screenshots/03-member-orders.png',fullPage:true});
  const token=await staffToken(request),headers={Authorization:'Bearer '+token};
  for(const status of ['picking','delivering'])expect((await request.post('/api/admin/orders/'+order+'/status',{headers,data:{status}})).status()).toBe(200);
  await page.getByRole('button',{name:'刷新订单',exact:true}).click();await page.getByRole('button',{name:'确认收货',exact:true}).first().click();await page.getByRole('button',{name:'确认收到商品',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeHidden();await page.getByRole('button',{name:'评价商品',exact:true}).first().click();await page.getByLabel('评价内容',{exact:true}).fill('新鲜好吃，配送包装完整');await page.getByRole('button',{name:'发布评价',exact:true}).click();await expect(page.getByRole('dialog')).toBeHidden();
  const first=await request.post('/api/admin/settlements',{headers});expect(first.status()).toBe(200);expect((await first.json()).data.count).toBeGreaterThanOrEqual(1);
  const repeated=await request.post('/api/admin/settlements',{headers});expect((await repeated.json()).data.count).toBe(0);
  await page.goto('/admin');await expect(page.getByRole('heading',{name:'您没有工作台访问权限'})).toBeVisible();
});
test('customer refund and service audit are visible in the workbench',async({page,request})=>{
  await page.goto('/');await register(page);await address(page);await buy(page);
  await page.getByRole('button',{name:'申请售后',exact:true}).first().click();await page.getByLabel('售后原因',{exact:true}).fill('尚未发货，需要取消本次采购');await page.getByRole('button',{name:'提交售后申请',exact:true}).click();await expect(page.getByRole('dialog')).toBeHidden();
  const memberToken=await page.evaluate(()=>sessionStorage.getItem('fresh-token'));
  const refunds=await request.get('/api/orders',{headers:{Authorization:'Bearer '+memberToken}});const refundId=(await refunds.json()).data.items[0].refund.id;
  await page.getByRole('button',{name:'退出登录',exact:true}).click();await login(page,'support');await page.goto('/admin/refunds');
  const row=page.locator('tr').filter({hasText:'尚未发货，需要取消本次采购'}).first();await row.getByRole('button',{name:'同意退款',exact:true}).click();await page.getByRole('button',{name:'确认退款',exact:true}).click();await expect(page.getByRole('dialog')).toBeHidden();
  await expect(row.getByText('已通过',{exact:true})).toBeVisible();await page.screenshot({path:'docs/screenshots/04-refund-workbench.png',fullPage:true});
  await page.getByRole('button',{name:'退出登录',exact:true}).click();await login(page);await page.goto('/admin');await expect(page.getByRole('heading',{name:'经营概览'})).toBeVisible();await page.screenshot({path:'docs/screenshots/05-admin-dashboard.png',fullPage:true});await page.goto('/admin/audit');await expect(page.getByRole('heading',{name:'审计日志'})).toBeVisible();await expect(page.locator('table')).toContainText('refund.decision');await page.screenshot({path:'docs/screenshots/06-audit-log.png',fullPage:true});
});
test('warehouse UI shows fulfillment and inventory but hides privileged sections',async({page})=>{
  await page.goto('/');await login(page,'warehouse');await page.goto('/admin/stock');await expect(page.getByRole('heading',{name:'库存管理',exact:true})).toBeVisible();
  await expect(page.locator('.admin-sidebar').getByRole('link',{name:'成员权限',exact:true})).toHaveCount(0);
  await expect(page.locator('.admin-sidebar').getByRole('link',{name:'财务结算',exact:true})).toHaveCount(0);
  await expect(page.locator('table').getByRole('button',{name:'调库存',exact:true}).first()).toBeVisible();
  await page.goto('/admin/users');await expect(page.getByRole('heading',{name:'当前账号没有此页面权限'})).toBeVisible();
});
