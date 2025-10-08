import { apiClient } from '@/lib/axios';

export interface CompetitionEventInput {
  name: string;
  category: 'track' | 'field';
  unitType: 'individual' | 'team';
  isCustom?: boolean;
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
  startAt?: string;
  endAt?: string;
  config?: Record<string, unknown>;
  events?: CompetitionEventInput[];
  groups?: CompetitionGroupInput[];
  rules?: CompetitionRuleInput;
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
  return data.competitions as Array<{
    id: string;
    name: string;
    location?: string;
    startAt?: string;
    endAt?: string;
    createdAt: string;
  }>;
}
