import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

import { devProjectService } from './tools/dev-service';

/**
 * Vite 会给入口脚本加上 type="module" crossorigin，
 * 而 file:// 下的浏览器会以 CORS 为由拒绝执行 module 脚本 —— 页面直接白屏。
 * 单文件产物已经打成 IIFE，这个属性没有意义，去掉它。
 */
function stripModuleType(): Plugin {
  return {
    name: 'storymaker:strip-module-type',
    enforce: 'post',
    // 必须用 generateBundle：vite-plugin-singlefile 正是在这个阶段
    // 才把 JS/CSS 内联进 HTML，transformIndexHtml 跑得太早看不到结果。
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type !== 'asset' || !file.fileName.endsWith('.html')) continue;
        file.source = String(file.source)
          .replace(/<script type="module" crossorigin>/g, '<script>')
          .replace(/<script type="module">/g, '<script>');
      }
    },
  };
}

/**
 * 两种构建产物：
 *
 *   vite build                     → dist/，常规多文件，适合放到内网服务器
 *   vite build --mode singlefile   → release/StoryMaker.html，所有 JS/CSS 内联成一个文件，
 *                                    策划双击就能用，不需要服务、不需要安装任何东西
 */
export default defineConfig(({ mode }) => {
  const single = mode === 'singlefile';

  return {
    // 单文件是用 file:// 打开的，资源路径必须相对
    base: './',
    plugins: [
      react(),
      // 开发时页面的项目文件读写也走本地服务，见 tools/dev-service.ts
      devProjectService(),
      ...(single ? [viteSingleFile(), stripModuleType()] : []),
    ],
    server: {
      port: 5180,
    },
    build: {
      outDir: single ? 'release' : 'dist',
      emptyOutDir: true,
      // 单文件模式必须把所有资源内联进 HTML
      assetsInlineLimit: single ? 100_000_000 : 4096,
      chunkSizeWarningLimit: 100_000_000,
      cssCodeSplit: !single,
      // 关键：单文件是用 file:// 打开的，而浏览器会以 CORS 为由拒绝加载
      // file:// 下的 <script type="module">。所以必须打成 IIFE 普通脚本。
      ...(single
        ? {
            target: 'es2020',
            modulePreload: false,
            rollupOptions: {
              output: {
                format: 'iife' as const,
                inlineDynamicImports: true,
              },
            },
          }
        : {}),
    },
  };
});
