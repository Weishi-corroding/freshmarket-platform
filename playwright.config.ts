import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'./e2e',timeout:60000,workers:1,fullyParallel:false,
  reporter:[['list'],['json',{outputFile:'docs/evidence/e2e-results.json'}]],
  use:{baseURL:process.env.E2E_BASE_URL || 'http://127.0.0.1:5173',channel:process.platform==='win32'&&!process.env.CI?'msedge':undefined,screenshot:'only-on-failure',trace:'retain-on-failure'},
  webServer:process.env.E2E_BASE_URL?undefined:{command:'npm run dev',url:'http://127.0.0.1:5173',reuseExistingServer:!process.env.CI,timeout:60000}
});
