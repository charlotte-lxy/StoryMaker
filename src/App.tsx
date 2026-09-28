import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

import { exportWorkbook } from './core/export';
import type { IdChange } from './core/ids';
import { collectCommandTargets } from './core/command-build';
import { baseName, getHost, type HostApi } from './core/host';
import { normalizeProject, type NormalizeResult } from './core/migrate';
import type {
  Character,
  CommandDef,
  LangKey,
  Line,
  LineKind,
  LookupRow,
  Project,
  StoryOption,
  UiTextRow,
} from './core/types';
import {
  validateLocalization,
  validateProject,
  type Issue,
  type ValidationReport,
} from './core/validate';
import { validateBattle } from './core/battle-validate';
import type { BattlePage } from './state/battle-operations';
import {
  addChapter,
  addCharacter,
  addCommandDef,
  addGroup,
  addLookupRow,
  addOption,
  addUiText,
  collectGroupedLineRefs,
  createEmptyProject,
  insertLine,
  locateGroup,
  mutate,
  removeChapter,
  removeCharacter,
  removeCommandDef,
  removeGroup,
  removeLine,
  removeLookupRow,
  removeOption,
  removeUiText,
  renameChapter,
  renameCommand,
  renameGroup,
  renumberOneGroup,
  reorderLine,
  setGroupNote,
  updateCommandDef,
  updateLookupRow,
  updateTextByUid,
  updateUiText,
  type LookupKind,
} from './state/operations';
import {
  clampStorySplit,
  loadSettings,
  loadStorySplit,
  saveSettings,
  saveStorySplit,
  type Settings,
} from './state/prefs';
import { BattleEditor } from './ui/BattleEditor';
import { ChapterFlow } from './ui/ChapterFlow';
import { CharacterEditor } from './ui/CharacterEditor';
import { CommandEditor } from './ui/CommandEditor';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { ExportEditor } from './ui/ExportEditor';
import { IssuePanel } from './ui/IssuePanel';
import { LineList } from './ui/LineList';
import { LocalizationEditor } from './ui/LocalizationEditor';
import { LookupEditor } from './ui/LookupEditor';
import { ProjectGate } from './ui/ProjectGate';
import { SettingsEditor } from './ui/SettingsEditor';
import { ScriptPalette } from './ui/ScriptPalette';
import { Sidebar } from './ui/Sidebar';

/** 一个模块的校验结果，右上角的总数弹层与模块底部的校验条都用它 */
interface ModuleCheck {
  key: Module;
  label: string;
  report: ValidationReport;
}

/**
 * 界面所处的阶段：
 *   loading —— 正在按上次的文件路径读项目
 *   gate    —— 还没确定项目文件，先把编辑界面挡住
 *   ready   —— 项目文件已确定，可以编辑，改动直接写回它
 */
type Phase = 'loading' | 'gate' | 'ready';

type Module =
  | 'story'
  | 'character'
  | 'items'
  | 'quests'
  | 'images'
  | 'sounds'
  | 'command'
  | 'battle'
  | 'locale'
  | 'export'
  | 'settings';

/**
 * 解析项目文件内容。
 *
 * 记事本另存为会带上 BOM，而 JSON.parse 见到 BOM 会直接抛错；
 * 所以先剥掉它，再交给 normalizeProject 做老结构迁移。
 */
function parseProjectFile(text: string): NormalizeResult | null {
  try {
    return normalizeProject(JSON.parse(text.replace(/^\uFEFF/, '')));
  } catch {
    return null;
  }
}

/** 把二进制存成本地文件（浏览器下载）：导出对照表这类一次性产物用它 */
function saveBlob(filename: string, blob: Blob): void {  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export default function App() {
  /** 当前宿主：桌面版走 Electron，本地服务版走 bat 起的服务；都没有时为 undefined */
  const [host, setHost] = useState<HostApi | undefined>(undefined);
  const [phase, setPhase] = useState<Phase>('loading');
  const [project, setProject] = useState<Project>(createEmptyProject);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [module, setModule] = useState<Module>('story');
  const [activeGroupUid, setActiveGroupUid] = useState<string>('');
  /** 各模块底部的校验结果列表是否展开；平时收起，只在这条上显示条数 */
  const [panelOpen, setPanelOpen] = useState<Record<string, boolean>>({});
  /** 右上方「校验结果」的弹层是否打开 */
  const [summaryOpen, setSummaryOpen] = useState(false);
  /** 校验条里点过来的本地化行：滚过去高亮，过一会儿自动清掉 */
  const [focusLocaleUid, setFocusLocaleUid] = useState<string | null>(null);
  /** 校验条里点过来的战斗数据：切到哪个子页面、高亮哪一行 */
  const [focusBattle, setFocusBattle] = useState<{ page: BattlePage; uid: string } | null>(null);
  const [toast, setToast] = useState('');
  /** 门槛页上的提示：上次的文件打不开、没检测到本地服务 */
  const [gateNote, setGateNote] = useState('');
  /** 正在等系统文件对话框，期间把门槛页的按钮禁用 */
  const [picking, setPicking] = useState(false);
  const [idChanges, setIdChanges] = useState<IdChange[] | null>(null);
  const [flashLineUid, setFlashLineUid] = useState<string | null>(null);
  /** 从章节流程图点选项标签跳过来的选项，短暂高亮 */
  const [flashOptionUid, setFlashOptionUid] = useState<string | null>(null);
  /** 正在看流程图的章节；空串表示用第一章 */
  const [activeChapterUid, setActiveChapterUid] = useState('');
  /** 对话列表是否收起（只看整章流程图的时候收起） */
  const [listCollapsed, setListCollapsed] = useState(false);
  /** 流程图 / 对话列表的分栏比例，默认各一半 */
  const [splitRatio, setSplitRatio] = useState(loadStorySplit);
  const [splitDragging, setSplitDragging] = useState(false);
  /** 当前项目对应的磁盘文件；还没确定时为 null */
  const [projectPath, setProjectPath] = useState<string | null>(null);
  /** 待确认的危险操作 */
  const [confirmRequest, setConfirmRequest] = useState<{
    message: string;
    onConfirm: () => void;
  } | null>(null);

  /**
   * 统一的确认入口。
   *
   * 刻意不用 window.confirm —— 它在 Electron 下会同步阻塞渲染进程，
   * 弹框关掉之后页面上的输入框、下拉框全部失去响应。
   */
  const askConfirm = (message: string, onConfirm: () => void): void => {
    setConfirmRequest({ message, onConfirm });
  };
  /** 分栏容器：拖分隔线时按它的宽度算比例 */
  const splitBoxRef = useRef<HTMLDivElement | null>(null);

  /**
   * 启动：认出宿主 → 按上次记住的路径读项目文件 → 读不回来（或压根没有）就停在门槛页。
   *
   * 本机不再缓存项目内容，所以「读不回来」时没有兜底数据可用，
   * 只能让用户重新新建或打开一个项目文件。
   */
  useEffect(() => {
    let canceled = false;

    void (async () => {
      const api = getHost();
      if (api === undefined) {
        if (canceled) return;
        setGateNote(
          '没检测到本地服务。请不要直接双击 index.html，' +
            '改成双击同一个文件夹里的「启动StoryMaker.bat」，它会打开正确的地址。',
        );
        setPhase('gate');
        return;
      }
      setHost(api);

      const last = await api.lastProjectPath().catch(() => null);
      if (last !== null) {
        try {
          const content = await api.readProject(last);
          const parsed = content === null ? null : parseProjectFile(content);
          if (parsed !== null) {
            if (canceled) return;
            setProject(parsed.project);
            setProjectPath(last);
            setActiveGroupUid('');
            setActiveChapterUid('');
            if (parsed.changes.length > 0) {
              setIdChanges(parsed.changes);
              setToast(
                `已打开上次的项目「${baseName(last)}」，并按新结构迁移：指令、选项各自成行，` +
                  `${parsed.changes.length} 个对话 ID 有变化（见对照表）`,
              );
            } else {
              setToast(`已打开上次的项目「${baseName(last)}」`);
            }
            setPhase('ready');
            return;
          }
        } catch {
          // 被占用、内容损坏等：一律当成"打不开"，走下面的重新选择
        }
        await api.rememberProjectPath(null).catch(() => undefined);
        if (canceled) return;
        setGateNote(`上次的项目「${baseName(last)}」没能打开，请重新新建或打开一个项目文件。`);
      }

      if (!canceled) setPhase('gate');
    })();

    return () => {
      canceled = true;
    };
  }, []);

  // 自动保存：确定项目文件后，改动直接写回那个 .json（防抖 800ms）
  useEffect(() => {
    if (!settings.autoSave || phase !== 'ready' || host === undefined || projectPath === null) return;
    const api = host;
    const target = projectPath;
    const timer = window.setTimeout(() => {
      void api
        .writeProject(target, JSON.stringify(project, null, 2))
        .catch(() => setToast('自动保存失败，请手动点「保存」'));
    }, 800);
    return () => window.clearTimeout(timer);
  }, [project, projectPath, settings.autoSave, phase, host]);

  // 主题：写到 <html data-theme>，配色全部由 CSS 变量接管
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    if (toast === '') return;
    const timer = window.setTimeout(() => setToast(''), 5200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const groupedLines = useMemo(() => collectGroupedLineRefs(project), [project]);

  /** 当前正在看流程图的章节 */
  const chapterUid = activeChapterUid === '' ? (project.chapters[0]?.uid ?? '') : activeChapterUid;
  const activeChapter = project.chapters.find((item) => item.uid === chapterUid);

  /**
   * 跳转目标下拉只列本章的段落：选项只能跳到同一章里，
   * 否则章节流程图里根本连不出这条线。
   */
  const chapterGroups = useMemo(
    () =>
      activeChapter === undefined
        ? []
        : collectGroupedLineRefs({ ...project, chapters: [activeChapter] }),
    [project, activeChapter],
  );

  /** 指令下拉的目标候选：把各数据表整理成 { id, label } */
  const commandTargets = useMemo(
    () =>
      collectCommandTargets(
        project,
        groupedLines.flatMap((group) =>
          group.lines.map((line) => ({
            id: line.uid,
            label: `${line.readableId}${line.preview === '' ? '' : ` — ${line.preview}`}`,
          })),
        ),
      ),
    [project, groupedLines],
  );

  const firstGroupUid = activeChapter?.groups[0]?.uid ?? '';
  const activeUid = activeGroupUid === '' ? firstGroupUid : activeGroupUid;
  const location = locateGroup(project, activeUid);
  const group = location?.group;
  const listOpen = !listCollapsed;

  const updateLine = (lineUid: string, patch: Partial<Line>): void => {
    setProject((prev) =>
      mutate(prev, (draft) => {
        const line = locateGroup(draft, activeUid)?.group.lines.find((l) => l.uid === lineUid);
        if (line !== undefined) Object.assign(line, patch);
      }),
    );
  };

  const updateOption = (optionUid: string, patch: Partial<StoryOption>): void => {
    setProject((prev) =>
      mutate(prev, (draft) => {
        const option = locateGroup(draft, activeUid)?.group.options.find((o) => o.uid === optionUid);
        if (option !== undefined) Object.assign(option, patch);
      }),
    );
  };

  const updateCharacter = (characterUid: string, patch: Partial<Character>): void => {
    setProject((prev) =>
      mutate(prev, (draft) => {
        const character = draft.characters.find((c) => c.uid === characterUid);
        if (character !== undefined) Object.assign(character, patch);
      }),
    );
  };

  const handleUpdateText = (uid: string, lang: LangKey, value: string): void => {
    setProject((prev) => updateTextByUid(prev, uid, lang, value));
  };

  const handleUpdateUiText = (uid: string, patch: Partial<UiTextRow>): void => {
    setProject((prev) => updateUiText(prev, uid, patch));
  };

  const handleRenameCommand = (from: string, to: string): void => {
    setProject((prev) => renameCommand(prev, from, to));
    setToast(`已把「${from}」改为「${to}」，所有使用处一起更新`);
  };

  const handleLookup = {
    add: (kind: LookupKind) => setProject((prev) => addLookupRow(prev, kind)),
    remove: (kind: LookupKind, uid: string) =>
      setProject((prev) => removeLookupRow(prev, kind, uid)),
    update: (kind: LookupKind, uid: string, patch: Partial<LookupRow>) =>
      setProject((prev) => updateLookupRow(prev, kind, uid, patch)),
  };

  /** 拖拽排序后立刻重排该段落的 ID，让编号始终连续 */
  const handleReorderLine = (from: number, to: number): void => {
    setProject((prev) => renumberOneGroup(reorderLine(prev, activeUid, from, to), activeUid));
  };

  /** 脚本块拖进列表后插入一行；新行的编号由重排统一给出 */
  const handleInsertLine = (index: number, kind: LineKind): void => {
    setProject((prev) => renumberOneGroup(insertLine(prev, activeUid, index, kind), activeUid));
  };

  /** 单击脚本块：直接加到当前段落的最后一行 */
  const handlePickBlock = (kind: LineKind): void => {
    handleInsertLine(group?.lines.length ?? 0, kind);
  };

  /** 打开某个段落的对话列表（会自动切到它所在的章节并把列表展开） */
  const openGroup = (groupUid: string): void => {
    for (const chapter of project.chapters) {
      if (chapter.groups.some((item) => item.uid === groupUid)) {
        setActiveChapterUid(chapter.uid);
        break;
      }
    }
    setActiveGroupUid(groupUid);
    setListCollapsed(false);
  };

  /** 点侧边栏的章节：看这一章的流程图；列表里的段落不属于本章就切到本章第一段 */
  const handleOpenChapter = (targetChapterUid: string): void => {
    setActiveChapterUid(targetChapterUid);
    const chapter = project.chapters.find((item) => item.uid === targetChapterUid);
    const inChapter = chapter?.groups.some((item) => item.uid === activeUid) ?? false;
    if (!inChapter) setActiveGroupUid(chapter?.groups[0]?.uid ?? '');
    setListCollapsed(false);
  };

  /** 点流程图上的选项标签：跳到那个选项 */
  const handleJumpToOption = (optionUid: string): void => {
    for (const chapter of project.chapters) {
      for (const item of chapter.groups) {
        const owner = item.lines.find((line) => line.optionIds.includes(optionUid));
        if (owner === undefined) continue;
        setModule('story');
        openGroup(item.uid);
        setFlashOptionUid(optionUid);
        return;
      }
    }
  };

  /** 校验条里点某一条：切到出问题的地方并高亮 */
  const handleJumpToIssue = (issue: Issue): void => {
    // 战斗数据的问题：切到战斗模块的对应子页面，滚到并高亮那一行
    if (issue.battlePage !== undefined && issue.battleUid !== undefined) {
      setModule('battle');
      setFocusBattle({ page: issue.battlePage as BattlePage, uid: issue.battleUid });
      return;
    }
    // 本地化的问题（缺译文、UI key 为空或重名）：切到本地化模块，滚到并高亮那一行
    if (issue.localeUid !== undefined && issue.localeUid !== '') {
      setModule('locale');
      setFocusLocaleUid(issue.localeUid);
      return;
    }
    if (issue.lineUid !== '') {
      handleJumpToLine(issue.lineUid);
      return;
    }
    if (issue.groupUid !== '') {
      setModule('story');
      openGroup(issue.groupUid);
    }
  };

  /** 跳到某个对话行：切到它所在的段落，并短暂高亮 */
  const handleJumpToLine = (lineUid: string): void => {
    for (const chapter of project.chapters) {
      for (const item of chapter.groups) {
        if (item.lines.some((line) => line.uid === lineUid)) {
          setModule('story');
          openGroup(item.uid);
          setFlashLineUid(lineUid);
          return;
        }
      }
    }
  };

  useEffect(() => {
    if (flashLineUid === null) return;
    const timer = window.setTimeout(() => setFlashLineUid(null), 1800);
    return () => window.clearTimeout(timer);
  }, [flashLineUid]);

  useEffect(() => {
    if (flashOptionUid === null) return;
    const timer = window.setTimeout(() => setFlashOptionUid(null), 1800);
    return () => window.clearTimeout(timer);
  }, [flashOptionUid]);

  useEffect(() => {
    if (focusLocaleUid === null) return;
    const timer = window.setTimeout(() => setFocusLocaleUid(null), 1800);
    return () => window.clearTimeout(timer);
  }, [focusLocaleUid]);

  useEffect(() => {
    if (focusBattle === null) return;
    const timer = window.setTimeout(() => setFocusBattle(null), 1800);
    return () => window.clearTimeout(timer);
  }, [focusBattle]);

  // 拖动分隔线时不要每动一下都写盘，松手后再记住宽度
  useEffect(() => {
    if (splitDragging) return;
    saveStorySplit(splitRatio);
  }, [splitRatio, splitDragging]);

  /** 拖动中间那条分隔线，改变流程图与对话列表的宽度比例 */
  const startSplitDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setSplitDragging(true);

    const move = (moveEvent: PointerEvent): void => {
      const box = splitBoxRef.current?.getBoundingClientRect();
      if (box === undefined || box.width === 0) return;
      setSplitRatio(clampStorySplit((moveEvent.clientX - box.left) / box.width));
    };
    const end = (): void => {
      setSplitDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
  };

  const handleRemoveGroup = (groupUid: string, title: string): void => {
    const target = locateGroup(project, groupUid);
    const lineCount = target?.group.lines.length ?? 0;
    const optionCount = target?.group.options.length ?? 0;
    askConfirm(
      `确定删除段落「${title}」吗？\n\n` +
        `将一并删除其中的 ${lineCount} 行内容、${optionCount} 个选项，删除后无法撤销。`,
      () => setProject((prev) => removeGroup(prev, groupUid)),
    );
  };

  const handleRemoveChapter = (chapterUid: string, title: string): void => {
    const chapter = project.chapters.find((c) => c.uid === chapterUid);
    const groupCount = chapter?.groups.length ?? 0;
    let lineCount = 0;
    for (const item of chapter?.groups ?? []) lineCount += item.lines.length;
    askConfirm(
      `确定删除章节「${title}」吗？\n\n` +
        `将一并删除其中的 ${groupCount} 个段落、${lineCount} 行内容，删除后无法撤销。`,
      () => setProject((prev) => removeChapter(prev, chapterUid)),
    );
  };

  const handleRemoveCharacter = (characterUid: string): void => {
    const character = project.characters.find((c) => c.uid === characterUid);
    if (character === undefined) return;
    askConfirm(
      `确定删除角色「${character.name || character.id}」吗？\n\n` +
        `已经写好、引用了该角色的对话不会变动，但它将不再出现在下拉框里。`,
      () => setProject((prev) => removeCharacter(prev, characterUid)),
    );
  };

  /** 把一个项目文件接管到界面上：新建、打开、启动自动加载都走这里 */
  const adoptProject = (next: Project, target: string): void => {
    setProject(next);
    setProjectPath(target);
    setActiveGroupUid('');
    setActiveChapterUid('');
    setGateNote('');
    setPhase('ready');
  };

  /** 新建：先让用户选一个 .json 存到哪儿，再把空项目写进去 */
  const handleCreate = async (): Promise<void> => {
    if (host === undefined) return;
    setPicking(true);
    const target = await host.pickNewProjectPath(project.name).catch(() => null);
    setPicking(false);
    if (target === null) return;

    const fresh = createEmptyProject();
    try {
      await host.writeProject(target, JSON.stringify(fresh, null, 2));
    } catch {
      setToast('这个位置写不进去，请换一个文件夹再试');
      return;
    }
    await host.rememberProjectPath(target).catch(() => undefined);
    adoptProject(fresh, target);
    setToast(`已新建项目文件 ${baseName(target)}，之后的改动都会直接存进它`);
  };

  /** 打开已有的项目 JSON */
  const handleOpen = async (): Promise<void> => {
    if (host === undefined) return;
    setPicking(true);
    const picked = await host.pickProject().catch(() => null);
    setPicking(false);
    if (picked === null) return;

    try {
      const parsed = parseProjectFile(picked.content);
      if (parsed === null) {
        setToast('这个文件不是 StoryMaker 项目文件');
        return;
      }
      await host.rememberProjectPath(picked.filePath).catch(() => undefined);
      adoptProject(parsed.project, picked.filePath);
      const name = baseName(picked.filePath);
      if (parsed.changes.length > 0) {
        setIdChanges(parsed.changes);
        setToast(
          `已打开「${name}」，并按新结构迁移：指令、选项各自成行，` +
            `${parsed.changes.length} 个对话 ID 有变化（见对照表）`,
        );
      } else {
        setToast(`已打开「${name}」`);
      }
    } catch {
      setToast('打开失败，请确认文件还在、并且没被别的程序占用');
    }
  };

  const handleExport = async (): Promise<void> => {
    // 校验是自动跑的，这里只用它的结果给提示，不弹确认框
    const buffer = await exportWorkbook(project);
    const filename = `${project.name}.xlsx`;
    const suffix =
      checkErrors > 0
        ? `，但有 ${checkErrors} 处必须修复的问题建议先处理（见下方校验结果）`
        : '，含剧情、GAS 与导入设置的全部子表';

    if (host === undefined) return;
    const filePath = await host.exportFile(filename, buffer);
    if (filePath === null) return;
    setToast(`已导出到 ${filePath}${suffix}`);
    void host.revealFile(filePath);
  };

  /** 保存：直接写回当前项目文件 */
  const handleSave = async (): Promise<void> => {
    if (host === undefined || projectPath === null) return;
    try {
      await host.writeProject(projectPath, JSON.stringify(project, null, 2));
      setToast(`已保存到 ${projectPath}`);
    } catch {
      setToast('保存失败，请确认这个文件还在、并且没被别的程序占用');
    }
  };

  /** 另存为：换一个项目文件，之后的改动都写进新文件 */
  const handleSaveAs = async (): Promise<void> => {
    if (host === undefined) return;
    setPicking(true);
    const target = await host.pickNewProjectPath(project.name).catch(() => null);
    setPicking(false);
    if (target === null) return;

    try {
      await host.writeProject(target, JSON.stringify(project, null, 2));
    } catch {
      setToast('这个位置写不进去，请换一个文件夹再试');
      return;
    }
    await host.rememberProjectPath(target).catch(() => undefined);
    setProjectPath(target);
    setToast(`已另存为 ${target}`);
  };

  /**
   * 各模块的校验结果。
   *
   * 都在改动后自动重算（和项目状态一起 useMemo），所以右上角的总数与模块
   * 底部的条数永远是最新的，不需要手动点「校验」。
   */
  const checks = useMemo<ModuleCheck[]>(
    () => [
      { key: 'story', label: '剧情', report: validateProject(project) },
      { key: 'battle', label: '战斗', report: validateBattle(project) },
      { key: 'locale', label: '本地化', report: validateLocalization(project) },
    ],
    [project],
  );

  const checkTotal = checks.reduce((sum, item) => sum + item.report.issues.length, 0);
  const checkErrors = checks.reduce((sum, item) => sum + item.report.errors, 0);
  /** 徽标配色：有必须修复的用红，只有建议用黄，都没有用绿 */
  const checkLevel = checkErrors > 0 ? 'error' : checkTotal > 0 ? 'warn' : 'ok';
  /** 当前模块自己的那份校验结果；没有校验的模块不显示底部那条 */
  const activeCheck = checks.find((item) => item.key === module);

  const togglePanel = (key: Module): void =>
    setPanelOpen((prev) => ({ ...prev, [key]: !(prev[key] ?? false) }));

  // 项目文件还没确定：先把编辑界面挡在门槛后面
  if (phase !== 'ready') {
    return (
      <ProjectGate
        loading={phase === 'loading'}
        note={gateNote}
        busy={picking}
        onCreate={() => void handleCreate()}
        onOpen={() => void handleOpen()}
      >
        {toast !== '' && <div className="toast">{toast}</div>}
      </ProjectGate>
    );
  }

  return (
    <div className="app">
      <header className="toolbar">
        <span className="brand">
          <span className="brand-mark">SM</span>
          StoryMaker
        </span>

        <input
          className="project-name"
          value={project.name}
          title="项目名称，也是导出文件名"
          onChange={(event) =>
            setProject((prev) => mutate(prev, (draft) => void (draft.name = event.target.value)))
          }
        />

        <div className="toolbar-group">
          <button
            type="button"
            onClick={() =>
              askConfirm(
                '新建会换一个项目文件，当前项目里还没保存的改动会丢失。确定吗？',
                () => void handleCreate(),
              )
            }
          >
            新建
          </button>
          <button type="button" onClick={() => void handleOpen()}>
            打开项目
          </button>
          <button type="button" onClick={() => void handleSave()}>
            保存
          </button>
          <button type="button" onClick={() => void handleSaveAs()}>
            另存为
          </button>
        </div>

        <span className="file-chip" title={projectPath ?? '还没有项目文件'}>
          {projectPath === null ? '未指定项目文件' : baseName(projectPath)}
        </span>

        <span className="spacer" />

        <div className="check-summary">
          <button
            type="button"
            className={`check-badge ${checkLevel}`}
            title="各模块的校验结果总数，点开看明细"
            onClick={() => setSummaryOpen((current) => !current)}
          >
            校验结果 {checkTotal}
          </button>

          {summaryOpen && (
            <>
              <div className="check-mask" onClick={() => setSummaryOpen(false)} />
              <div className="check-pop">
                <table className="check-table">
                  <thead>
                    <tr>
                      <th>模块</th>
                      <th>建议</th>
                      <th>错误</th>
                    </tr>
                  </thead>
                  <tbody>
                    {checks.map((item) => (
                      <tr
                        key={item.key}
                        className="check-row"
                        title={`跳到「${item.label}」模块`}
                        onClick={() => {
                          setModule(item.key);
                          setSummaryOpen(false);
                        }}
                      >
                        <td>{item.label}</td>
                        <td className={item.report.warnings > 0 ? 'warn-text' : ''}>
                          {item.report.warnings}
                        </td>
                        <td className={item.report.errors > 0 ? 'error-text' : ''}>
                          {item.report.errors}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="check-pop-hint">点一行跳到对应模块</div>
              </div>
            </>
          )}
        </div>
      </header>

      <div className="body">
        <nav className="rail">
          <button
            type="button"
            className={`rail-item${module === 'story' ? ' active' : ''}`}
            onClick={() => setModule('story')}
          >
            <span className="rail-icon">✎</span>
            <span>剧情</span>
          </button>
          <button
            type="button"
            className={`rail-item${module === 'character' ? ' active' : ''}`}
            onClick={() => setModule('character')}
          >
            <span className="rail-icon">☺</span>
            <span>角色</span>
          </button>
          <button
            type="button"
            className={`rail-item${module === 'sounds' ? ' active' : ''}`}
            onClick={() => setModule('sounds')}
          >
            <span className="rail-icon">♪</span>
            <span>音效</span>
          </button>
          <button
            type="button"
            className={`rail-item${module === 'items' ? ' active' : ''}`}
            onClick={() => setModule('items')}
          >
            <span className="rail-icon">◆</span>
            <span>物品</span>
          </button>
          <button
            type="button"
            className={`rail-item${module === 'quests' ? ' active' : ''}`}
            onClick={() => setModule('quests')}
          >
            <span className="rail-icon">✓</span>
            <span>任务</span>
          </button>
          <button
            type="button"
            className={`rail-item${module === 'images' ? ' active' : ''}`}
            onClick={() => setModule('images')}
          >
            <span className="rail-icon">▣</span>
            <span>立绘</span>
          </button>
          <button
            type="button"
            className={`rail-item${module === 'command' ? ' active' : ''}`}
            onClick={() => setModule('command')}
          >
            <span className="rail-icon">⌘</span>
            <span>条件与指令</span>
          </button>
          <button
            type="button"
            className={`rail-item${module === 'battle' ? ' active' : ''}`}
            onClick={() => setModule('battle')}
          >
            <span className="rail-icon">⚔</span>
            <span>战斗</span>
          </button>
          <button
            type="button"
            className={`rail-item${module === 'locale' ? ' active' : ''}`}
            onClick={() => setModule('locale')}
          >
            <span className="rail-icon">文</span>
            <span>本地化</span>
          </button>

          {/*
            置底的一组：靠 rail-item-bottom 的 margin-top:auto 顶到最下面，
            组内从上往下排（导出在设置上面）。以后再加置底按钮，加在这两个前面。
          */}
          <button
            type="button"
            className={`rail-item rail-item-bottom${module === 'export' ? ' active' : ''}`}
            onClick={() => setModule('export')}
          >
            <span className="rail-icon">⤓</span>
            <span>导出</span>
          </button>
          <button
            type="button"
            className={`rail-item${module === 'settings' ? ' active' : ''}`}
            title="设置"
            onClick={() => setModule('settings')}
          >
            <span className="rail-icon">⚙</span>
            <span>设置</span>
          </button>
        </nav>

        {/*
          模块界面 = 侧边栏 + 内容区，底下的校验条横跨这一整片（但不盖到最左侧模块栏）。
          校验条放在这一层：它属于整个模块，而不是某一块内容。
        */}
        <div className="workspace">
          <div className="workspace-row">
            {module === 'story' && (
              <Sidebar
                project={project}
                activeChapterUid={chapterUid}
                activeGroupUid={activeUid}
                onSelectChapter={handleOpenChapter}
                onSelectGroup={openGroup}
                onRenameChapter={(chapterUid, title) =>
                  setProject((prev) => renameChapter(prev, chapterUid, title))
                }
                onRenameGroup={(groupUid, title) =>
                  setProject((prev) => renameGroup(prev, groupUid, title))
                }
                onAddChapter={() => setProject((prev) => addChapter(prev))}
                onAddGroup={(targetChapterUid) =>
                  setProject((prev) => addGroup(prev, targetChapterUid))
                }
                onRemoveChapter={handleRemoveChapter}
                onRemoveGroup={handleRemoveGroup}
              />
            )}

            <main className="main">
              {module === 'character' && (
                <CharacterEditor
                  project={project}
                  onAdd={() => setProject((prev) => addCharacter(prev))}
                  onRemove={handleRemoveCharacter}
                  onUpdate={updateCharacter}
                />
              )}

              {module === 'battle' && (
                <BattleEditor
                  project={project}
                  onChange={setProject}
                  focusPage={focusBattle?.page ?? null}
                  focusUid={focusBattle?.uid ?? null}
                />
              )}

              {module === 'locale' && (
                <LocalizationEditor
                  project={project}
                  focusUid={focusLocaleUid}
                  onUpdateText={handleUpdateText}
                  onAddUiText={(key, text) => setProject((prev) => addUiText(prev, key, text))}
                  onRemoveUiText={(uid) => setProject((prev) => removeUiText(prev, uid))}
                  onUpdateUiText={handleUpdateUiText}
                />
              )}

              {(module === 'items' ||
                module === 'quests' ||
                module === 'images' ||
                module === 'sounds') && (
                <LookupEditor
                  project={project}
                  kind={module}
                  onAdd={handleLookup.add}
                  onRemove={handleLookup.remove}
                  onUpdate={handleLookup.update}
                />
              )}

              {module === 'command' && (
                <CommandEditor
                  project={project}
                  onRenameCommand={handleRenameCommand}
                  onJumpToLine={handleJumpToLine}
                  onAddDef={(category) => setProject((prev) => addCommandDef(prev, category))}
                  onRemoveDef={(uid) => setProject((prev) => removeCommandDef(prev, uid))}
                  onUpdateDef={(uid, patch: Partial<CommandDef>) =>
                    setProject((prev) => updateCommandDef(prev, uid, patch))
                  }
                />
              )}

              {module === 'export' && (
                <ExportEditor
                  project={project}
                  onChange={setProject}
                  onExport={() => void handleExport()}
                />
              )}

              {module === 'settings' && (
                <SettingsEditor
                  settings={settings}
                  onChange={(patch) => setSettings((prev) => ({ ...prev, ...patch }))}
                />
              )}

              {module === 'story' && (
                <>
                  <div className="story-split" ref={splitBoxRef}>
                    <div
                      className="flow-pane"
                      style={listOpen ? { flexBasis: `${splitRatio * 100}%` } : { flex: '1 1 auto' }}
                    >
                      <ChapterFlow
                        project={project}
                        chapterUid={chapterUid}
                        activeGroupUid={activeUid}
                        listOpen={listOpen}
                        onOpenGroup={openGroup}
                        onJumpToOption={handleJumpToOption}
                        onToggleList={() => setListCollapsed((current) => !current)}
                        onRenameGroup={(groupUid, title) =>
                          setProject((prev) => renameGroup(prev, groupUid, title))
                        }
                        onSetGroupNote={(groupUid, note) =>
                          setProject((prev) => setGroupNote(prev, groupUid, note))
                        }
                      />
                    </div>

                    {listOpen && (
                      <>
                        <div
                          className={`split-handle${splitDragging ? ' dragging' : ''}`}
                          title="按住左右拖动，调整流程图与对话列表的宽度"
                          onPointerDown={startSplitDrag}
                        />

                        <div className="list-pane">
                          <div className="editor">
                            {group === undefined ? (
                              <div className="empty-state">
                                这一章还没有段落，点章节名旁边的「＋」新增段落。
                              </div>
                            ) : (
                              <>
                                <div className="editor-head">
                                  <h2>
                                    {location?.chapter.title} / {group.title}
                                  </h2>
                                  <span className="hint">
                                    段落 {group.id} · {group.lines.length} 行 ·{' '}
                                    {group.options.length} 个选项
                                  </span>
                                </div>

                                <LineList
                                  group={group}
                                  groupedLines={chapterGroups}
                                  characters={project.characters}
                                  commandDefs={project.commands}
                                  commandTargets={commandTargets}
                                  flashLineUid={flashLineUid}
                                  flashOptionUid={flashOptionUid}
                                  onUpdateLine={updateLine}
                                  onUpdateOption={updateOption}
                                  onInsertLine={handleInsertLine}
                                  onRemoveLine={(lineUid) =>
                                    setProject((prev) => removeLine(prev, activeUid, lineUid))
                                  }
                                  onReorderLine={handleReorderLine}
                                  onJumpToLine={handleJumpToLine}
                                  onAddOption={(lineUid) =>
                                    setProject((prev) => addOption(prev, activeUid, lineUid))
                                  }
                                  onRemoveOption={(optionUid) =>
                                    setProject((prev) => removeOption(prev, activeUid, optionUid))
                                  }
                                />
                              </>
                            )}
                          </div>

                          {/* 脚本块固定在对话列表最下方，横向排布 */}
                          <ScriptPalette onPick={handlePickBlock} />
                        </div>
                      </>
                    )}
                  </div>
                </>
              )}
            </main>
          </div>

          {/* 校验条：贴在模块界面最下方，横跨侧边栏与内容区 */}
          {activeCheck !== undefined && (
            <IssuePanel
              label={activeCheck.label}
              report={activeCheck.report}
              expanded={panelOpen[activeCheck.key] ?? false}
              onToggle={() => togglePanel(activeCheck.key)}
              onJumpToIssue={handleJumpToIssue}
            />
          )}
        </div>
      </div>

      {toast !== '' && <div className="toast">{toast}</div>}

      {confirmRequest !== null && (
        <ConfirmDialog
          message={confirmRequest.message}
          onCancel={() => setConfirmRequest(null)}
          onConfirm={() => {
            const action = confirmRequest.onConfirm;
            setConfirmRequest(null);
            action();
          }}
        />
      )}

      {idChanges !== null && (
        <div className="modal-mask" onClick={() => setIdChanges(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <header>ID 重排对照表</header>
            <div className="modal-body">
              {idChanges.length === 0 ? (
                <p>所有 ID 已经是连续的，无需改动。</p>
              ) : (
                <>
                  <p className="modal-note">
                    共 {idChanges.length} 项发生变化。请把下表交给本地化同事，同步本地化表的 key。
                  </p>
                  <table className="lines">
                    <thead>
                      <tr>
                        <th>原 ID</th>
                        <th>新 ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {idChanges.map((change) => (
                        <tr key={change.uid}>
                          <td className="cell-id">{change.oldId}</td>
                          <td className="cell-id">{change.newId}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
            <footer>
              <button
                type="button"
                onClick={() => {
                  const body = idChanges
                    .map((change) => `${change.oldId},${change.newId}`)
                    .join('\r\n');
                  saveBlob(
                    'ID重排对照表.csv',
                    new Blob([`\uFEFF原ID,新ID\r\n${body}\r\n`], { type: 'text/csv;charset=utf-8' }),
                  );
                }}
              >
                导出对照表
              </button>
              <button type="button" className="primary" onClick={() => setIdChanges(null)}>
                关闭
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
