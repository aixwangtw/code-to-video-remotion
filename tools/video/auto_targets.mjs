#!/usr/bin/env node
// 紅框／目標框座標自動量測：DOM 與 PDF.js 文字層版（R-85）。
// PDF.js 的文字層（.textLayer span）本來就是 DOM，所以同一套做法量得到 PDF 內的關鍵字位置。
//
// 用法：
//   node auto_targets.mjs --url URL --spec spec.json [--viewport 1920x1080] [--storage state.json]
//                         [--wait SELECTOR] [--settle 800] [--out targets.proposed.json] [--overlay overlay.png]
// spec.json：[{ "name":"Q1 題號", "selector":"css", "text":"關鍵字", "within":"css 限定範圍(可省)", "nth":0, "pad":4 }]
//   - 有 selector：取該元素 boundingBox（再以 text 在元素內縮小到關鍵字的 Range 矩形）
//   - 只有 text：在 within（預設整頁）的文字節點找關鍵字，用 Range.getClientRects 量
// 輸出座標為「目前視窗座標」（viewport，含捲動後位置），與錄影畫面同座標系。
// 這是「提議」：一定要看 overlay 圖人工確認一次，確認後把 box 複製進 targets.json 鎖定。
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => {
  if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return a;
}, []));
if (!args.url || !args.spec) { console.error('需要 --url 與 --spec；見檔頭說明'); process.exit(2); }
const [vw, vh] = (args.viewport || '1920x1080').split('x').map(Number);
const spec = JSON.parse(fs.readFileSync(args.spec, 'utf8'));

let browser;
try { browser = await chromium.launch({ headless: true }); }
catch { browser = await chromium.launch({ headless: true, channel: 'chrome' }); }
// 自有工具一律在 UA 結尾帶 AixwangBot 標記：aixwang.dev 的 GA4 與第一方閱讀紀錄只排除帶標記的「自己」，別人的自動化照算
// （規則見 ~/projects/Blog-Alex-Wang/src/lib/traffic-self.mjs）。
const ownToolUserAgent = (await browser.newPage().then(async (probe) => { const ua = await probe.evaluate(() => navigator.userAgent); await probe.close(); return ua; })) + ' AixwangBot/1.0';
const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, userAgent: ownToolUserAgent, ...(args.storage ? { storageState: args.storage } : {}) });
const page = await ctx.newPage();
await page.goto(args.url, { waitUntil: 'load' });
if (args.wait) await page.waitForSelector(args.wait, { timeout: 30000 });
await page.waitForTimeout(Number(args.settle || 800));

const results = await page.evaluate(({ spec }) => {
  const rectOf = (r) => ({ x: r.left, y: r.top, w: r.width, h: r.height });
  const union = (rs) => {
    const x0 = Math.min(...rs.map(r => r.left)), y0 = Math.min(...rs.map(r => r.top));
    const x1 = Math.max(...rs.map(r => r.right)), y1 = Math.max(...rs.map(r => r.bottom));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };
  // 文字節點串接成連續字串（PDF.js 一行常被切成多個 span），再把關鍵字位置映射回節點
  const findText = (root, text, nth) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = []; let full = '';
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const st = getComputedStyle(n.parentElement);
      if (st.visibility === 'hidden' || st.display === 'none') continue;
      nodes.push({ n, start: full.length }); full += n.nodeValue;
    }
    let idx = -1, from = 0;
    for (let k = 0; k <= nth; k++) { idx = full.indexOf(text, from); if (idx < 0) return null; from = idx + text.length; }
    const end = idx + text.length;
    const rects = [];
    for (const { n, start } of nodes) {
      const a = Math.max(idx, start), b = Math.min(end, start + n.nodeValue.length);
      if (a >= b) continue;
      const r = document.createRange(); r.setStart(n, a - start); r.setEnd(n, b - start);
      for (const cr of r.getClientRects()) if (cr.width > 0 && cr.height > 0) rects.push(cr);
    }
    return rects.length ? union(rects) : null;
  };
  return spec.map((s) => {
    const pad = s.pad ?? 4, nth = s.nth ?? 0;
    let box = null, how = '';
    const scope = s.selector ? document.querySelectorAll(s.selector)[nth] : (s.within ? document.querySelector(s.within) : document.body);
    if (s.selector && !scope) return { name: s.name, error: `找不到 selector ${s.selector}` };
    if (s.text) { box = findText(scope || document.body, s.text, s.selector ? 0 : nth); how = 'text'; }
    else { box = rectOf(scope.getBoundingClientRect()); how = 'selector'; }
    if (!box) return { name: s.name, error: `找不到文字「${s.text}」` };
    const r = [box.x - pad, box.y - pad, box.w + 2 * pad, box.h + 2 * pad].map(Math.round);
    const inView = r[0] >= 0 && r[1] >= 0 && r[0] + r[2] <= innerWidth && r[1] + r[3] <= innerHeight;
    return { name: s.name, box: r, method: how, in_viewport: inView };
  });
}, { spec });

if (args.overlay) {
  await page.evaluate((rs) => {
    for (const r of rs) if (r.box) {
      const d = document.createElement('div');
      d.style.cssText = `position:fixed;left:${r.box[0]}px;top:${r.box[1]}px;width:${r.box[2]}px;height:${r.box[3]}px;border:3px solid #e0242b;box-sizing:border-box;z-index:2147483647;pointer-events:none`;
      const l = document.createElement('span');
      l.textContent = r.name; l.style.cssText = 'position:absolute;left:0;top:-18px;background:#e0242b;color:#fff;font:12px sans-serif;padding:0 4px';
      d.appendChild(l); document.body.appendChild(d);
    }
  }, results);
  await page.screenshot({ path: args.overlay });
}
await browser.close();
const out = { generated_by: 'auto_targets.mjs', url: args.url, viewport: [vw, vh], status: 'PROPOSED（需人工看 overlay 確認後才鎖定進 targets.json）', targets: results };
const json = JSON.stringify(out, null, 2);
if (args.out) fs.writeFileSync(args.out, json); else console.log(json);
const bad = results.filter(r => r.error);
console.error(`量到 ${results.length - bad.length}/${results.length}` + (bad.length ? `；失敗：${bad.map(b => b.name + '→' + b.error).join('；')}` : ''));
process.exit(bad.length ? 1 : 0);
