import { apiClient } from '@/lib/axios';
import type { AuthUser } from '@/store/authSlice';

interface ApiAuthResponse {
  user: {
    id: string;
    phone?: string | null;
    display_name?: string | null;
    role: string;
    wechat_openid?: string | null;
    created_at?: string;
  };
  accessToken: string;
  refreshToken: string;
}

function adaptUser(user: ApiAuthResponse['user']): AuthUser {
  return {
    id: user.id,
    phone: user.phone ?? null,
    displayName: user.display_name ?? null,
    role: user.role,
    wechatOpenid: user.wechat_openid ?? null,
    createdAt: user.created_at
  };
}

export async function requestPhoneCode(phone: string) {
  const { data } = await apiClient.post<{ expiresAt: string }>(
    '/auth/code',
    { phone }
  );
  return data;
}

export async function loginWithPhone(payload: { phone: string; code: string }) {
  const { data } = await apiClient.post<ApiAuthResponse>(
    '/auth/login/phone',
    payload
  );
  return {
    user: adaptUser(data.user),
    accessToken: data.accessToken,
    refreshToken: data.refreshToken
  };
}

export async function loginWithWechat(payload: { code: string }) {
  const { data } = await apiClient.post<ApiAuthResponse>(
    '/auth/login/wechat',
    payload
  );
  return {
    user: adaptUser(data.user),
    accessToken: data.accessToken,
    refreshToken: data.refreshToken
  };
}

export async function fetchProfile() {
  const { data } = await apiClient.get<{
    user: ApiAuthResponse['user'];
  }>('/auth/profile');
  return adaptUser(data.user);
}
