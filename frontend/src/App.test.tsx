import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { AppProviders } from './providers/AppProviders';

function renderWithProviders() {
  return render(
    <AppProviders>
      <App />
    </AppProviders>
  );
}

describe('App 登录流程', () => {
  it('默认展示手机号登录表单', () => {
    renderWithProviders();
    expect(
      screen.getByRole('heading', { name: '快捷登录' })
    ).toBeInTheDocument();
    expect(screen.getByLabelText('手机号')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发送验证码' })).toBeDisabled();
  });

  it('支持切换到微信授权登录', async () => {
    renderWithProviders();
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: '微信授权' }));
    expect(
      screen.getByLabelText('微信临时代码')
    ).toBeInTheDocument();
  });
});
