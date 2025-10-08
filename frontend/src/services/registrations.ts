import { apiClient } from '@/lib/axios';

export type RegistrationStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface RegistrationSelection {
  eventId: string | null;
  eventName: string | null;
  groupId: string | null;
  groupName: string | null;
}

export interface RegistrationSummary {
  id: string;
  competitionId: string;
  competitionName: string;
  userId: string;
  status: RegistrationStatus;
  createdAt: string;
  updatedAt: string;
  participant: {
    name: string;
    gender: string | null;
    identityType: string | null;
    contact: string | null;
    organization: string | null;
  };
  team: {
    id: string | null;
    name: string | null;
    members: unknown[];
  } | null;
  remark: string | null;
  attachments: Array<{ fileName: string; fileUrl: string; size?: number }>;
  selections: RegistrationSelection[];
}

export interface RegistrationListResponse {
  registrations: RegistrationSummary[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
  };
}

export interface RegistrationListParams {
  competitionId?: string;
  status?: RegistrationStatus;
  page?: number;
  pageSize?: number;
}

export async function fetchRegistrations(params: RegistrationListParams = {}) {
  const { data } = await apiClient.get<RegistrationListResponse>('/registrations', {
    params
  });
  return data;
}

export async function updateRegistration(
  registrationId: string,
  payload: {
    status?: RegistrationStatus;
    remark?: string | null;
    attachments?: Array<{ fileName: string; fileUrl: string; size?: number }>;
    participant?: {
      contact?: string | null;
      gender?: string | null;
      identityType?: string | null;
      organization?: string | null;
    };
  }
) {
  const { data } = await apiClient.patch<{ registration: RegistrationSummary }>(
    `/registrations/${registrationId}`,
    payload
  );
  return data.registration;
}

export async function cancelRegistration(registrationId: string) {
  const { data } = await apiClient.delete<{ registration: RegistrationSummary }>(
    `/registrations/${registrationId}`
  );
  return data.registration;
}
