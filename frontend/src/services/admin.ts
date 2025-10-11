import { apiClient } from '@/lib/axios';

export interface AccountSummary {
  id: string;
  phone?: string | null;
  displayName?: string | null;
  role: string;
  createdAt: string;
}

export interface TeamImportInput {
  name: string;
  shortName?: string | null;
}

export interface ImportedTeamAccount {
  teamId: string;
  userId: string;
  name: string;
  shortName?: string | null;
  username: string;
  password: string;
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

export async function importTeamAccounts(payload: TeamImportInput[]) {
  const { data } = await apiClient.post<{ teams: ImportedTeamAccount[] }>(
    '/admin/teams/import',
    {
      teams: payload
    }
  );
  return data.teams;
}
