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
  ITEM_RESULT_PREFIX: string;
  buildAssetScript: (item: { id: string; assetPath: string; sourcePath: string }) => string;
  buildTableScript: (table: { label: string; assetPath: string; csvPath: string }) => string;
  readItemResult: (output: readonly string[]) => { ok: boolean; detail: string } | null;
}

const remote = require('../../electron/unreal-remote.cjs') as RemoteCore;
const importer = require('../../electron/unreal-import.cjs') as ImportCore;

/** 从生成的 Python 脚本里把 `item = json.loads("…")` 那段还原成对象 */
function embeddedItem(script: string): unknown {
  const match = /item = json\.loads\(("(?:[^"\\]|\\.)*")\)/.exec(script);
  expect(match).not.toBeNull();
  return JSON.parse(JSON.parse(match![1]) as string);
}

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

describe('单项导入脚本', () => {
  it('图片脚本里嵌的数据和传进去的一模一样（中文路径也不丢）', () => {
    const item = {
      id: 'SCE_Black',
      assetPath: '/Game/GameContent/Asset/Image/StoryBackground/SCE_Black',
      sourcePath: 'C:\\素材\\SCE_Black.png',
    };
    const script = importer.buildAssetScript(item);

    expect(embeddedItem(script)).toEqual(item);
    expect(script).toContain('素材');
  });

  it('图片脚本走资源导入管线，并按 ID 定资产名', () => {
    const script = importer.buildAssetScript({
      id: 'SCE_Black',
      assetPath: '/Game/GameContent/Asset/Image/Bg/SCE_Black',
      sourcePath: 'C:\\素材\\SCE_Black.png',
    });

    expect(script).toContain('AssetImportTask');
    expect(script).toContain('import_asset_tasks');
    expect(script).toContain('replace_existing');
    expect(script).toContain('destination_name');
    expect(script).toContain(importer.ITEM_RESULT_PREFIX);
  });

  it('数据表脚本走 CSV 灌入并保存', () => {
    const table = { label: 'TB_Sound', assetPath: '/Game/a/TB_Sound', csvPath: 'C:\\tmp\\01.csv' };
    const script = importer.buildTableScript(table);

    expect(embeddedItem(script)).toEqual(table);
    expect(script).toContain('fill_data_table_from_csv_file');
    expect(script).toContain('save_loaded_asset');
    expect(script).toContain(importer.ITEM_RESULT_PREFIX);
  });

  it('从输出里取结果行，没有或坏了都返回 null', () => {
    expect(
      importer.readItemResult(['LogPython: SMK_ITEM_RESULT {"ok": true, "detail": "已导入"}']),
    ).toEqual({ ok: true, detail: '已导入' });
    expect(importer.readItemResult(['只有日志'])).toBeNull();
    expect(importer.readItemResult(['SMK_ITEM_RESULT 这不是 JSON'])).toBeNull();
  });

  it('结果行缺 ok 字段时按失败处理', () => {
    expect(importer.readItemResult(['SMK_ITEM_RESULT {"detail":"怪怪的"}'])).toEqual({
      ok: false,
      detail: '怪怪的',
    });
  });
});
