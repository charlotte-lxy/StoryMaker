/**
 * 全局「正在响的音频」登记处。
 *
 * 素材管理的播放按钮、编辑弹窗的试听、剧情预览里的音效，各自把自己的「全停」
 * 注册进来。任意一处要开始播 / 试听时先调 `stopAllAudio()`，把别处的停掉——
 * 预览里多个音效可以叠着响，但试听和别的播放器不会各响各的。
 *
 * 只存回调，不持有音频对象，所以不需要按组件清理；组件卸载时注销自己的那条。
 */

const stoppers = new Set<() => void>();

/** 注册一个「停掉我这边的音频」回调；返回注销函数 */
export function registerAudioStopper(stop: () => void): () => void {
  stoppers.add(stop);
  return () => {
    stoppers.delete(stop);
  };
}

/** 停掉所有已注册的音频（注册本身保留，下次还能停） */
export function stopAllAudio(except?: () => void): void {
  for (const stop of stoppers) {
    if (stop === except) continue;
    try {
      stop();
    } catch {
      // 某一处停失败不影响其他
    }
  }
}
