import { Component, type ErrorInfo, type ReactNode } from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";

type AppErrorBoundaryProps = {
  children: ReactNode;
};

type AppErrorBoundaryState = {
  error: Error | null;
};

export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    return {
      error: error instanceof Error ? error : new Error("界面发生未知错误"),
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Renge 界面渲染失败", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="app-error-boundary" role="alert">
        <section className="app-error-panel">
          <span className="app-error-icon" aria-hidden="true">
            <TriangleAlert size={24} />
          </span>
          <div>
            <h1>界面加载失败</h1>
            <p>应用数据没有被删除。请重新加载后再试。</p>
          </div>
          <button type="button" onClick={() => window.location.reload()}>
            <RefreshCw size={16} />
            重新加载
          </button>
          <details>
            <summary>错误详情</summary>
            <pre>{this.state.error.message || "未知错误"}</pre>
          </details>
        </section>
      </main>
    );
  }
}
