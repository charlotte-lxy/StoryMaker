/**
 * 閵嗗苯顕遍崗銉ュ煂 Unreal閵嗗秷顩︾€佃偐娈戞稉婊嗐偪閿涙矮绔存禒鐣屽嚱閺佺増宓侀惃鍕吀閸掓帇鈧? *
 * 鏉╂瑩鍣烽崣顏囩鐠愶絾濡告い鍦窗閺佸鎮婇幋鎰崲閸斺剝绔婚崡鏇椻偓鏂衡偓鏂挎憿娴?DataTable 鐎电懓绨查崫顏咁唽 CSV閵嗕礁鎽㈠鐘叉禈/閸濐亙閲滈棅铏櫏
 * 鐠囥儴鎯ら崚鏉挎憿娑擃亣绁┃鎰熅瀵板嫨鈧倻婀″锝囨畱缂冩垹绮堕柅姘繆閸滃苯鍟撻弬鍥︽閸︺劋瀵屾潻娑氣柤閿涘潒lectron/unreal-*.cjs閿涘绱?
 * 閻ｅ矂娼伴幏鍨煂鐠佲€冲灊閸氬簼姘︾紒娆忣問娑撶粯澧界悰灞烩偓鍌濈箹閺嶉攱婀板Ο鈥虫健閸忋劍妲哥痪顖氬毐閺佸府绱濋懗鐣屾纯閹恒儲绁撮妴? */

import { toCsv } from './csv';
import { buildAllSheets } from './export';
import { IMPORT_SETTINGS_SHEET, dataTableRef } from './export-settings';
import { buildImageRows } from './image-export';
import { buildSoundRows } from './sound-export';
import type { Project } from './types';

/** 娑撯偓瀵姾顩︾€电厧鍙嗛惃鍕殶閹诡喛銆?*/
export interface TableImportTask {
  /** 閻ｅ矂娼伴弰鍓с仛閻ㄥ嫬鎮曠€涙绱濈亸杈ㄦЦ閺佺増宓佺悰銊ユ倳 */
  label: string;
  /** Unreal 閸栧懓鐭惧鍕剁礉婵?/Game/GameContent/BP/StorySystem/TB_Dialogue */
  assetPath: string;
  /** CSV 閺傚洦婀伴敍鍫滅瑝鐢?BOM閿涘E 閻?CSV 鐟欙絾鐎界€?BOM 閺佸繑鍔呴敍?*/
  csvText: string;
}

/** 娑撯偓瀵姴娴?/ 娑撯偓閺夛繝鐓堕弫?*/
export interface AssetImportTask {
  /** 閸ュ墽澧?ID 閹存牠鐓堕弫?ID閿涙稐绡冮弰顖滅閺夋劖鏋冩禒璺烘倳閿涘牅绗夐崥顐ｅ⒖鐏炴洖鎮曢敍澶庮洣閸栧綊鍘ら惃鍕鐟?*/
  id: string;
  /** Unreal 閸栧懓鐭惧鍕剁礉婵?/Game/GameContent/Asset/Image/StoryBackground/SCE_Black */
  assetPath: string;
}

export interface UnrealImportPlan {
  tables: TableImportTask[];
  images: AssetImportTask[];
  sounds: AssetImportTask[];
}

/** UE 閼存碍婀伴崶鐐扮炊閻ㄥ嫪绔撮弶锛勭波閺?*/
export interface ImportItemResult {
  kind: 'table' | 'image' | 'sound';
  label: string;
  ok: boolean;
  detail: string;
}

const ASSET_REF_PATTERN = /^\/Script\/Engine\.\w+'(.+)'$/;

/** 缂佹挻鐏夌悰宀€娈戦崜宥囩磻閿涘苯鎷?electron/unreal-import.cjs 闁插瞼娈戠敮鎼佸櫤鐎靛綊缍?*/
const RESULT_PREFIX = 'SMK_IMPORT_RESULT ';

/**
 * 娴?UE 閻ㄥ嫭妫╄箛妤勭翻閸戞椽鍣烽幍鎯у毉闁絼绔寸悰宀€绮ㄩ弸?JSON閵? *
 * 鏉堟挸鍤柌灞姐仚閻偓 UE 閼奉亜绻侀惃鍕）韫囨绱欑€电厧鍙嗙粻锛勫殠娴兼碍澧︽稉鈧崼鍡礆閿涘本瀵滈崜宥囩磻閹告垵鍤弶銉ㄐ掗弸鎰剁幢
 * 濞屸剝婀佺亸杈ㄦЦ閼存碍婀板▽陇绐囬崚鐗堟付閸氬函绱濇潻鏂挎礀 null 鐠佲晞鐨熼悽銊︽煙閹稿鈧苯銇戠拹銉ｂ偓宥咁槱閻炲棎鈧? */
export function parseImportResult(output: readonly string[]): ImportItemResult[] | null {
  for (const line of output) {
    const index = line.indexOf(RESULT_PREFIX);
    if (index < 0) continue;
    try {
      const parsed: unknown = JSON.parse(line.slice(index + RESULT_PREFIX.length));
      if (!Array.isArray(parsed)) return null;
      return parsed.filter((item): item is ImportItemResult => {
        if (item === null || typeof item !== 'object') return false;
        const record = item as Record<string, unknown>;
        return (
          (record.kind === 'table' || record.kind === 'image' || record.kind === 'sound') &&
          typeof record.label === 'string' &&
          typeof record.ok === 'boolean' &&
          typeof record.detail === 'string'
        );
      });
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * 閹?`/Script/Engine.Texture2D'/Game/a/b.X.X'` 閹峰棙鍨氶崠鍛扮熅瀵?`/Game/a/b.X`閵? *
 * 鐎电厧鍤悰銊╁櫡閸愭瑧娈戦弰顖氱敨瀵洖褰块惃鍕暚閺佹潙绱╅悽顭掔礉鐎电厧鍙嗛弮鎯邦洣閻ㄥ嫭妲搁崠鍛扮熅瀵板嫨鈧? * 鐟欙絾鐎芥稉宥呭毉閺夈儴绻戦崶鐐碘敄娑撹绱濈拫鍐暏閺傝宓佸銈堢儲鏉╁浄绱欐稉宥堫嚉閹跺﹤鐣犺ぐ鎾村灇娑撯偓娑擃亜鎮庡▔鏇＄熅瀵板嫸绱氶妴? */
export function packagePathOf(assetRef: string): string {
  const text = assetRef.trim();
  const match = ASSET_REF_PATTERN.exec(text);
  if (match === null) return '';
  const inner = match[1];
  const dot = inner.lastIndexOf('.');
  return dot < 0 ? inner : inner.slice(0, dot);
}

/**
 * 娴犲簼绔村鐘差嚤閸戝搫鐡欑悰銊ф畱閵嗗矁绁┃鎰灙閵嗗秹鍣烽弨?id + 閸栧懓鐭惧鍕┾偓? *
 * @param rows 閺佹潙绱剁€涙劘銆冮敍鍫㈩儑娑撯偓鐞涘本妲哥悰銊ャ仈閿? * @param column 鐠у嫭绨崚妤冩畱娑撳鐖?
 */
function collectAssets(rows: string[][], column: number): AssetImportTask[] {
  const tasks: AssetImportTask[] = [];
  for (const row of rows.slice(1)) {
    const id = (row[0] ?? '').trim();
    const assetPath = packagePathOf(row[column] ?? '');
    if (id === '' || assetPath === '') continue;
    tasks.push({ id, assetPath });
  }
  return tasks;
}

/**
 * 閹跺﹪銆嶉惄顔芥殻閻炲棙鍨氭稉鈧禒钘夘嚤閸忋儴顓搁崚鎺嬧偓? *
 * 閺佺増宓佺悰銊や簰閵嗗nreal 鐎电厧鍙嗙拋鍓х枂閵嗗秹鍣烽柊宥囨畱闁絼绨虹悰灞艰礋閸戝棴绱板▽锟犲帳閻ㄥ嫯銆冩稉宥咁嚤閿涘牊鐦俊鍌滃⒖閸濅浇銆冪亸杈ㄧ梾闁板稄绱氶敍? * 閵嗗苯顕遍崗銉啎缂冾喓鈧秷鍤滃閬嶅亝瀵姴鐡欑悰銊ょ瘍娑撳秵妲?DataTable閿涘矁鐑︽潻鍥モ偓? */
export function buildUnrealImportPlan(project: Project): UnrealImportPlan {
  const sheets = new Map(buildAllSheets(project).map((sheet) => [sheet.name, sheet.rows]));

  const tables: TableImportTask[] = [];
  for (const row of project.exportSettings) {
    const tableName = row.tableName.trim();
    const subTable = row.subTable.trim();
    if (tableName === '' || subTable === '') continue;
    // 閵嗗苯顕遍崗銉啎缂冾喓鈧秴鐡欑悰銊︽Ц缂佹瑧鐡ラ崚鎺旀箙閻ㄥ嫰鍘ょ純顔裤€冮敍瀛禘 闁插本鐥呴張澶婎嚠鎼存梻娈?DataTable
    if (subTable === IMPORT_SETTINGS_SHEET) continue;
    const rows = sheets.get(subTable);
    if (rows === undefined) continue;
    tables.push({
      label: tableName,
      assetPath: packagePathOf(dataTableRef(row.folder, tableName)),
      csvText: toCsv(rows),
    });
  }

  return {
    tables,
    images: collectAssets(buildImageRows(project), 3),
    sounds: collectAssets(buildSoundRows(project), 1),
  };
}
