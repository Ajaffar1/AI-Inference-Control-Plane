// Optional development tool: npm install --no-save playwright && npx playwright install chromium
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { createServer } from '../src/server.js';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE??'playwright');
const server=createServer({demo:true});
await new Promise((resolve,reject)=>{server.on('error',reject);server.listen(0,'127.0.0.1',resolve);});
let browser;
try {
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1440,height:1080},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>document.querySelector('#mode').textContent.includes('DEMO'));
  await page.waitForSelector('#scatter circle');
  await mkdir('docs/images',{recursive:true});
  await page.screenshot({path:'docs/images/overview.png'});
  await page.click('#theme');await page.screenshot({path:'docs/images/overview-dark.png'});
  await page.locator('#routing').scrollIntoViewIfNeeded();await page.locator('#routing').screenshot({path:'docs/images/routing-studio.png'});
  await page.locator('#lab').scrollIntoViewIfNeeded();await page.locator('#lab').screenshot({path:'docs/images/experiment-lab.png'});
  await page.locator('#quality').fill('100');await page.locator('#quality').dispatchEvent('input');
  if(!(await page.locator('#route-result').textContent()).includes('No eligible'))throw new Error('Routing constraint UI failed');
  await page.locator('#events tr').first().click();await page.waitForSelector('#inspector[open]');
  if(!(await page.locator('#request-detail').textContent()).includes('rateVersion'))throw new Error('Inspector failed');
  await page.click('#close-inspector');
  await page.setViewportSize({width:390,height:844});await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>document.querySelector('#mode').textContent.includes('DEMO'));
  if(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth))throw new Error('Mobile viewport has horizontal overflow');
  await page.screenshot({path:'docs/images/mobile.png'});
  if(errors.length)throw new Error(errors.join('\n'));
  console.log('Screenshots captured; desktop, mobile, routing constraints and inspector verified.');
}finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
