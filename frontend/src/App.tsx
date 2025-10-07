import { QueryClientProvider } from '@tanstack/react-query';
import { useAppDispatch, useAppSelector } from './store';
import { logout } from './store/authSlice';
import { Button } from './components/ui/button';
import { queryClient } from './queryClient';

export default function App() {
  const dispatch = useAppDispatch();
  const user = useAppSelector((state) => state.auth.user);

  return (
    <QueryClientProvider client={queryClient}>
      <main className="min-h-screen bg-background text-foreground">
        <header className="border-b border-border bg-card">
          <div className="container flex items-center justify-between py-6">
            <h1 className="text-2xl font-semibold">多端比赛系统</h1>
            {user ? (
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">
                  欢迎，{user.name}
                </span>
                <Button
                  variant="outline"
                  onClick={() => dispatch(logout())}
                >
                  退出登录
                </Button>
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">
                尚未登录
              </span>
            )}
          </div>
        </header>

        <section className="container py-12">
          <div className="grid gap-6 md:grid-cols-2">
            <article className="rounded-lg border border-border bg-card p-6 shadow-sm">
              <h2 className="text-xl font-semibold">建设进度</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                当前为基础框架搭建阶段，已配置 React + Vite + TailwindCSS
                + shadcn/ui 组件骨架，Redux Toolkit 与 React Query
                已集成，可在此基础上快速迭代业务页面。
              </p>
              <Button className="mt-4" variant="default">
                查看产品需求
              </Button>
            </article>

            <article className="rounded-lg border border-border bg-card p-6 shadow-sm">
              <h2 className="text-xl font-semibold">接入指引</h2>
              <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
                <li>1. 使用 Redux Toolkit 管理登录态与核心数据。</li>
                <li>2. 通过 React Query 缓存接口请求与状态。</li>
                <li>3. Axios 已封装 JWT Token 注入与刷新逻辑。</li>
                <li>4. Tailwind 设计规范与 shadcn/ui 组件已可复用。</li>
              </ul>
            </article>
          </div>
        </section>
      </main>
    </QueryClientProvider>
  );
}
