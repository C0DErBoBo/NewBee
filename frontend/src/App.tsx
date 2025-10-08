import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useAppDispatch, useAppSelector } from './store';
import { loginSuccess, logout } from './store/authSlice';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from './components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';
import {
  fetchCompetitions,
  fetchCompetitionDetail,
  CompetitionSummary,
  CompetitionDetail
} from './services/competitions';
import {
  loginWithPhone,
  loginWithWechat,
  requestPhoneCode
} from './services/auth';
import { fetchAccounts, updateAccountRole, AccountSummary } from './services/admin';
import { CompetitionWizard } from './components/CompetitionWizard';

type MainTab = 'competition' | 'account' | 'admin';

interface ToastState {
  text: string;
  variant: 'success' | 'info';
}

interface WizardState {
  visible: boolean;
  mode: 'create' | 'edit';
  loading: boolean;
  competition?: CompetitionDetail;
}

const initialWizardState: WizardState = {
  visible: false,
  mode: 'create',
  loading: false,
  competition: undefined
};

export default function App() {
  const dispatch = useAppDispatch();
  const user = useAppSelector((state) => state.auth.user);
  const isAdmin = user?.role === 'admin';

  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [wechatCode, setWechatCode] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<MainTab>('competition');
  const [wizardState, setWizardState] = useState<WizardState>(initialWizardState);

  const competitionsQuery = useQuery({
    queryKey: ['dashboard-competitions'],
    queryFn: fetchCompetitions,
    enabled: Boolean(user)
  });

  const accountsQuery = useQuery({
    queryKey: ['admin-accounts'],
    queryFn: fetchAccounts,
    enabled: isAdmin
  });

  const requestCodeMutation = useMutation({
    mutationFn: (phoneNumber: string) => requestPhoneCode(phoneNumber),
    onSuccess: () => {
      setToast({ text: '验证码已发送（开发环境可使用固定测试码）', variant: 'info' });
      setError(null);
      setCountdown(60);
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : '发送验证码失败');
    }
  });

  const phoneLoginMutation = useMutation({
    mutationFn: loginWithPhone,
    onSuccess: (data) => {
      dispatch(loginSuccess(data));
      setToast({ text: '登录成功', variant: 'success' });
      setError(null);
      setActiveTab('competition');
      competitionsQuery.refetch();
      if (isAdmin) {
        accountsQuery.refetch();
      }
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : '登录失败，请重试');
    }
  });

  const wechatLoginMutation = useMutation({
    mutationFn: loginWithWechat,
    onSuccess: (data) => {
      dispatch(loginSuccess(data));
      setToast({ text: '微信登录成功（已使用模拟 openId）', variant: 'success' });
      setError(null);
      setActiveTab('competition');
      competitionsQuery.refetch();
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : '微信登录失败，请重试');
    }
  });

  const updateRoleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      updateAccountRole(userId, role),
    onSuccess: () => {
      accountsQuery.refetch();
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : '更新账号角色失败');
    }
  });

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = window.setInterval(() => {
      setCountdown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [countdown]);

  useEffect(() => {
    if (!user) {
      setToast(null);
      setError(null);
      setCountdown(0);
      setPhone('');
      setCode('');
      setWechatCode('');
    }
  }, [user]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => {
      setToast(null);
    }, toast.variant === 'success' ? 2500 : 4000);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const canSendCode = useMemo(
    () => /^1\d{10}$/.test(phone) && countdown === 0,
    [phone, countdown]
  );

  const handleSendCode = async () => {
    if (!canSendCode) return;
    await requestCodeMutation.mutateAsync(phone);
  };

  const handlePhoneLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    await phoneLoginMutation.mutateAsync({ phone, code });
  };

  const handleWechatLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    await wechatLoginMutation.mutateAsync({ code: wechatCode });
  };

  const handleLogout = () => {
    dispatch(logout());
    setToast({ text: '已退出登录', variant: 'info' });
  };

  const openCreateWizard = () => {
    setWizardState({ visible: true, mode: 'create', loading: false, competition: undefined });
  };

  const openEditWizard = async (competitionId: string) => {
    setWizardState({ visible: true, mode: 'edit', loading: true, competition: undefined });
    try {
      const detail = await fetchCompetitionDetail(competitionId);
      setWizardState({ visible: true, mode: 'edit', loading: false, competition: detail });
    } catch (err) {
      setWizardState(initialWizardState);
      setError(err instanceof Error ? err.message : '获取赛事详情失败');
    }
  };

  const closeWizard = () => setWizardState(initialWizardState);

  const competitionData = competitionsQuery.data ?? [];
  const accountData = accountsQuery.data ?? [];

  const renderCompetitionTable = (list: CompetitionSummary[]) => (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="text-left text-muted-foreground">
          <tr>
            <th className="py-2 pr-4">名称</th>
            <th className="py-2 pr-4">报名时间</th>
            <th className="py-2 pr-4">比赛时间</th>
            <th className="py-2 pr-4">地点</th>
            <th className="py-2 pr-4 text-right">报名人数 / 团队</th>
            <th className="py-2 pl-4 text-right">操作</th>
          </tr>
        </thead>
        <tbody>
          {list.map((item) => (
            <tr key={item.id} className="border-t border-border">
              <td className="py-2 pr-4 font-medium">{item.name}</td>
              <td className="py-2 pr-4">{formatRange(item.signupStartAt, item.signupEndAt)}</td>
              <td className="py-2 pr-4">{formatRange(item.startAt, item.endAt)}</td>
              <td className="py-2 pr-4">{item.location ?? '-'}</td>
              <td className="py-2 pr-4 text-right">
                {item.stats.participantCount} / {item.stats.teamCount}
              </td>
              <td className="py-2 pl-4 text-right">
                <Button variant="ghost" size="sm" onClick={() => openEditWizard(item.id)}>
                  管理
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="container flex items-center justify-between py-6">
          <h1 className="text-2xl font-semibold">多端比赛系统</h1>
          {user ? (
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">
                {user.displayName ?? user.phone ?? '未命名账号'} · {user.role}
              </span>
              <Button variant="outline" onClick={handleLogout}>
                退出登录
              </Button>
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">请登录以继续</span>
          )}
        </div>
      </header>

      <section className="container py-12">
        {!user ? (
          <Card className="mx-auto max-w-3xl">
            <CardHeader>
              <CardTitle>快捷登录</CardTitle>
              <CardDescription>支持手机号验证码与模拟微信授权登录。</CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="phone">
                <TabsList className="mb-4">
                  <TabsTrigger value="phone">手机号登录</TabsTrigger>
                  <TabsTrigger value="wechat">微信授权</TabsTrigger>
                </TabsList>
                <TabsContent value="phone">
                  <form className="space-y-4" onSubmit={handlePhoneLogin}>
                    <div className="space-y-2">
                      <Label htmlFor="phone">手机号</Label>
                      <Input
                        id="phone"
                        value={phone}
                        onChange={(event) => setPhone(event.target.value)}
                        placeholder="请输入 11 位手机号"
                        maxLength={11}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="code">验证码</Label>
                      <div className="flex gap-2">
                        <Input
                          id="code"
                          value={code}
                          onChange={(event) => setCode(event.target.value)}
                          placeholder="输入 6 位验证码"
                          maxLength={6}
                          required
                        />
                        <Button
                          type="button"
                          variant="outline"
                          onClick={handleSendCode}
                          disabled={!canSendCode || requestCodeMutation.isPending}
                        >
                          {countdown > 0 ? `${countdown}s` : '发送验证码'}
                        </Button>
                      </div>
                    </div>
                    <Button type="submit" className="w-full" disabled={phoneLoginMutation.isPending}>
                      {phoneLoginMutation.isPending ? '登录中...' : '立即登录'}
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      开发模式下可直接使用测试验证码 <code>zxcasd</code>。
                    </p>
                  </form>
                </TabsContent>
                <TabsContent value="wechat">
                  <form className="space-y-4" onSubmit={handleWechatLogin}>
                    <div className="space-y-2">
                      <Label htmlFor="wechat-code">微信临时代码</Label>
                      <Input
                        id="wechat-code"
                        value={wechatCode}
                        onChange={(event) => setWechatCode(event.target.value)}
                        placeholder="开发阶段可输入任意字符串"
                        required
                      />
                    </div>
                    <Button type="submit" className="w-full" disabled={wechatLoginMutation.isPending}>
                      {wechatLoginMutation.isPending ? '登录中...' : '授权登录'}
                    </Button>
                  </form>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        ) : (
          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as MainTab)}>
            <TabsList className="mb-6">
              <TabsTrigger value="competition">赛事管理</TabsTrigger>
              <TabsTrigger value="account">账号信息</TabsTrigger>
              {isAdmin && <TabsTrigger value="admin">账号管理</TabsTrigger>}
            </TabsList>

            <TabsContent value="competition" className="space-y-6">
              <Card>
                <CardHeader>
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <CardTitle>赛事列表</CardTitle>
                      <CardDescription>点击“管理”可进入赛事详情页修改设置。</CardDescription>
                    </div>
                    <Button onClick={openCreateWizard}>新增赛事</Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {competitionsQuery.isLoading ? (
                    <p className="text-sm text-muted-foreground">加载中...</p>
                  ) : competitionData.length ? (
                    renderCompetitionTable(competitionData)
                  ) : (
                    <p className="text-sm text-muted-foreground">暂无赛事记录，点击“新增赛事”开始配置。</p>
                  )}
                </CardContent>
              </Card>

              {wizardState.visible && (
                wizardState.loading ? (
                  <Card>
                    <CardContent className="py-8 text-center text-sm text-muted-foreground">
                      正在加载赛事详情...
                    </CardContent>
                  </Card>
                ) : (
                  <CompetitionWizard
                    mode={wizardState.mode}
                    initialCompetition={wizardState.competition}
                    onClose={closeWizard}
                    onCreated={(id) => {
                      setToast({ text: '赛事创建成功', variant: 'success' });
                      closeWizard();
                      competitionsQuery.refetch();
                    }}
                    onUpdated={(id) => {
                      setToast({ text: '赛事更新成功', variant: 'success' });
                      closeWizard();
                      competitionsQuery.refetch();
                    }}
                  />
                )
              )}
            </TabsContent>

            <TabsContent value="account" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>账号信息</CardTitle>
                  <CardDescription>查看当前登录账号及近期登录提示。</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="text-sm text-muted-foreground">账号</p>
                    <p className="text-lg font-semibold">
                      {user.displayName ?? user.phone ?? '未命名账号'}
                    </p>
                    <p className="text-sm text-muted-foreground">角色：{user.role}</p>
                    {user.phone && (
                      <p className="text-sm text-muted-foreground">手机号：{user.phone}</p>
                    )}
                  </div>
                  <div className="rounded-md border border-border p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="text-sm font-semibold">赛事概览</h3>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => competitionsQuery.refetch()}
                        disabled={competitionsQuery.isFetching}
                      >
                        刷新
                      </Button>
                    </div>
                    {competitionsQuery.isLoading ? (
                      <p className="text-sm text-muted-foreground">加载中...</p>
                    ) : competitionData.length ? (
                      renderCompetitionTable(competitionData)
                    ) : (
                      <p className="text-sm text-muted-foreground">暂无赛事记录。</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {isAdmin && (
              <TabsContent value="admin" className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>账号管理</CardTitle>
                    <CardDescription>
                      查看系统内的账号并调整角色权限。默认手机号 15521396332 拥有系统管理员权限。
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">
                        共 {accountData.length} 个账号
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => accountsQuery.refetch()}
                        disabled={accountsQuery.isFetching}
                      >
                        刷新
                      </Button>
                    </div>
                    {accountsQuery.isLoading ? (
                      <p className="text-sm text-muted-foreground">加载中...</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="min-w-full text-sm">
                          <thead className="text-left text-muted-foreground">
                            <tr>
                              <th className="py-2 pr-4">账号</th>
                              <th className="py-2 pr-4">手机号</th>
                              <th className="py-2 pr-4">角色</th>
                              <th className="py-2 pr-4">创建时间</th>
                              <th className="py-2 pl-4 text-right">操作</th>
                            </tr>
                          </thead>
                          <tbody>
                            {accountData.map((account) => (
                              <tr key={account.id} className="border-t border-border">
                                <td className="py-2 pr-4 font-medium">
                                  {account.displayName ?? account.phone ?? account.id}
                                </td>
                                <td className="py-2 pr-4">{account.phone ?? '-'}</td>
                                <td className="py-2 pr-4 capitalize">{account.role}</td>
                                <td className="py-2 pr-4">
                                  {new Date(account.createdAt).toLocaleString()}
                                </td>
                                <td className="py-2 pl-4 text-right">
                                  <RoleSelect
                                    value={account.role}
                                    disabled={updateRoleMutation.isPending}
                                    onChange={(role) =>
                                      updateRoleMutation.mutate({ userId: account.id, role })
                                    }
                                  />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            )}
          </Tabs>
        )}
      </section>

      {(toast || error) && (
        <section className="container pb-8">
          <Card className="bg-muted/40">
            <CardContent className="py-3 text-sm">
              {toast && (
                <span className={toast.variant === 'success' ? 'text-green-600 dark:text-green-500' : 'text-muted-foreground'}>
                  {toast.text}
                </span>
              )}
              {error && <span className="ml-4 text-destructive">{error}</span>}
            </CardContent>
          </Card>
        </section>
      )}
    </main>
  );
}

function RoleSelect({
  value,
  onChange,
  disabled
}: {
  value: string;
  onChange: (role: string) => void;
  disabled?: boolean;
}) {
  return (
    <select
      className="h-9 rounded-md border border-input bg-background px-3 text-sm"
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="admin">系统管理员</option>
      <option value="organizer">办赛方</option>
      <option value="team">参赛队伍</option>
    </select>
  );
}

function formatRange(start?: string, end?: string) {
  if (!start && !end) return '-';
  const startText = start ? new Date(start).toLocaleString() : '待定';
  const endText = end ? new Date(end).toLocaleString() : '待定';
  return `${startText} ~ ${endText}`;
}
