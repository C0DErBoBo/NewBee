import { apiClient } from '@/lib/axios';

export interface TeamMemberEvent {
  name?: string | null;
  result?: string | null;
}

export interface TeamMember {
  name: string;
  gender?: string | null;
  group?: string | null;
  events: TeamMemberEvent[];
  registered?: boolean;
}

export interface TeamMembersResponse {
  team: {
    id: string;
    name: string;
  };
  members: TeamMember[];
}

export async function fetchTeamMembers(competitionId?: string | null) {
  const { data } = await apiClient.get<TeamMembersResponse>('/team/members', {
    params: competitionId ? { competitionId } : undefined
  });
  return data;
}

export async function updateTeamMembers(members: TeamMember[], competitionId?: string | null) {
  const payload: {
    members: TeamMember[];
    competitionId?: string;
  } = {
    members
  };

  if (competitionId) {
    payload.competitionId = competitionId;
  }

  const { data } = await apiClient.put<TeamMembersResponse>('/team/members', payload);
  return data;
}
