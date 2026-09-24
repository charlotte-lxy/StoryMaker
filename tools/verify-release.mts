/**
 * 验证单文件产物 release/index.html。
 *
 *   pnpm exec vite-node tools/verify-release.mts
 *
 * 检查三件事：
 *   1. HTML 自包含，没有外部资源引用（file:// 下加载不到就会白屏）
 *   2. 没有本地服务时（直接双击 index.html）停在门槛页并给出提示，不会白屏也不会放行编辑
 *   3. 有宿主时（.bat 起的本地服务）能把项目读回来、编辑界面渲染齐全
 *   4. 启动器两个文件在同一个文件夹里，且 .ps1 带 UTF-8 BOM（PowerShell 5.1 读中文的前提）
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { JSDOM, VirtualConsole } from 'jsdom';

const root = process.cwd();
const file = resolve(root, 'release/index.html');
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

interface RunResult {
  rendered: string;
  text: string;
  /** 顶部项目名称输入框里的值：项目的名字靠它体现（输入框的值不在 textContent 里） */
  projectName: string;
  errors: string[];
}

/** 在 jsdom 里把页面真跑一遍，可以用 beforeParse 预置宿主环境 */
async function run(beforeParse?: (window: Window) => void): Promise<RunResult | null> {
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
    beforeParse: beforeParse as never,
  });

  // 给 React 渲染和异步的启动流程留点时间
  await new Promise((done) => setTimeout(done, 1500));

  const result: RunResult = {
    rendered: dom.window.document.getElementById('root')?.innerHTML ?? '',
    text: dom.window.document.body.textContent ?? '',
    projectName:
      (dom.window.document.querySelector('.project-name') as HTMLInputElement | null)?.value ?? '',
    errors,
  };
  dom.window.close();

  if (result.rendered.trim() === '') {
    console.error('✗ #root 是空的，React 没有渲染出内容');
    if (errors.length > 0) console.error('  捕获到的错误：\n   ', errors.join('\n    '));
    return null;
  }
  if (errors.length > 0) {
    console.error('✗ 运行期间出现错误：\n   ', errors.join('\n    '));
    return null;
  }
  return result;
}

function expectText(result: RunResult, expected: string[], label: string): boolean {
  const missing = expected.filter((item) => !result.text.includes(item));
  if (missing.length > 0) {
    console.error(`✗ ${label} 缺少这些内容：`, missing);
    return false;
  }
  console.log(`✓ ${label}：${expected.join('、')}`);
  return true;
}

// 2. 直接双击 index.html：没有宿主，只能停在门槛页
const bare = await run();
if (bare === null) process.exit(1);
if (!expectText(bare, ['StoryMaker', '先确定一个项目文件', '新建项目文件', '启动StoryMaker.bat'], '无本地服务时的门槛页')) {
  process.exit(1);
}
if (bare.text.includes('导出 Excel')) {
  console.error('✗ 没有项目文件时不该把编辑界面放出来');
  process.exit(1);
}
console.log('✓ 没有项目文件时不放行编辑界面');

// 3. 本地服务版：页面里注入令牌 + 一个假 fetch，界面应该正常进入编辑状态
const fakeProject = JSON.stringify({
  version: 1,
  name: '打包自检项目',
  characters: [],
  chapters: [],
});

const served = await run((window) => {
  (window as unknown as { __STORYMAKER_SERVER__: unknown }).__STORYMAKER_SERVER__ = {
    token: 'verify',
  };
  (window as unknown as { fetch: unknown }).fetch = async (url: string) => {
    const text = String(url);
    if (text.startsWith('/api/last-path')) {
      return { ok: true, status: 200, json: async () => ({ filePath: 'D:\\自检\\项目.json' }) };
    }
    if (text.startsWith('/api/read')) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => fakeProject,
        json: async () => ({}),
      };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ ok: true }),
      text: async () => '',
    };
  };
});

if (served === null) process.exit(1);
if (
  !expectText(
    served,
    ['StoryMaker', '剧情', '角色', '本地化', '条件与指令', '导出 Excel'],
    '有本地服务时的编辑界面',
  )
) {
  process.exit(1);
}
if (served.projectName !== '打包自检项目') {
  console.error(`✗ 项目文件里的项目名没读回来，实际是「${served.projectName}」`);
  process.exit(1);
}
console.log('✓ 上次打开的项目文件被自动读回来了');
if (served.text.includes('先确定一个项目文件')) {
  console.error('✗ 项目文件打开后还停在门槛页');
  process.exit(1);
}

// 4. 启动器必须和 index.html 待在同一个文件夹里
const launcher = resolve(root, 'release/启动StoryMaker.bat');
const server = resolve(root, 'release/storymaker-server.ps1');
for (const item of [launcher, server]) {
  if (!existsSync(item)) {
    console.error(`✗ release 里缺少启动文件：${item}`);
    process.exit(1);
  }
}

const serverSource = readFileSync(server);
if (!(serverSource[0] === 0xef && serverSource[1] === 0xbb && serverSource[2] === 0xbf)) {
  console.error('✗ storymaker-server.ps1 没有 UTF-8 BOM，Windows PowerShell 5.1 会把中文读成乱码');
  process.exit(1);
}
console.log('✓ 启动器齐全：启动StoryMaker.bat、storymaker-server.ps1（带 BOM）');

console.log('');
console.log('单文件产物验证通过，可以发给策划了。');
