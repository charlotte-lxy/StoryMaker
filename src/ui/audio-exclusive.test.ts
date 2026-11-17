import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  currentAudio,
  playExclusive,
  releaseAudio,
  resetExclusiveAudio,
} from './audio-exclusive';

afterEach(resetExclusiveAudio);

/** 假的 audio：只关心 pause / play 有没有被调 */
function fakeAudio() {
  const state = { paused: true };
  const audio = {
    get paused() {
      return state.paused;
    },
    pause: vi.fn(() => {
      state.paused = true;
    }),
    play: vi.fn(() => {
      state.paused = false;
    }),
  };
  return audio as unknown as HTMLAudioElement & {
    pause: ReturnType<typeof vi.fn>;
    play: ReturnType<typeof vi.fn>;
  };
}

describe('音频互斥播放', () => {
  it('放第二个时把第一个停掉', () => {
    const first = fakeAudio();
    const second = fakeAudio();

    playExclusive(first);
    expect(currentAudio()).toBe(first);

    playExclusive(second);
    expect(first.pause).toHaveBeenCalledOnce();
    expect(currentAudio()).toBe(second);
  });

  it('重复播同一个不会把自己暂停', () => {
    const only = fakeAudio();
    playExclusive(only);
    playExclusive(only);
    expect(only.pause).not.toHaveBeenCalled();
    expect(currentAudio()).toBe(only);
  });

  it('暂停后让出位置，下一个不会再点它', () => {
    const first = fakeAudio();
    const second = fakeAudio();

    playExclusive(first);
    releaseAudio(first);
    expect(currentAudio()).toBeNull();

    playExclusive(second);
    expect(first.pause).not.toHaveBeenCalled();
  });

  it('释放的不是当前那个时不动状态', () => {
    const first = fakeAudio();
    const second = fakeAudio();

    playExclusive(first);
    releaseAudio(second);
    expect(currentAudio()).toBe(first);
  });

  it('两个播放器交替点：每次只有最后一个在响', () => {
    const a = fakeAudio();
    const b = fakeAudio();

    playExclusive(a);
    a.play();
    playExclusive(b);
    b.play();
    // a 被 b 顶掉了
    expect(a.paused).toBe(true);
    expect(b.paused).toBe(false);

    playExclusive(a);
    a.play();
    expect(b.paused).toBe(true);
    expect(a.paused).toBe(false);
  });
});
