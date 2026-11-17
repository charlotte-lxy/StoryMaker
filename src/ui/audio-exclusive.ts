/**
 * 音频互斥播放：同一时刻只放一个。
 *
 * 音效表里每条素材都有自己的播放器，点第二条时第一条要自己停掉。
 * 用一个模块级变量记住「当前在放谁」就够了——不需要 React 状态，
 * 因为暂停是直接操作 audio 元素，不涉及重渲染。
 */

let current: HTMLAudioElement | null = null;

/** 开始播放前调用：把别的播放器停掉，再把自己记成当前 */
export function playExclusive(audio: HTMLAudioElement): void {
  if (current !== null && current !== audio) {
    current.pause();
  }
  current = audio;
}

/** 暂停或播完时调用：如果自己就是当前那个，让出位置 */
export function releaseAudio(audio: HTMLAudioElement): void {
  if (current === audio) current = null;
}

/** 测试用：现在正在放的是谁 */
export function currentAudio(): HTMLAudioElement | null {
  return current;
}

/** 测试用：把状态清掉，免得用例之间互相影响 */
export function resetExclusiveAudio(): void {
  current = null;
}
