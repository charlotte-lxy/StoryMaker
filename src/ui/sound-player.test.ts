// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import type { AssetFileInfo } from '../core/host';
import { SoundPlayer } from './sound-player';

const file: AssetFileInfo = {
  filePath: 'C:\\素材\\S_dididi.wav',
  fileName: 'S_dididi.wav',
  baseName: 'S_dididi',
  kind: 'sound',
  size: 1024,
  mtimeMs: 1,
};

describe('SoundPlayer', () => {
  it('没有 AudioContext 的环境里播放 / 停止都不报错', async () => {
    const player = new SoundPlayer();
    expect(player.playing).toBe(0);

    await player.play(undefined, file, 1.5, 0.8);
    expect(player.playing).toBe(0);

    player.stopAll();
    expect(player.playing).toBe(0);
  });
});
