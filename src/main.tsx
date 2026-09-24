import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import { loadSettings } from './state/prefs';
import { ErrorBoundary } from './ui/ErrorBoundary';
import './styles.css';

/**
 * 挂载入口。
 *
 * 必须等 DOM 就绪：单文件产物为了避开 file:// 下的 module 限制被打成了普通脚本，
 * 而普通脚本（非 defer）在 <head> 里就会执行，那时 #root 还没解析出来。
 */
function mount(): void {
  // 先把主题写到 <html> 上，免得深色主题下启动瞬间闪一下白
  document.documentElement.dataset.theme = loadSettings().theme;

  const container = document.getElementById('root');
  if (container === null) {
    document.body.innerHTML =
      '<pre style="padding:24px;font:14px monospace">启动失败：页面里找不到 #root 挂载点。</pre>';
    return;
  }

  createRoot(container).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount, { once: true });
} else {
  mount();
}
