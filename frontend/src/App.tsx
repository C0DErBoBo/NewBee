import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
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
  loginWithPhone,
  loginWithWechat,
  requestPhoneCode
} from './services/auth';

export default function App() {
  const dispatch = useAppDispatch();
  const user = useAppSelector((state) => state.auth.user);

  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [wechatCode, setWechatCode] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const requestCodeMutation = useMutation({
    mutationFn: (phoneNumber: string) => requestPhoneCode(phoneNumber),
    onSuccess: () => {
      setMessage('验证码已发送（开发环境下输出到控制台）');
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
      setMessage('登录成功');
      setError(null);
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : '登录失败，请重试');
    }
  });

  const wechatLoginMutation = useMutation({
    mutationFn: loginWithWechat,
    onSuccess: (data) => {
      dispatch(loginSuccess(data));
      setMessage('微信登录成功（已使用模拟 openId）');
      setError(null);
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : '微信登录失败，请重试');
    }
  });

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = window.setInterval(() => {
      setCountdown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [countdown]);

  const canSendCode = useMemo(() => {
    return /^1\d{10}$/.test(phone) && countdown === 0;
  }, [phone, countdown]);

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
    setMessage('已退出登录');
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="container flex items-center justify-between py-6">
          <h1 className="text-2xl font-semibold">多端比赛系统</h1>
          {user ? (
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">
                欢迎，{user.displayName ?? user.phone ?? '未知用户'}
              </span>
              <Button variant="outline" onClick={handleLogout}>
                退出登录
              </Button>
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">尚未登录</span>
          )}
        </div>
      </header>

      <section className="container grid gap-8 py-12 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>快捷登录</CardTitle>
            <CardDescription>
              支持手机号验证码与模拟微信授权两种方式。
            </CardDescription>
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
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={phoneLoginMutation.isPending}
                  >
                    {phoneLoginMutation.isPending ? '登录中...' : '立即登录'}
                  </Button>
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
                      placeholder="开发阶段支持输入任意字符串"
                      required
                    />
                  </div>
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={wechatLoginMutation.isPending}
                  >
                    {wechatLoginMutation.isPending ? '登录中...' : '授权登录'}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
          {(message || error) && (
            <CardFooter className="flex-col items-start gap-2">
              {message && (
                <p className="text-sm text-green-600 dark:text-green-500">
                  {message}
                </p>
              )}
              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}
            </CardFooter>
          )}
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>当前状态</CardTitle>
            <CardDescription>
              登录后可继续配置赛事、角色权限与报名流程。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {user ? (
              <>
                <div>
                  <p className="text-sm text-muted-foreground">账号信息</p>
                  <p className="text-lg font-semibold">
                    {user.displayName ?? user.phone ?? '未填写昵称'}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    角色：{user.role}
                  </p>
                  {user.phone && (
                    <p className="text-sm text-muted-foreground">
                      手机号：{user.phone}
                    </p>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  下一步可前往赛事管理创建赛事、配置项目模板与报名规则。
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                请先完成登录，以便继续配置赛事、管理报名及导出数据。
              </p>
            )}
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
