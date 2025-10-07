import { apiClient } from '@/lib/axios';

export interface AccountSummary {
  id: string;
  phone?: string | null;
  displayName?: string | null;
  role: string;
  createdAt: string;
}

export async function fetchAccounts() {
  const { data } = await apiClient.get<{ accounts: AccountSummary[] }>('/admin/accounts');
  return data.accounts;
}

export async function updateAccountRole(userId: string, role: string) {
  const { data } = await apiClient.patch<{ account: AccountSummary }>(
    `/admin/accounts/${userId}/role`,
    { role }
  );
  return data.account;
}
