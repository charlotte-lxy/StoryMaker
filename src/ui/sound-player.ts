/**
 * 预览 / 试听用的音频播放器。
 *
 * 用 Web Audio 而不是 <audio>，是因为两件事 <audio> 做不到：
 *   - 音量可以超过 1.0（GainNode），音效条目上的音量倍率最高到 2
 *   - 「结束预览 / 重播」时要把**所有**正在响的音一次性停掉，而且允许多条叠着播
 *
 * 每个播放器自己管一组 source；`stopAll()` 一停全停。
 * 环境里没有 AudioContext（比如 jsdom 测试）时什么也不做，绝不抛错。
 */

import type { AssetFileInfo, HostApi } from '../core/host';

export class SoundPlayer {
  private context: AudioContext | null = null;
  private sources = new Set<AudioBufferSourceNode>();

  /** 惰性建 AudioContext：没有用户手势就建会一直 suspended，首次播放时再 resume */
  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (this.context !== null) return this.context;

    const ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (ctor === undefined) return null;

    this.context = new ctor();
    return this.context;
  }

  /** 正在响的条数（界面用来显示「试听中」） */
  get playing(): number {
    return this.sources.size;
  }

  /**
   * 播一条音频。
   *
   * 找不到素材、宿主不支持、浏览器解不了这个格式，都只是「没声音」——不报错。
   */
  async play(
    host: HostApi | undefined,
    file: AssetFileInfo,
    volume: number,
    pitch: number,
  ): Promise<void> {
    const context = this.ensureContext();
    if (context === null || host?.unreal === undefined) return;

    if (context.state === 'suspended') {
      await context.resume().catch(() => undefined);
    }

    const result = await host.unreal.readAsset(file.filePath).catch(() => undefined);
    if (result === undefined || !result.ok || result.data === undefined) return;

    const buffer = await context
      .decodeAudioData(result.data.slice().buffer)
      .catch(() => null);
    if (buffer === null) return;

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = pitch;

    const gain = context.createGain();
    gain.gain.value = volume;
    source.connect(gain);
    gain.connect(context.destination);

    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
    };
    source.start();
  }

  /** 停掉所有正在响的音频（结束预览、重播、关弹窗都调它） */
  stopAll(): void {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // 已经自然播完的 source 再 stop 会抛，忽略
      }
    }
    this.sources.clear();
  }
}
