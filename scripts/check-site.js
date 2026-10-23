// 本地检查：node scripts/check-site.js   （内部链接、lang/title/description、发布前残留、脚本规则、体积预算、sitemap、app-config.json）
// 站点根目录 = 本仓库根目录；.git、scripts、node_modules 不参与检查。
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const SKIP = new Set(['.git', 'scripts', 'node_modules']);
const pages = [];
(function walk(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) { if (!SKIP.has(f.name)) walk(p); } else if (f.name.endsWith('.html')) pages.push(p);
  }
})(root);
let errors = 0;
const err = (m) => { errors++; console.log('ERROR', m); };
const rel = (p) => path.relative(root, p).replace(/\\/g, '/');
function resolve(from, href) {
  let u = href.split('#')[0].split('?')[0];
  if (!u) return null;
  const abs = u.startsWith('/') ? path.join(root, u) : path.resolve(path.dirname(from), u);
  if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
  const idx = path.join(abs, 'index.html');
  return fs.existsSync(idx) ? idx : false;
}
for (const p of pages) {
  const h = fs.readFileSync(p, 'utf8');
  const r = rel(p);
  if (!/<html[^>]+lang="[^"]+"/.test(h)) err(r + ' 缺 lang');
  const t = h.match(/<title>([^<]+)<\/title>/);
  if (!t) err(r + ' 缺 title');
  if (!/<meta name="description" content="[^"]+"/.test(h)) err(r + ' 缺 description');
  // 发布前残留检查：占位、草稿标记、内部引用、本地路径一律不得出现
  const banned = ['class="ph"', '[To verify', '[待', 'DRAFT', 'Draft before publishing', '发布前草稿', 'legal review', '(D-', 'TODO', 'README', 'C:\\', '/Users/'];
  for (const pat of banned) if (h.includes(pat)) err(r + ' 含发布前残留：' + pat);
  for (const cm of h.matchAll(/<!--([\s\S]*?)-->/g)) if (cm[1].includes('D-1')) err(r + ' HTML 注释含 D-1');
  if (/CleanFlow/i.test(h)) err(r + ' 出现 CleanFlow');
  // 图片必须有 alt / width / height
  for (const im of h.matchAll(/<img\b[^>]*>/g)) {
    const tag = im[0];
    if (!/\balt="/.test(tag)) err(r + ' 图片缺 alt：' + tag.slice(0, 80));
    if (!/\bwidth="\d+"/.test(tag) || !/\bheight="\d+"/.test(tag)) err(r + ' 图片缺 width/height：' + tag.slice(0, 80));
  }
  // srcset 指向的文件必须存在
  for (const ss of h.matchAll(/\bsrcset="([^"]*)"/g)) {
    for (const part of ss[1].split(',')) {
      const u = part.trim().split(/\s+/)[0];
      if (u && resolve(p, u) === false) err(r + ' srcset 断链 ' + u);
    }
  }
  // hreflang 互指：本页与对应语言页都声明 en / zh-CN，且两边的声明一致（lite：404.html 是 noindex 的双语错误页，不参与）
  const alts = {};
  for (const a of h.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="https:\/\/pelmavio\.com([^"]*)"/g)) alts[a[1]] = a[2];
  if (r === '404.html') { if (!/<meta name="robots" content="noindex"/.test(h)) err(r + ' 应为 noindex'); }
  else if (!alts.en || !alts['zh-CN']) err(r + ' 缺 hreflang en / zh-CN');
  else {
    const self = '/' + r.replace(/index\.html$/, '');
    if (self !== alts.en && self !== alts['zh-CN']) err(r + ' hreflang 未指向自身');
    for (const l of [alts.en, alts['zh-CN']]) {
      const tp = resolve(path.join(root, 'x'), '.' + l);
      if (!tp) { err(r + ' hreflang 目标不存在 ' + l); continue; }
      const th = fs.readFileSync(tp, 'utf8');
      const back = {};
      for (const a of th.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="https:\/\/pelmavio\.com([^"]*)"/g)) back[a[1]] = a[2];
      if (back.en !== alts.en || back['zh-CN'] !== alts['zh-CN']) err(r + ' hreflang 与对方页面不互指 ' + l);
    }
  }
  for (const m of h.matchAll(/\b(?:href|src)="([^"]*)"/g)) {
    const u = m[1];
    if (/^mailto:/.test(u)) continue;
    if (/^data:image\//.test(u)) continue;
    if (/^https:\/\/pelmavio\.com\//.test(u) && m[0].startsWith('href')) {
      if (resolve(p, u.replace('https://pelmavio.com', '')) === false) err(r + ' 站内绝对链接断链 ' + u);
      continue;
    }
    if (/^(https?:)?\/\//.test(u)) { err(r + ' 外链 ' + u); continue; }
    if (u.startsWith('#')) { if (!h.includes('id="' + u.slice(1) + '"')) err(r + ' 锚点失效 ' + u); continue; }
    const target = resolve(p, u);
    if (target === false) err(r + ' 断链 ' + u);
    else if (target && u.includes('#')) {
      const id = u.split('#')[1];
      if (id && !fs.readFileSync(target, 'utf8').includes('id="' + id + '"')) err(r + ' 锚点失效 ' + u);
    }
  }
  // 脚本（D-142 收窄放开）：只允许 <script src="本站相对路径.js"></script>，不许内联脚本、事件属性、外链脚本
  for (const sc of h.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const src = (sc[1].match(/src="([^"]+)"/) || [])[1];
    if (!src || sc[2].trim()) { err(r + ' 含内联脚本'); continue; }
    if (/^(https?:)?\/\//.test(src) || !/\.js$/.test(src)) err(r + ' 脚本不是本站 .js 文件 ' + src);
    else if (!resolve(p, src)) err(r + ' 脚本断链 ' + src);
  }
  if (/\son[a-z]+\s*=\s*["']/i.test(h.replace(/<script[\s\S]*?<\/script>/gi, ''))) err(r + ' 含内联事件属性');
  if (/@import|url\(\s*['"]?https?:/i.test(h)) err(r + ' 含外部资源');
}
// 本站 JS：不得请求网络、不得使用 cookie / 本地存储
const jsFiles = [];
(function walk(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const q = path.join(d, f.name);
    if (f.isDirectory()) { if (!SKIP.has(f.name)) walk(q); } else if (f.name.endsWith('.js')) jsFiles.push(q);
  }
})(root);
for (const j of jsFiles) {
  const t = fs.readFileSync(j, 'utf8');
  if (/https?:\/\/|fetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|document\.cookie|localStorage|sessionStorage|indexedDB|importScripts|import\s*\(/.test(t)) err(rel(j) + ' 含网络请求或存储调用');
}
// 体积按线上实际字节计：仓库存 LF，Windows 工作区的 CRLF 不算（GitHub Pages 发出的是 LF）
const served = (t) => Buffer.byteLength(t.split(String.fromCharCode(13)).join(''));
const jsBytes = (h, full) => [...h.matchAll(/<script[^>]*src="([^"]+)"/g)].reduce((n, m) => { const t = resolve(full, m[1]); return n + (t ? served(fs.readFileSync(t, 'utf8')) : 0); }, 0);
const css = fs.readFileSync(path.join(root, 'assets/style.css'), 'utf8');
if (/https?:\/\/|@import/.test(css)) err('style.css 含外部资源');
// sitemap 只含存在的页面，且覆盖所有页面
const sm = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
const locs = [...sm.matchAll(/<loc>https:\/\/pelmavio\.com([^<]*)<\/loc>/g)].map((m) => m[1]);
for (const l of locs) if (!resolve(path.join(root, 'x'), '.' + l)) err('sitemap 指向不存在页面 ' + l);
for (const p of pages) {
  if (rel(p) === '404.html') continue; // lite：noindex，不进 sitemap
  const u = '/' + rel(p).replace(/index\.html$/, '');
  if (!locs.includes(u)) err('sitemap 未登记 ' + u);
}
// 首页体积预算：HTML + CSS + JS < 60KB；加上页面实际加载的图片 < 300KB
for (const hp of ['index.html', 'zh/index.html']) {
  const full = path.join(root, hp);
  const h = fs.readFileSync(full, 'utf8');
  const code = served(h) + served(css) + jsBytes(h, full);
  const imgs = new Set([...h.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]));
  let imgBytes = 0;
  for (const u of imgs) { const t = resolve(full, u); if (t) imgBytes += fs.statSync(t).size; }
  const kb = (n) => (n / 1024).toFixed(1) + 'KB';
  console.log(hp + '：HTML+CSS+JS ' + kb(code) + '，图片 ' + kb(imgBytes) + '，合计 ' + kb(code + imgBytes));
  if (code > 60 * 1024) err(hp + ' HTML+CSS+JS 超过 60KB');
  if (code + imgBytes > 300 * 1024) err(hp + ' 总体积超过 300KB');
}
// 每页体积预算（D-142）：HTML + CSS + JS（不含图片）< 150KB
for (const p of pages) {
  const h = fs.readFileSync(p, 'utf8');
  const code = served(h) + served(css) + jsBytes(h, p);
  if (code > 150 * 1024) err(rel(p) + ' HTML+CSS+JS 超过 150KB（' + (code / 1024).toFixed(1) + 'KB）');
}
// App 版本检查配置（D-110）：ringwell/app-config.json 必须是合法 JSON，minSupportedVersion 为版本号；写错的字段 App 会忽略，这里提前拦住
(function () {
  const f = path.join(root, 'ringwell/app-config.json');
  if (!fs.existsSync(f)) { err('缺 ringwell/app-config.json'); return; }
  let o;
  try { o = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { err('app-config.json 不是合法 JSON：' + e.message); return; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) { err('app-config.json 根必须是对象'); return; }
  const ver = (v) => typeof v === 'string' && /^v?\d+(\.\d+){0,3}(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/.test(v);
  if (!ver(o.minSupportedVersion)) err('app-config.json: minSupportedVersion 必须是版本号字符串');
  for (const k of ['latestVersion', 'forceUntilVersion']) if (o[k] !== undefined && !ver(o[k])) err('app-config.json: ' + k + ' 必须是版本号字符串');
  for (const k of ['message_en', 'message_zh']) if (o[k] !== undefined && (typeof o[k] !== 'string' || o[k].length > 300)) err('app-config.json: ' + k + ' 必须是不超过 300 字的字符串');
  const known = ['minSupportedVersion', 'latestVersion', 'forceUntilVersion', 'message_en', 'message_zh', '_note'];
  for (const k of Object.keys(o)) if (!known.includes(k)) err('app-config.json: 未知字段 ' + k);
  const zero = ver(o.minSupportedVersion) && o.minSupportedVersion.replace(/^v/, '').split(/[.+-]/).every((x) => x === '0' || !/^\d+$/.test(x));
  console.log('ringwell/app-config.json：minSupportedVersion ' + o.minSupportedVersion + (zero ? '（不强制）' : '（会对低于此版本的用户强制更新！）'));
})();
console.log(pages.length + ' 个页面已检查，' + (errors ? errors + ' 个问题' : '全部通过'));
process.exit(errors ? 1 : 0);
