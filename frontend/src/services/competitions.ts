import { apiClient } from '@/lib/axios';

export interface CompetitionEventInput {
  name: string;
  category: 'track' | 'field' | 'all_round' | 'fun' | 'score';
  unitType: 'individual' | 'team';
  competitionMode?: 'lane' | 'mass';
  scoringType?: 'timing' | 'distance' | 'height';
  isCustom?: boolean;
  groupIds?: string[];
  config?: Record<string, unknown>;
}

export interface CompetitionGroupInput {
  name: string;
  gender: 'male' | 'female' | 'mixed';
  ageBracket?: string;
  identityType?: string;
  maxParticipants?: number;
  teamSize?: number;
  config?: Record<string, unknown>;
}

export interface CompetitionRuleInput {
  scoring?: Record<string, unknown>;
  flow?: Record<string, unknown>;
  penalties?: Record<string, unknown>;
}

export interface CreateCompetitionPayload {
  name: string;
  location?: string;
  signupStartAt: string;
  signupEndAt: string;
  startAt?: string;
  endAt?: string;
  config?: Record<string, unknown>;
  events?: CompetitionEventInput[];
  groups?: CompetitionGroupInput[];
  rules?: CompetitionRuleInput;
}

export interface CompetitionSummary {
  id: string;
  name: string;
  location?: string;
  signupStartAt?: string;
  signupEndAt?: string;
  startAt?: string;
  endAt?: string;
  createdAt: string;
  stats: {
    participantCount: number;
    teamCount: number;
  };
}

export interface CompetitionEventDetail extends CompetitionEventInput {
  id?: string;
}

export interface CompetitionGroupDetail extends CompetitionGroupInput {
  id?: string;
}

export interface CompetitionRuleDetail extends CompetitionRuleInput {
  createdAt?: string;
  updatedAt?: string;
}

export interface CompetitionDetail extends CompetitionSummary {
  config?: Record<string, unknown>;
  events: CompetitionEventDetail[];
  groups: CompetitionGroupDetail[];
  rules: CompetitionRuleDetail | null;
}

export async function fetchEventTemplates() {
  const { data } = await apiClient.get<{ events: CompetitionEventInput[] }>(
    '/competitions/templates/events'
  );
  return data.events;
}

export async function createCompetition(payload: CreateCompetitionPayload) {
  const { data } = await apiClient.post('/competitions', payload);
  return data.competition;
}

export async function fetchCompetitions() {
  const { data } = await apiClient.get('/competitions');
  return data.competitions as CompetitionSummary[];
}

export async function fetchCompetitionDetail(id: string) {
  const { data } = await apiClient.get<{ competition: CompetitionDetail }>(
    `/competitions/${id}`
  );
  return data.competition;
}

export async function updateCompetition(id: string, payload: CreateCompetitionPayload) {
  const { data } = await apiClient.patch<{ competition: CompetitionDetail }>(
    `/competitions/${id}`,
    payload
  );
  return data.competition;
}
