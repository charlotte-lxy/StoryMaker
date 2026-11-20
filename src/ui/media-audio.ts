/**
 * 给素材管理的 <audio> 元素套上 Web Audio，让音量能超过 1.0。
 *
 * 为什么不用 <audio>.volume：它的上限就是 1，而音效条目的音量倍率最高到 2。
 * 这里把元素接到一个共享的 AudioContext（GainNode 管音量），元素的
 * currentTime / duration 仍然可用，进度条和拖动跳转照旧。
 *
 * 没有 AudioContext 的环境（jsdom 测试）退回 <audio>.volume（夹在 0–1），
 * 保证界面和播放流程不会因此坏掉。
 */

const wired = new WeakMap<HTMLAudioElement, { context: AudioContext; gain: GainNode }>();

let sharedContext: AudioContext | null = null;

function ensureContext(): AudioContext | null {
  if (sharedContext !== null) return sharedContext;
  if (typeof window === 'undefined') return null;

  const ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (ctor === undefined) return null;

  sharedContext = new ctor();
  return sharedContext;
}

/**
 * 按这一行的音量 / 音调准备播放：音调设到元素的 playbackRate，
 * 音量走 GainNode（第一次调用时接上 AudioContext）。
 */
export function prepareAudioElement(
  audio: HTMLAudioElement,
  volume: number,
  pitch: number,
): void {
  audio.playbackRate = pitch;

  const existing = wired.get(audio);
  if (existing !== undefined) {
    existing.gain.gain.value = volume;
    void existing.context.resume().catch(() => undefined);
    return;
  }

  const context = ensureContext();
  if (context === null) {
    audio.volume = Math.min(1, Math.max(0, volume));
    return;
  }

  try {
    const source = context.createMediaElementSource(audio);
    const gain = context.createGain();
    gain.gain.value = volume;
    source.connect(gain);
    gain.connect(context.destination);
    wired.set(audio, { context, gain });
  } catch {
    // 这个元素已经接过一次了（理论上走不到），退回元素自带的音量
    audio.volume = Math.min(1, Math.max(0, volume));
  }

  void context.resume().catch(() => undefined);
}
