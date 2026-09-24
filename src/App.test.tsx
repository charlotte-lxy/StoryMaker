// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from './App';

beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
  // jsdom 没有实现 scrollIntoView，跳转测试里会用到
  Element.prototype.scrollIntoView = () => undefined;
  // jsdom 也没有 DragEvent / PointerEvent。用 MouseEvent 顶上，testing-library 才会把
  // clientY / clientX 一起塞进事件里——插入位置和分栏比例都是按指针坐标算的。
  (window as unknown as { DragEvent: typeof MouseEvent }).DragEvent = window.MouseEvent;
  (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = window.MouseEvent;
});

afterEach(() => {
  cleanup();
  // 主题写在 <html> 上，不清掉会串到下一个用例
  delete document.documentElement.dataset.theme;
});

/** 左侧模块导航 */
const rail = () => screen.getByRole('navigation');

/** 假 dataTransfer：jsdom 里没有真实拖拽 */
function blockTransfer(kind: '对话' | '选项' | '指令') {
  return {
    types: ['application/x-storymaker-block'],
    getData: () => kind,
    setData: () => undefined,
    effectAllowed: 'copy',
    dropEffect: 'copy',
  };
}

/**
 * 派发一次拖放事件。
 *
 * jsdom 没有 DragEvent（见 beforeEach 里补的替身），走 testing-library 的封装，
 * 它会额外把 dataTransfer 挂到事件上。
 */
function fireDrag(
  type: 'dragover' | 'drop',
  target: HTMLElement,
  dataTransfer: unknown,
  clientY = 0,
): void {
  const init = { dataTransfer, clientY };
  if (type === 'dragover') fireEvent.dragOver(target, init);
  else fireEvent.drop(target, init);
}

/** 从脚本块区拖一个块到列表里（默认丢在末尾的追加区） */
function dropBlock(kind: '对话' | '选项' | '指令', target?: HTMLElement): void {
  const dataTransfer = blockTransfer(kind);
  const zone = target ?? screen.getByTitle('拖到这里追加到末尾');
  fireDrag('dragover', zone, dataTransfer);
  fireDrag('drop', zone, dataTransfer);
}

/** 单击脚本块（按标题找，避免和行里的类型标签撞名） */
function clickBlock(kind: '对话' | '选项' | '指令'): void {
  fireEvent.click(screen.getByTitle(`拖到列表里插入「${kind}」，或单击直接加到最后一行`));
}

/** 行内拖动排序用的 dataTransfer：不带脚本块标记 */
function rowTransfer() {
  return {
    types: [],
    getData: () => '',
    setData: () => undefined,
    effectAllowed: 'move',
    dropEffect: 'move',
  };
}

/** 给行卡片造出堆叠的真实几何：第 i 行占 [i*100, i*100+100] */
function stubCardRects(container: HTMLElement): void {
  const cards = [...container.querySelectorAll('.line-card')] as HTMLElement[];
  cards.forEach((card, index) => {
    card.getBoundingClientRect = () =>
      ({
        top: index * 100,
        bottom: index * 100 + 100,
        height: 100,
        left: 0,
        right: 800,
        width: 800,
        x: 0,
        y: index * 100,
        toJSON: () => ({}),
      }) as DOMRect;
  });
}

describe('界面冒烟测试', () => {
  it('渲染主界面与三个模块入口', () => {
    render(<App />);
    expect(screen.getByText(/StoryMaker/)).toBeTruthy();
    expect(within(rail()).getByText('剧情')).toBeTruthy();
    expect(within(rail()).getByText('角色')).toBeTruthy();
    expect(within(rail()).getByText('本地化')).toBeTruthy();
  });

  it('空项目能渲染出默认的第一行对话', () => {
    const { container } = render(<App />);
    // 列表里不再显示完整对话 ID，只在条目左侧标段内序号
    expect(container.querySelectorAll('.line-card')).toHaveLength(1);
    expect(container.querySelector('.line-seq')?.textContent).toBe('1');
    expect(container.querySelector('.line-seq')?.getAttribute('title')).toBe(
      '对话 ID：Dia_ch01_001-1',
    );
  });

  it('新增选项后，跳转目标默认是「对话结束」（即导出留空）', () => {
    render(<App />);
    // 选项列表现在挂在「选项」行上，行里默认就带一个选项
    dropBlock('选项');
    const groupSelect = screen.getByTitle('第一级：目标段落') as HTMLSelectElement;
    expect(groupSelect.value).toBe('');
    expect(screen.getByText('（对话结束）')).toBeTruthy();
    // 第二级在对话结束时禁用
    expect((screen.getByTitle('第二级：该段落内的对话（序号 - 台词）') as HTMLSelectElement).disabled).toBe(
      true,
    );
  });

  it('跳转目标可以选到具体段落与对话，再切回对话结束', () => {
    render(<App />);
    dropBlock('选项');

    const groupSelect = screen.getByTitle('第一级：目标段落') as HTMLSelectElement;
    fireEvent.change(groupSelect, { target: { value: groupSelect.options[1].value } });

    const lineSelect = screen.getByTitle('第二级：该段落内的对话（序号 - 台词）') as HTMLSelectElement;
    expect(lineSelect.disabled).toBe(false);
    expect(lineSelect.value).not.toBe('');

    fireEvent.change(groupSelect, { target: { value: '' } });
    expect(
      (screen.getByTitle('第二级：该段落内的对话（序号 - 台词）') as HTMLSelectElement).disabled,
    ).toBe(true);
  });

  it('能切换到角色模块', () => {
    render(<App />);
    fireEvent.click(within(rail()).getByText('角色'));
    expect(screen.getByText(/还没有角色/)).toBeTruthy();
  });

  it('新增角色后出现默认的 ID 与名称', () => {
    render(<App />);
    fireEvent.click(within(rail()).getByText('角色'));
    fireEvent.click(screen.getByText(/新增角色/));
    expect(screen.getByDisplayValue('CHA_角色1')).toBeTruthy();
    expect(screen.getByDisplayValue('角色1')).toBeTruthy();
  });

  it('能切换到本地化模块，并列出默认那行的文本 key', () => {
    render(<App />);
    fireEvent.click(within(rail()).getByText('本地化'));
    expect(screen.getAllByText('TXT_Dia_ch01_001-1').length).toBeGreaterThan(0);
  });

  it('新增章节会出现在侧边栏', () => {
    render(<App />);
    fireEvent.click(screen.getByText('＋ 章节'));
    expect(screen.getByText('第 2 章')).toBeTruthy();
  });

  it('删除章节走应用内确认框，不再用 window.confirm', () => {
    // window.confirm 在 Electron 下会阻塞渲染进程、让输入控件失去响应，已全部替换
    const confirmSpy = vi.spyOn(window, 'confirm');
    render(<App />);
    fireEvent.click(screen.getAllByTitle('删除本章')[0]);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(screen.getByText('请确认')).toBeTruthy();
  });

  it('删除章节时取消，则章节保留', () => {
    render(<App />);
    fireEvent.click(screen.getAllByTitle('删除本章')[0]);
    fireEvent.click(screen.getByText('取消'));
    expect(screen.queryByText('请确认')).toBeNull();
    expect(screen.getByText('序章')).toBeTruthy();
  });

  it('确认后章节被删除', () => {
    render(<App />);
    fireEvent.click(screen.getByText('＋ 章节'));
    fireEvent.click(screen.getAllByTitle('删除本章')[1]);
    fireEvent.click(screen.getByText('确定'));
    expect(screen.queryByText('第 2 章')).toBeNull();
  });

  it('删除段落时，确认文案会说明将丢失多少行', () => {
    render(<App />);
    fireEvent.click(screen.getAllByTitle('删除本段落')[0]);
    expect(screen.getByText(/1 行内容/)).toBeTruthy();
  });

  it('确认框关掉之后，输入框和下拉框依然可用', () => {
    render(<App />);
    fireEvent.click(screen.getAllByTitle('删除本章')[0]);
    fireEvent.click(screen.getByText('取消'));

    // 关掉确认框后随便改一个输入框，确认界面没被"冻住"
    const nameInput = screen.getByTitle('项目名称，也是导出文件名') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: '还能改' } });
    expect(nameInput.value).toBe('还能改');
  });
});

describe('设置、自动保存与自动加载', () => {
  /** 项目名称输入框：改它就是"编辑了一下项目" */
  const nameInput = () => screen.getByTitle('项目名称，也是导出文件名');

  it('左侧栏左下角有设置入口，点进去是设置页', () => {
    render(<App />);
    fireEvent.click(within(rail()).getByText('设置'));
    expect(screen.getByText('自动保存')).toBeTruthy();
    expect(screen.getByText('深色')).toBeTruthy();
  });

  it('自动保存默认开启：编辑后自动写进本地缓存', () => {
    render(<App />);
    fireEvent.change(nameInput(), { target: { value: '序章改名' } });
    const cached = window.localStorage.getItem('storymaker.project.v1') ?? '';
    expect(cached).toContain('序章改名');
  });

  it('关掉自动保存后，编辑不再写本地缓存', () => {
    render(<App />);
    fireEvent.click(within(rail()).getByText('设置'));
    fireEvent.click(screen.getByRole('checkbox')); // 关掉自动保存
    expect(screen.getByText(/不会自动保存/)).toBeTruthy();

    fireEvent.change(nameInput(), { target: { value: '不该被自动保存' } });
    expect(window.localStorage.getItem('storymaker.project.v1') ?? '').not.toContain(
      '不该被自动保存',
    );
  });

  it('切到深色会写到 <html data-theme>，并把设置记下来', () => {
    render(<App />);
    fireEvent.click(within(rail()).getByText('设置'));
    fireEvent.click(screen.getByText('深色'));

    expect(document.documentElement.dataset.theme).toBe('dark');
    const saved = JSON.parse(window.localStorage.getItem('storymaker.settings.v1') ?? '{}') as {
      theme?: string;
    };
    expect(saved.theme).toBe('dark');
  });

  it('启动时按上次的设置恢复深色主题', () => {
    window.localStorage.setItem(
      'storymaker.settings.v1',
      JSON.stringify({ autoSave: true, theme: 'dark' }),
    );
    render(<App />);
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('启动时自动加载上次打开的项目', () => {
    window.localStorage.setItem(
      'storymaker.project.v1',
      JSON.stringify({ version: 1, name: '上次的项目', chapters: [] }),
    );
    render(<App />);
    expect(screen.getByDisplayValue('上次的项目')).toBeTruthy();
  });
});

describe('脚本块与三种类型的行', () => {
  /** 列表里每一行的类型标签与对话 ID */
  const rows = (container: HTMLElement) => ({
    kinds: [...container.querySelectorAll('.line-card .type-tag')].map((el) => el.textContent),
    seqs: [...container.querySelectorAll('.line-card .line-seq')].map((el) => el.textContent),
  });

  it('拖入「选项」行：默认带一个选项，ID 接着上一行连续编号', () => {
    const { container } = render(<App />);
    dropBlock('选项');

    expect(rows(container)).toEqual({ kinds: ['对话', '选项'], seqs: ['1', '2'] });
    // 选项 ID 是所属行 ID 加字母后缀
    expect(screen.getByText('Dia_ch01_001-2A')).toBeTruthy();
    expect(screen.getByTitle('第一级：目标段落')).toBeTruthy();
  });

  it('把块拖到某一行上，就插在那一行之后', () => {
    const { container } = render(<App />);
    dropBlock('指令', container.querySelector('[data-line-uid]') as HTMLElement);
    expect(rows(container).kinds).toEqual(['对话', '指令']);
  });

  it('「指令」行只放一条指令，预览与下拉都是横向的', () => {
    render(<App />);
    dropBlock('指令');

    expect(screen.getByPlaceholderText('点这里手写指令，或用右侧下拉选择')).toBeTruthy();
    expect(screen.getByTitle('选择指令')).toBeTruthy();
    // 一行只有一条指令，没有"再加一条"的按钮
    expect(screen.queryByText('＋ 新增指令')).toBeNull();
  });

  it('行可以删除', () => {
    render(<App />);
    dropBlock('指令');
    expect(screen.getAllByText('删除')).toHaveLength(2);

    fireEvent.click(screen.getAllByText('删除')[1]);
    expect(screen.getAllByText('删除')).toHaveLength(1);
  });

  it('备注：点开能写，写过的条目标出来，悬浮时显示内容', () => {
    render(<App />);
    fireEvent.click(screen.getByText('备注'));

    const input = screen.getByPlaceholderText('例如：这句要等 BGM 淡出后再进');
    fireEvent.change(input, { target: { value: '等 BGM 淡出再进' } });

    const button = screen.getByText('备注');
    expect(button.className).toContain('has-note');
    expect(button.getAttribute('data-note')).toBe('等 BGM 淡出再进');
  });

  it('单击脚本块直接加到最后一行', () => {
    const { container } = render(<App />);
    clickBlock('选项');
    expect(rows(container)).toEqual({
      kinds: ['对话', '选项'],
      seqs: ['1', '2'],
    });
  });

  it('「选项」行的字段顺序：选项文本 → 跳转目标 → 出现条件 → 可用条件 → 结果', () => {
    const { container } = render(<App />);
    dropBlock('选项');

    const labels = [...container.querySelectorAll('.option-item .field > span')].map(
      (el) => el.textContent,
    );
    expect(labels).toEqual(['选项文本（中文）', '跳转目标', '出现条件', '可用条件', '结果（指令）']);
  });

  it('拖到两行之间的分界线上也能插入（不必躲开那条线）', () => {
    const { container } = render(<App />);
    clickBlock('指令');
    expect(rows(container).kinds).toEqual(['对话', '指令']);

    stubCardRects(container);

    const list = container.querySelector('.line-list') as HTMLElement;
    const dataTransfer = blockTransfer('对话');
    // clientY = 100 正好是那条横线所在的位置
    fireDrag('dragover', list, dataTransfer, 100);
    fireDrag('drop', list, dataTransfer, 100);

    expect(rows(container).kinds).toEqual(['对话', '对话', '指令']);
  });

  it('整行空白处都能按住拖动排序', () => {
    const { container } = render(<App />);
    clickBlock('指令');
    stubCardRects(container);

    const list = container.querySelector('.line-list') as HTMLElement;
    const cards = [...container.querySelectorAll('.line-card')] as HTMLElement[];

    // 从第二行的空白处起拖（没有先点进任何输入框）
    fireEvent.dragStart(cards[1], { dataTransfer: rowTransfer() });
    expect(cards[1].className).toContain('dragging');

    // 丢到最上面
    fireDrag('dragover', list, rowTransfer(), 0);
    fireDrag('drop', list, rowTransfer(), 0);
    expect(rows(container).kinds).toEqual(['指令', '对话']);
  });

  it('在输入框里起拖是选文字，不会把整行搬走', () => {
    const { container } = render(<App />);
    clickBlock('指令');
    const card = container.querySelector('.line-card') as HTMLElement;
    const textarea = card.querySelector('textarea') as HTMLTextAreaElement;

    fireEvent.mouseDown(textarea);
    fireEvent.dragStart(card, { dataTransfer: rowTransfer() });

    expect(card.className).not.toContain('dragging');
  });

  it('正在编辑的行会整块换色', () => {
    const { container } = render(<App />);
    const card = container.querySelector('.line-card') as HTMLElement;
    const textarea = card.querySelector('textarea') as HTMLTextAreaElement;

    fireEvent.focusIn(textarea);
    expect(card.className).toContain('editing');

    fireEvent.focusOut(textarea);
    expect(card.className).not.toContain('editing');
  });

  it('指令预览框宽度固定，切模块回来后下拉框仍然显示选好的项', () => {
    render(<App />);

    // 先加个角色，下拉里才有目标可选
    fireEvent.click(within(rail()).getByText('角色'));
    fireEvent.click(screen.getByText(/新增角色/));
    fireEvent.click(within(rail()).getByText('剧情'));

    dropBlock('指令');
    const defSelect = screen.getByTitle('选择指令') as HTMLSelectElement;
    const picked = defSelect.options[1].value;
    fireEvent.change(defSelect, { target: { value: picked } });

    const targetSelect = screen.getByTitle('目标对象') as HTMLSelectElement;
    expect(targetSelect.value).toBe('CHA_角色1');

    // 切走再回来：下拉框要按预览框里的指令重新解析出来
    fireEvent.click(within(rail()).getByText('角色'));
    fireEvent.click(within(rail()).getByText('剧情'));

    expect((screen.getByTitle('选择指令') as HTMLSelectElement).value).toBe(picked);
    expect((screen.getByTitle('目标对象') as HTMLSelectElement).value).toBe('CHA_角色1');
  });
});

describe('章节流程图与分栏', () => {
  /** 两个段落，段落 001 的选项跳到段落 002 */
  function seedJumpProject(): void {
    window.localStorage.setItem(
      'storymaker.project.v1',
      JSON.stringify({
        version: 1,
        name: '流程测试',
        characters: [],
        items: [],
        quests: [],
        images: [],
        sounds: [],
        commands: [],
        variables: [],
        chapters: [
          {
            uid: 'c1',
            id: 'ch01',
            title: '序章',
            groups: [
              {
                uid: 'g1',
                id: '001',
                title: '开场',
                lines: [
                  {
                    uid: 'l1',
                    readableId: 'Dia_ch01_001-1',
                    kind: '选项',
                    characterId: '',
                    displayName: '',
                    text: { zh: '', en: '', ja: '' },
                    autoAdvance: false,
                    command: '',
                    optionIds: ['o1'],
                    note: '',
                  },
                ],
                options: [
                  {
                    uid: 'o1',
                    readableId: 'Dia_ch01_001-1A',
                    text: { zh: '去码头', en: '', ja: '' },
                    nextId: 'l2',
                    appearConditions: [],
                    enableConditions: [],
                    results: [],
                  },
                ],
              },
              {
                uid: 'g2',
                id: '002',
                title: '码头',
                lines: [
                  {
                    uid: 'l2',
                    readableId: 'Dia_ch01_002-1',
                    kind: '对话',
                    characterId: '',
                    displayName: '',
                    text: { zh: '海风很大', en: '', ja: '' },
                    autoAdvance: false,
                    command: '',
                    optionIds: [],
                    note: '',
                  },
                ],
                options: [],
              },
            ],
          },
        ],
      }),
    );
  }

  it('每个段落一个块，选项跳转连成一条带标签的线', () => {
    seedJumpProject();
    const { container } = render(<App />);

    const blocks = [...container.querySelectorAll('.flow-block-title')].map((el) => el.textContent);
    expect(blocks).toEqual(['开场', '码头']);
    expect(container.querySelectorAll('.flow-line')).toHaveLength(1);
    // 线中间那个标签就是选项文本（选项编辑器里也有同样的文字，所以按类名取）
    expect(container.querySelector('.flow-edge-label')?.textContent).toBe('去码头');
  });

  it('点流程图上的选项标签跳到那个选项', () => {
    seedJumpProject();
    const { container } = render(<App />);

    // 先切到段落 002，让列表停在别处
    fireEvent.click(screen.getByTitle('打开「码头」的对话列表'));
    expect(container.querySelector('.line-card')?.getAttribute('data-line-uid')).toBe('l2');

    fireEvent.click(screen.getByTitle(/去码头/));
    expect(container.querySelector('.line-card')?.getAttribute('data-line-uid')).toBe('l1');
    expect(container.querySelector('.option-item.flash')).toBeTruthy();
  });

  it('拖中间的分隔线改变左右宽度', () => {
    seedJumpProject();
    const { container } = render(<App />);

    const split = container.querySelector('.story-split') as HTMLElement;
    split.getBoundingClientRect = () =>
      ({ left: 0, width: 1000, top: 0, height: 600, right: 1000, bottom: 600, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

    const handle = container.querySelector('.split-handle') as HTMLElement;
    fireEvent.pointerDown(handle, { clientX: 500 });
    fireEvent.pointerMove(window, { clientX: 300 });
    fireEvent.pointerUp(window);

    expect((container.querySelector('.flow-pane') as HTMLElement).style.flexBasis).toBe('30%');
  });

  it('可以收起对话列表，点段落块再展开', () => {
    seedJumpProject();
    const { container } = render(<App />);
    expect(container.querySelector('.list-pane')).not.toBeNull();

    fireEvent.click(screen.getByText('收起对话列表 ▶'));
    expect(container.querySelector('.list-pane')).toBeNull();
    expect(container.querySelector('.split-handle')).toBeNull();

    fireEvent.click(screen.getByTitle('打开「码头」的对话列表'));
    expect(container.querySelector('.list-pane')).not.toBeNull();
  });

  it('点 ✎ 能改章节名和段落名（侧边栏）', () => {
    seedJumpProject();
    const { container } = render(<App />);
    const sidebar = within(container.querySelector('.sidebar') as HTMLElement);

    fireEvent.click(screen.getByTitle('重命名章节「序章」'));
    const chapterInput = container.querySelector('.tree-chapter .rename-input') as HTMLInputElement;
    fireEvent.change(chapterInput, { target: { value: '序章改名' } });
    fireEvent.keyDown(chapterInput, { key: 'Enter' });

    expect(container.querySelector('.tree-chapter .chapter-title')?.textContent).toBe('序章改名');
    // 流程图标题跟着一起变
    expect(screen.getByText('序章改名 · 段落流程')).toBeTruthy();

    fireEvent.click(sidebar.getByTitle('重命名段落「开场」'));
    const groupInput = container.querySelector('.tree-group .rename-input') as HTMLInputElement;
    fireEvent.change(groupInput, { target: { value: '开场改名' } });
    fireEvent.keyDown(groupInput, { key: 'Enter' });

    expect(container.querySelector('.tree-group .group-title')?.textContent).toBe('开场改名');
    expect(container.querySelector('.flow-block-title')?.textContent).toBe('开场改名');
  });

  it('流程图块里也能改名、写段落注释', () => {
    seedJumpProject();
    const { container } = render(<App />);
    const block = container.querySelectorAll('.flow-block')[0] as HTMLElement;
    const inBlock = within(block);

    // 改名：回车生效，侧边栏同步
    fireEvent.click(inBlock.getByTitle('重命名段落「开场」'));
    const nameInput = container.querySelector('.flow-block .rename-input') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: '开场（图上改的）' } });
    fireEvent.keyDown(nameInput, { key: 'Enter' });
    expect(container.querySelector('.flow-block-title')?.textContent).toBe('开场（图上改的）');
    expect(container.querySelector('.tree-group .group-title')?.textContent).toBe('开场（图上改的）');

    // 写注释：失焦保存，块上直接显示出来
    fireEvent.click(inBlock.getByTitle('加段落注释'));
    const noteInput = container.querySelector('.flow-block-note-input') as HTMLTextAreaElement;
    fireEvent.change(noteInput, { target: { value: '这里要接一场雨戏' } });
    fireEvent.blur(noteInput);
    expect(container.querySelector('.flow-block-note')?.textContent).toBe('这里要接一场雨戏');
  });

  it('段落注释写长了，块会跟着变高', () => {
    const { container } = render(<App />);
    const block = container.querySelector('.flow-block') as HTMLElement;
    const baseHeight = Number.parseInt(block.style.minHeight, 10);

    fireEvent.click(within(block).getByTitle('加段落注释'));
    const noteInput = container.querySelector('.flow-block-note-input') as HTMLTextAreaElement;
    fireEvent.change(noteInput, {
      target: { value: '这是一段很长的段落注释，用来看块会不会随着内容自动向下延伸，而不是把文字截掉。' },
    });
    fireEvent.blur(noteInput);

    const height = Number.parseInt(
      (container.querySelector('.flow-block') as HTMLElement).style.minHeight,
      10,
    );
    expect(height).toBeGreaterThan(baseHeight);
  });

  it('改名字时 Esc 取消，空名字不生效', () => {
    seedJumpProject();
    const { container } = render(<App />);
    const sidebar = within(container.querySelector('.sidebar') as HTMLElement);

    fireEvent.click(sidebar.getByTitle('重命名段落「开场」'));
    const input = container.querySelector('.tree-group .rename-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '不要这个名字' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(container.querySelector('.tree-group .group-title')?.textContent).toBe('开场');

    fireEvent.click(sidebar.getByTitle('重命名段落「开场」'));
    const again = container.querySelector('.tree-group .rename-input') as HTMLInputElement;
    fireEvent.change(again, { target: { value: '   ' } });
    fireEvent.keyDown(again, { key: 'Enter' });
    expect(container.querySelector('.tree-group .group-title')?.textContent).toBe('开场');
  });

  it('鼠标悬浮某条选项线时它加粗，其他线淡化，两端段落块保持清楚', () => {
    seedJumpProject();
    const { container } = render(<App />);

    const board = () => container.querySelector('.flow-board') as HTMLElement;
    const label = container.querySelector('.flow-edge-label') as HTMLElement;
    expect(board().className).not.toContain('dimming');

    fireEvent.mouseEnter(label);
    expect(board().className).toContain('dimming');
    expect(container.querySelector('.flow-edge-label')?.className).toContain('active');
    // SVG 元素的 className 不是字符串，要用 getAttribute
    expect(container.querySelector('.flow-line')?.getAttribute('class')).toContain('active');
    // 线两端的段落块（开场、码头）保持清楚，其他块被淡化
    const highlighted = [...container.querySelectorAll('.flow-block')].filter((block) =>
      block.className.includes('active'),
    );
    expect(highlighted.map((block) => block.getAttribute('data-block-uid'))).toEqual(['g1', 'g2']);

    fireEvent.mouseLeave(label);
    expect(board().className).not.toContain('dimming');
  });

  it('鼠标悬浮段落块时，与它有关的选项线高亮', () => {
    seedJumpProject();
    const { container } = render(<App />);

    // 悬停「码头」（只有一条线指向它）
    const target = container.querySelectorAll('.flow-block')[1] as HTMLElement;
    fireEvent.mouseEnter(target);

    expect(container.querySelector('.flow-line')?.getAttribute('class')).toContain('active');
    const highlighted = [...container.querySelectorAll('.flow-block')].filter((block) =>
      block.className.includes('active'),
    );
    expect(highlighted).toHaveLength(2); // 自己 + 线另一端的「开场」

    fireEvent.mouseLeave(target);
    expect(container.querySelector('.flow-line')?.getAttribute('class')).not.toContain('active');
  });

  it('跳转目标下拉只列本章的段落', () => {    render(<App />);
    fireEvent.click(screen.getByText('＋ 章节'));
    dropBlock('选项');

    const groupSelect = screen.getByTitle('第一级：目标段落') as HTMLSelectElement;
    expect([...groupSelect.options].map((option) => option.textContent)).toEqual([
      '（对话结束）',
      '序章 / 开场',
    ]);
  });
});

describe('校验面板', () => {
  it('校验按钮在面板里，点一条问题会跳到出问题的那一行', () => {
    const { container } = render(<App />);

    // 默认那行既没台词也没角色，一定有问题
    fireEvent.click(screen.getByRole('button', { name: '校验' }));
    const issues = [...container.querySelectorAll('.issue-row')];
    expect(issues.length).toBeGreaterThan(0);

    fireEvent.click(issues[0]);
    expect(container.querySelector('.line-card.flash')).toBeTruthy();
  });

  it('校验结果能收起、能再展开', () => {
    const { container } = render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '校验' }));
    expect(container.querySelectorAll('.issue-row').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByTitle('收起校验结果'));
    expect(container.querySelectorAll('.issue-row')).toHaveLength(0);
    expect(screen.getByText(/已收起/)).toBeTruthy();

    fireEvent.click(screen.getByTitle('展开校验结果'));
    expect(container.querySelectorAll('.issue-row').length).toBeGreaterThan(0);
  });
});
