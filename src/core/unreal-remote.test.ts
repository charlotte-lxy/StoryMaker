import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

interface RemoteCore {
  PROTOCOL_MAGIC: string;
  PROTOCOL_VERSION: number;
  decodeMessage: (text: string) => Record<string, unknown> | null;
  encodeMessage: (
    type: string,
    source: string,
    dest: string | null,
    data: Record<string, unknown> | null,
  ) => Buffer;
  readCommandOutput: (message: Record<string, unknown>) => {
    success: boolean;
    output: string[];
    result: string;
  };
  readNodeInfo: (message: Record<string, unknown>) => Record<string, string>;
}

interface ImportCore {
  DONE_MARKER: string;
  RESULT_PREFIX: string;
  buildImportScript: (payload: {
    tables: Array<{ label: string; assetPath: string; csvPath: string }>;
    images: Array<{ id: string; assetPath: string; sourcePath: string }>;
    sounds: Array<{ id: string; assetPath: string; sourcePath: string }>;
  }) => string;
  matchMaterialFiles: (
    files: Array<{ filePath: string; baseName: string }>,
    expected: Array<{ id: string; assetPath: string }>,
  ) => { matched: Map<string, string>; missing: string[]; unused: string[] };
  materialKindOfFile: (fileName: string) => 'image' | 'sound' | null;
}

const remote = require('../../electron/unreal-remote.cjs') as RemoteCore;
const importer = require('../../electron/unreal-import.cjs') as ImportCore;

describe('远程执行报文', () => {
  it('编码出来带版本、magic、来源，收件人和数据可选', () => {
    const plain = JSON.parse(remote.encodeMessage('ping', 'NODE1', null, null).toString('utf8'));
    expect(plain).toEqual({
      version: remote.PROTOCOL_VERSION,
      magic: remote.PROTOCOL_MAGIC,
      type: 'ping',
      source: 'NODE1',
    });

    const open = JSON.parse(
      remote.encodeMessage('open_connection', 'NODE1', 'UE1', { command_port: 6776 }).toString('utf8'),
    );
    expect(open.dest).toBe('UE1');
    expect(open.data).toEqual({ command_port: 6776 });
  });

  it('中文按 UTF-8 原样写出去，不被转义成一堆 \\u', () => {
    const encoded = remote.encodeMessage('command', 'NODE1', 'UE1', { command: '导入' }).toString('utf8');
    expect(encoded).toContain('导入');
  });

  it('解析时校验版本与 magic，不是自家协议的一律丢掉', () => {
    const good = remote.decodeMessage(
      JSON.stringify({ version: 1, magic: 'ue_py', type: 'pong', source: 'UE1' }),
    );
    expect(good).not.toBeNull();
    expect(good?.source).toBe('UE1');

    expect(remote.decodeMessage('不是 JSON')).toBeNull();
    expect(
      remote.decodeMessage(JSON.stringify({ version: 2, magic: 'ue_py', type: 'pong', source: 'UE1' })),
    ).toBeNull();
    expect(
      remote.decodeMessage(JSON.stringify({ version: 1, magic: '别的', type: 'pong', source: 'UE1' })),
    ).toBeNull();
    expect(
      remote.decodeMessage(JSON.stringify({ version: 1, magic: 'ue_py', type: 'pong' })),
    ).toBeNull();
  });

  it('pong 里缺字段就留空串，界面显示成未知而不是崩掉', () => {
    const info = remote.readNodeInfo({ source: 'UE1', data: { project_name: 'BulletShootGame' } });
    expect(info.id).toBe('UE1');
    expect(info.projectName).toBe('BulletShootGame');
    expect(info.engineVersion).toBe('');
    expect(info.projectRoot).toBe('');

    const noData = remote.readNodeInfo({ source: 'UE2' });
    expect(noData.projectName).toBe('');
  });

  it('command_result 的输出行按顺序摊平，success 缺省当失败', () => {
    const parsed = remote.readCommandOutput({
      data: {
        success: true,
        output: [{ type: 'Info', output: '第一行' }, { type: 'Info', output: '第二行' }],
      },
    });
    expect(parsed.success).toBe(true);
    expect(parsed.output).toEqual(['第一行', '第二行']);

    expect(remote.readCommandOutput({}).success).toBe(false);
    expect(remote.readCommandOutput({}).output).toEqual([]);
  });
});

describe('导入脚本', () => {
  const payload = {
    tables: [
      { label: 'TB_Dialogue', assetPath: '/Game/GameContent/BP/StorySystem/TB_Dialogue', csvPath: 'C:\\tmp\\01.csv' },
    ],
    images: [
      {
        id: 'SCE_Black',
        assetPath: '/Game/GameContent/Asset/Image/StoryBackground/SCE_Black',
        sourcePath: 'C:\\素材\\SCE_Black.png',
      },
    ],
    sounds: [
      {
        id: 'S_dididi',
        assetPath: '/Game/GameContent/Asset/Sound/BackgroundSound/S_dididi',
        sourcePath: 'C:\\素材\\S_dididi.wav',
      },
    ],
  };

  it('里面嵌的数据和传进去的一模一样（中文路径也不丢）', () => {
    const script = importer.buildImportScript(payload);
    const match = /DATA = json\.loads\(("(?:[^"\\]|\\.)*")\)/.exec(script);
    expect(match).not.toBeNull();
    // Python 的字符串字面量和 JSON 字符串兼容，转两次就回到对象
    const decoded = JSON.parse(JSON.parse(match![1]) as string);
    expect(decoded).toEqual(payload);
    expect(script).toContain('素材');
  });

  it('数据表走 CSV 灌入，图片音效走资源导入管线，最后打结果行', () => {
    const script = importer.buildImportScript(payload);
    expect(script).toContain('fill_data_table_from_csv_file');
    expect(script).toContain('AssetImportTask');
    expect(script).toContain('import_asset_tasks');
    expect(script).toContain('replace_existing');
    expect(script).toContain(importer.RESULT_PREFIX);
    expect(script).toContain(importer.DONE_MARKER);
  });
});

describe('素材匹配', () => {
  it('按文件名对 ID，大小写不同算没对上', () => {
    const files = [
      { filePath: 'C:\\素材\\SCE_Black.png', baseName: 'SCE_Black' },
      { filePath: 'C:\\素材\\sce_white.png', baseName: 'sce_white' },
      { filePath: 'C:\\素材\\没用到的.png', baseName: '没用到的' },
    ];
    const expected = [
      { id: 'SCE_Black', assetPath: '/Game/a/SCE_Black' },
      { id: 'SCE_White', assetPath: '/Game/a/SCE_White' },
    ];
    const result = importer.matchMaterialFiles(files, expected);
    expect([...result.matched.entries()]).toEqual([['SCE_Black', 'C:\\素材\\SCE_Black.png']]);
    expect(result.missing).toEqual(['SCE_White']);
    expect(result.unused).toEqual(['C:\\素材\\sce_white.png', 'C:\\素材\\没用到的.png']);
  });

  it('同一个 ID 有两个文件时先到的算数，另一个报成多余', () => {
    const files = [
      { filePath: 'a.png', baseName: 'X' },
      { filePath: 'b.png', baseName: 'X' },
    ];
    const result = importer.matchMaterialFiles(files, [{ id: 'X', assetPath: '/Game/X' }]);
    expect(result.matched.get('X')).toBe('a.png');
    expect(result.unused).toEqual(['b.png']);
  });

  it('按扩展名分图片和音效，不认识的不收', () => {
    expect(importer.materialKindOfFile('a.PNG')).toBe('image');
    expect(importer.materialKindOfFile('a.wav')).toBe('sound');
    expect(importer.materialKindOfFile('a.txt')).toBeNull();
    expect(importer.materialKindOfFile('没有扩展名')).toBeNull();
  });
});
