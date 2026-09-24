import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

import { exportWorkbook } from './core/export';
import type { IdChange } from './core/ids';
import { collectCommandTargets } from './core/command-build';
import { baseName, desktop, isDesktop } from './core/desktop';
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
} from './core/types';
import { validateProject, type Issue, type ValidationReport } from './core/validate';
import {
  addChapter,
  addCharacter,
  addCommandDef,
  addGroup,
  addLookupRow,
  addOption,
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
  renameChapter,
  renameCommand,
  renameGroup,
  renumberOneGroup,
  renumberProject,
  reorderLine,
  setGroupNote,
  updateCommandDef,
  updateLookupRow,
  updateTextByUid,
  type LookupKind,
} from './state/operations';
import {
  clampStorySplit,
  loadSessionPath,
  loadSettings,
  loadStorySplit,
  saveSessionPath,
  saveSettings,
  saveStorySplit,
  type Settings,
} from './state/prefs';
import { ChapterFlow } from './ui/ChapterFlow';
import { CharacterEditor } from './ui/CharacterEditor';
import { CommandEditor } from './ui/CommandEditor';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { IssuePanel } from './ui/IssuePanel';
import { LineList } from './ui/LineList';
import { LocalizationEditor } from './ui/LocalizationEditor';
import { LookupEditor } from './ui/LookupEditor';
import { SettingsEditor } from './ui/SettingsEditor';
import { ScriptPalette } from './ui/ScriptPalette';
import { Sidebar } from './ui/Sidebar';

const STORAGE_KEY = 'storymaker.project.v1';
const EMPTY_REPORT: ValidationReport = { issues: [], errors: 0, warnings: 0 };

type Module =
  | 'story'
  | 'character'
  | 'items'
  | 'quests'
  | 'images'
  | 'sounds'
  | 'command'
  | 'locale'
  | 'settings';

/** 把项目写进本机缓存：浏览器模式下它就是存档，桌面模式下是读不到文件时的兜底 */
function writeDraft(project: Project): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
  } catch {
    // 存储写满时不要让界面崩掉
  }
}

/** 启动时读回本机草稿；老结构会在这里自动迁移成新结构 */
function loadInitialProject(): NormalizeResult {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw !== null) {
      const result = normalizeProject(JSON.parse(raw));
      if (result !== null) return result;
    }
  } catch {
    // 本地数据损坏时退回空项目，不让界面白屏
  }
  return { project: createEmptyProject(), changes: [] };
}

function saveBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export default function App() {
  /** 初始项目：本机草稿（必要时自动迁移）+ 迁移造成的 ID 变化 */
  const [initial] = useState(loadInitialProject);
  const [project, setProject] = useState<Project>(initial.project);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [module, setModule] = useState<Module>('story');
  const [activeGroupUid, setActiveGroupUid] = useState<string>('');
  const [report, setReport] = useState<ValidationReport>(EMPTY_REPORT);
  const [hasChecked, setHasChecked] = useState(false);
  const [toast, setToast] = useState(
    initial.changes.length === 0
      ? ''
      : `项目已按新结构自动迁移：指令、选项各自成行，${initial.changes.length} 个对话 ID 有变化（见对照表）`,
  );
  const [idChanges, setIdChanges] = useState<IdChange[] | null>(
    initial.changes.length === 0 ? null : initial.changes,
  );
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
  /** 桌面模式下当前项目对应的磁盘文件；浏览器模式下始终为 null */
  const [projectPath, setProjectPath] = useState<string | null>(loadSessionPath);
  /** 桌面模式：启动时正在把上次的项目文件读回来，读完之前不写盘，免得用缓存盖掉文件 */
  const [restoring, setRestoring] = useState(
    () => isDesktop && desktop !== undefined && loadSessionPath() !== null,
  );
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** 分栏容器：拖分隔线时按它的宽度算比例 */
  const splitBoxRef = useRef<HTMLDivElement | null>(null);

  // 自动保存：开关打开时，改动立刻写进本机缓存（浏览器模式下它就是存档）
  useEffect(() => {
    if (!settings.autoSave) return;
    writeDraft(project);
  }, [project, settings.autoSave]);

  // 桌面模式：一旦关联了项目文件，改动后自动写盘（防抖 800ms）
  useEffect(() => {
    if (!settings.autoSave || restoring) return;
    if (!isDesktop || desktop === undefined || projectPath === null) return;
    // 收窄后存进局部变量，闭包里才不会被判成可能 undefined
    const api = desktop;
    const target = projectPath;
    const timer = window.setTimeout(() => {
      void api
        .saveProject({
          content: JSON.stringify(project, null, 2),
          suggestedName: project.name,
          currentPath: target,
        })
        .catch(() => setToast('自动保存失败，请手动点「保存」'));
    }, 800);
    return () => window.clearTimeout(timer);
  }, [project, projectPath, settings.autoSave, restoring]);

  // 记住这次打开的项目文件，下次启动直接读回来
  useEffect(() => {
    saveSessionPath(projectPath);
  }, [projectPath]);

  /**
   * 桌面模式启动时，把上次的项目文件读回界面。
   *
   * 刻意不把 projectPath 放进依赖：读回失败会把它置成 null，
   * 依赖变化会让 effect 重跑，而新一轮会因为 restoring 已改而提前返回，
   * 结果是 restoring 关不掉、自动保存跟着一起失效。
   */
  useEffect(() => {
    if (!restoring || desktop === undefined || projectPath === null) return;
    const api = desktop;
    const target = projectPath;
    let canceled = false;

    void (async () => {
      try {
        const result = await api.readProject(target);
        const parsed = result.canceled
          ? null
          : normalizeProject(JSON.parse(result.content ?? ''));
        if (canceled) return;

        if (parsed === null) {
          setProjectPath(null);
          setToast(`上次的项目「${baseName(target)}」没能自动打开，请重新打开或另存为`);
          return;
        }

        setProject(parsed.project);
        setActiveGroupUid('');
        if (parsed.changes.length > 0) {
          setIdChanges(parsed.changes);
          setToast(
            `已自动打开「${baseName(target)}」，并按新结构迁移：指令、选项各自成行，` +
              `${parsed.changes.length} 个对话 ID 有变化`,
          );
        } else {
          setToast(`已自动打开上次的项目「${baseName(target)}」`);
        }
      } catch {
        if (canceled) return;
        setProjectPath(null);
        setToast(`上次的项目「${baseName(target)}」没能自动打开，请重新打开或另存为`);
      } finally {
        // StrictMode 下第一次会被取消，不能提前放行写盘
        if (!canceled) setRestoring(false);
      }
    })();

    return () => {
      canceled = true;
    };
  }, [restoring]);

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

  /** 校验面板里点某一条问题：切到出问题的那一行并高亮 */
  const handleJumpToIssue = (issue: Issue): void => {
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

  const handleExport = async (): Promise<void> => {
    // 导出前静默跑一次校验，不弹确认框，但结果会提示出来
    const check = validateProject(project);
    setReport(check);
    setHasChecked(true);

    const buffer = await exportWorkbook(project);
    const filename = `${project.name}.xlsx`;
    const suffix =
      check.errors > 0
        ? `，但有 ${check.errors} 处错误建议先修复（见下方校验结果）`
        : '，含对话 / 选项 / 本地化三张工作表';

    if (isDesktop && desktop !== undefined) {
      const result = await desktop.saveFileAs({ suggestedName: filename, data: buffer });
      if (result.canceled) return;
      setToast(`已导出到 ${result.filePath ?? filename}${suffix}`);
      if (result.filePath !== undefined) void desktop.revealFile(result.filePath);
      return;
    }

    saveBlob(
      filename,
      new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
    );
    setToast(`已导出「${filename}」${suffix}`);
  };

  /** 保存到当前项目文件（桌面模式）或下载一份 JSON（浏览器模式） */
  const handleSave = async (): Promise<void> => {
    const content = JSON.stringify(project, null, 2);

    if (isDesktop && desktop !== undefined) {
      const result = await desktop.saveProject({
        content,
        suggestedName: project.name,
        currentPath: projectPath,
      });
      if (result.canceled) return;
      setProjectPath(result.filePath ?? null);
      // 手动保存也算「已保存状态」，下次启动能自动加载回来
      writeDraft(project);
      setToast(`已保存${result.filePath === undefined ? '' : `到 ${result.filePath}`}`);
      return;
    }

    writeDraft(project);
    saveBlob(`${project.name}.json`, new Blob([content], { type: 'application/json' }));
  };

  /** 另存为一份新的项目 JSON */
  const handleSaveAs = async (): Promise<void> => {
    const content = JSON.stringify(project, null, 2);

    if (isDesktop && desktop !== undefined) {
      const result = await desktop.saveProject({
        content,
        suggestedName: project.name,
        currentPath: null,
      });
      if (result.canceled) return;
      setProjectPath(result.filePath ?? null);
      writeDraft(project);
      setToast(`已另存为 ${result.filePath ?? ''}`);
      return;
    }

    writeDraft(project);
    saveBlob(`${project.name}.json`, new Blob([content], { type: 'application/json' }));
  };

  /** 打开项目：桌面模式走系统文件对话框，浏览器模式走 <input type="file"> */
  const handleOpen = async (): Promise<void> => {
    if (!isDesktop || desktop === undefined) {
      fileInputRef.current?.click();
      return;
    }

    const result = await desktop.openProject();
    if (result.canceled || result.content === undefined) return;

    try {
      const parsed = normalizeProject(JSON.parse(result.content));
      if (parsed === null) {
        setToast('这个文件不是 StoryMaker 项目文件');
        return;
      }
      const name = baseName(result.filePath ?? '');
      setProject(parsed.project);
      setProjectPath(result.filePath ?? null);
      setActiveGroupUid('');
      setHasChecked(false);
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
      setToast('文件解析失败，可能不是合法的 JSON');
    }
  };

  const handleImportJson = (file: File): void => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = normalizeProject(JSON.parse(String(reader.result)));
        if (parsed === null) {
          setToast('这个文件不是 StoryMaker 项目文件');
          return;
        }
        setProject(parsed.project);
        setActiveGroupUid('');
        setHasChecked(false);
        if (parsed.changes.length > 0) {
          setIdChanges(parsed.changes);
          setToast(
            `已导入「${parsed.project.name}」，并按新结构迁移：指令、选项各自成行，` +
              `${parsed.changes.length} 个对话 ID 有变化（见对照表）`,
          );
        } else {
          setToast(`已导入「${parsed.project.name}」`);
        }
      } catch {
        setToast('文件解析失败，可能不是合法的 JSON');
      }
    };
    reader.readAsText(file);
  };

  const handleRenumber = (): void => {
    const result = renumberProject(project);
    setProject(result.project);
    setIdChanges(result.changes);
  };

  const checkCounts = useMemo(() => validateProject(project), [project]);

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
              askConfirm('新建会清空当前项目，确定吗？还没保存的改动会丢失。', () => {
                setProject(createEmptyProject());
                setProjectPath(null);
                setActiveGroupUid('');
                setHasChecked(false);
              })
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

        {isDesktop && (
          <span className="file-chip" title={projectPath ?? '尚未保存到文件'}>
            {projectPath === null ? '未保存' : baseName(projectPath)}
          </span>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file !== undefined) handleImportJson(file);
            event.target.value = '';
          }}
        />

        <span className="spacer" />

        {checkCounts.errors > 0 && <span className="badge error">待修复 {checkCounts.errors}</span>}
        {checkCounts.errors === 0 && checkCounts.warnings > 0 && (
          <span className="badge warn">{checkCounts.warnings} 条建议</span>
        )}

        <div className="toolbar-group">
          <button type="button" onClick={handleRenumber}>
            重排对话 ID
          </button>
          <button type="button" className="primary" onClick={() => void handleExport()}>
            导出 Excel
          </button>
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
            className={`rail-item${module === 'locale' ? ' active' : ''}`}
            onClick={() => setModule('locale')}
          >
            <span className="rail-icon">文</span>
            <span>本地化</span>
          </button>
          <button
            type="button"
            className={`rail-item rail-item-bottom${module === 'settings' ? ' active' : ''}`}
            title="设置"
            onClick={() => setModule('settings')}
          >
            <span className="rail-icon">⚙</span>
            <span>设置</span>
          </button>
        </nav>

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

          {module === 'locale' && (
            <LocalizationEditor project={project} onUpdateText={handleUpdateText} />
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

              <IssuePanel
                report={report}
                hasChecked={hasChecked}
                onCheck={() => {
                  setReport(validateProject(project));
                  setHasChecked(true);
                }}
                onJumpToIssue={handleJumpToIssue}
              />
            </>
          )}
        </main>
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
