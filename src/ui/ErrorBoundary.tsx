import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  stack: string;
}

/**
 * 兜底错误边界。
 *
 * 没有它的话，任何一处渲染异常都会让整页变成空白，既看不到原因也没法自救。
 * 这里至少把错误信息、组件栈和当前数据的大小暴露出来，并给出恢复入口。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, stack: '' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ stack: info.componentStack ?? '' });
    // 同时打到控制台，方便直接复制
    console.error('[StoryMaker] 渲染失败', error, info.componentStack);
  }

  private readonly handleReset = (): void => {
    this.setState({ error: null, stack: '' });
  };

  private readonly handleClearStorage = (): void => {
    try {
      window.localStorage.removeItem('storymaker.project.v1');
    } catch {
      /* 忽略：清不掉也让用户回到可用状态 */
    }
    window.location.reload();
  };

  render(): ReactNode {
    const { error, stack } = this.state;
    if (error === null) return this.props.children;

    let storageSize = '未知';
    try {
      storageSize = `${Math.round(
        (window.localStorage.getItem('storymaker.project.v1')?.length ?? 0) / 1024,
      )} KB`;
    } catch {
      /* 忽略 */
    }

    return (
      <div className="crash">
        <h1>界面出错了</h1>
        <p className="crash-hint">
          这不是数据没了，本地保存的内容还在。请把下面的错误信息发给我，我来修。
        </p>
        <dl className="crash-meta">
          <dt>错误</dt>
          <dd>{error.message}</dd>
          <dt>本地数据大小</dt>
          <dd>{storageSize}</dd>
        </dl>
        <pre className="crash-stack">
          {error.stack ?? '(无堆栈)'}
          {stack}
        </pre>
        <div className="crash-actions">
          <button type="button" onClick={this.handleReset}>
            返回界面
          </button>
          <button type="button" onClick={() => window.location.reload()}>
            刷新页面
          </button>
          <button type="button" className="danger" onClick={this.handleClearStorage}>
            清空本地数据并重载
          </button>
        </div>
      </div>
    );
  }
}
