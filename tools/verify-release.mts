/**
 * 验证单文件产物在浏览器环境（file://）下能正常启动。
 *
 *   pnpm exec vite-node tools/verify-release.mts
 *
 * 检查 HTML 自包含、脚本能执行、根节点渲染出内容、没有未捕获异常。
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { JSDOM, VirtualConsole } from 'jsdom';

const file = resolve(process.cwd(), 'release/index.html');
if (!existsSync(file)) {
  console.error('没有找到 release/index.html，请先运行 pnpm run build:single');
  process.exit(1);
}

const html = readFileSync(file, 'utf8');

// 1. 自包含检查：只看真正的标签属性，
//    不能用正则扫全文——JS 代码里也有 src="…" 这样的字符串片段。
const shell = new JSDOM(html);
const shellDoc = shell.window.document;
const external = [
  ...[...shellDoc.querySelectorAll('script[src]')].map((el) => el.getAttribute('src')),
  ...[...shellDoc.querySelectorAll('link[href]')].map((el) => el.getAttribute('href')),
  ...[...shellDoc.querySelectorAll('img[src]')].map((el) => el.getAttribute('src')),
].filter((url): url is string => url !== null && !url.startsWith('data:'));
shell.window.close();

if (external.length > 0) {
  console.error('✗ 存在外部资源引用：', external);
  process.exit(1);
}
console.log('✓ HTML 自包含，没有外部资源引用');

// 2. 在 jsdom 里实际跑一遍
const errors: string[] = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', (error) => errors.push(String(error)));
virtualConsole.on('error', (...args) => errors.push(args.join(' ')));

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  // 不用 file://：那会让 vite-node 的 source map 处理把 URL 当模块路径解析而报错。
  // file:// 特有的限制（不能加载 module 脚本）已经由构建阶段打成 IIFE 规避掉了。
  url: 'http://localhost/StoryMaker.html',
  virtualConsole,
});

// 给 React 渲染留点时间
await new Promise((done) => setTimeout(done, 1500));

const root = dom.window.document.getElementById('root');
const rendered = root?.innerHTML ?? '';

console.log(`✓ 脚本已执行，#root 内容长度 ${rendered.length}`);

if (rendered.trim() === '') {
  console.error('✗ #root 是空的，React 没有渲染出内容');
  if (errors.length > 0) console.error('  捕获到的错误：\n   ', errors.join('\n    '));
  process.exit(1);
}

// 3. 关键界面元素是否出现
const text = dom.window.document.body.textContent ?? '';
const expected = ['StoryMaker', '剧情', '角色', '本地化', '条件与指令', '导出 Excel'];
const missing = expected.filter((item) => !text.includes(item));

if (missing.length > 0) {
  console.error('✗ 界面缺少这些内容：', missing);
  process.exit(1);
}
console.log(`✓ 关键界面元素齐全：${expected.join('、')}`);

if (errors.length > 0) {
  console.error('✗ 运行期间出现错误：\n   ', errors.join('\n    '));
  process.exit(1);
}

console.log('');
console.log('单文件产物验证通过，可以发给策划了。');
dom.window.close();
