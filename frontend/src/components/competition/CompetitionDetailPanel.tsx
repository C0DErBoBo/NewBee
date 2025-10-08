import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '../ui/card';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Textarea } from '../ui/textarea';
import {
  CompetitionDetail,
  CompetitionEventInput,
  CompetitionGroupInput,
  CompetitionRuleInput,
  fetchCompetitionDetail,
  updateCompetition
} from '@/services/competitions';

type DetailTab = 'basic' | 'projects' | 'rules' | 'registration';

interface CompetitionDetailPanelProps {
  competitionId: string;
  onBack: () => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
  onOpenWizard: (detail: CompetitionDetail) => void;
}

interface BasicInfoDraft {
  name: string;
  location: string;
  signupStartAt: string;
  signupEndAt: string;
  startAt: string;
  endAt: string;
}

interface EditableCompetition {
  basic: BasicInfoDraft;
  events: CompetitionEventInput[];
  groups: CompetitionGroupInput[];
  rules: CompetitionRuleInput;
  registration: Record<string, unknown>;
}

type RulesKey = 'scoring' | 'flow' | 'penalties';

const defaultRules: CompetitionRuleInput = {
  scoring: {
    defaultTable: [9, 7, 6, 5, 4, 3, 2, 1]
  },
  flow: {
    stages: ['预赛', '决赛'],
    advance: '成绩前 8 名晋级决赛'
  },
  penalties: {
    disqualified: ['两次抢跑', '严重犯规'],
    waiver: ['赛前书面说明']
  }
};

const defaultRegistrationConfig = {
  maxEventsPerParticipant: 2,
  allowTeamOverlap: false,
  requireRealName: true
};

const toInputDateTime = (value?: string) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};

const toIsoString = (value: string) => {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
};

const deepClone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

const safeJsonParse = <T,>(value: string, fallback: T): { data: T; error: string | null } => {
  try {
    return { data: JSON.parse(value) as T, error: null };
  } catch (error) {
    return { data: fallback, error: (error as Error).message };
  }
};

function mapDetailToEditable(detail: CompetitionDetail): EditableCompetition {
  return {
    basic: {
      name: detail.name,
      location: detail.location ?? '',
      signupStartAt: toInputDateTime(detail.signupStartAt),
      signupEndAt: toInputDateTime(detail.signupEndAt),
      startAt: toInputDateTime(detail.startAt),
      endAt: toInputDateTime(detail.endAt)
    },
    events: detail.events.map((event) => ({
      name: event.name,
      category: event.category,
      unitType: event.unitType,
      isCustom: event.isCustom,
      config: event.config
    })),
    groups:
      detail.groups.length > 0
        ? detail.groups.map((group) => ({
            name: group.name,
            gender: group.gender,
            ageBracket: group.ageBracket,
            identityType: group.identityType,
            maxParticipants: group.maxParticipants,
            teamSize: group.teamSize,
            config: group.config
          }))
        : [],
    rules: detail.rules ? deepClone(detail.rules) : deepClone(defaultRules),
    registration: (detail.config?.registration ?? deepClone(defaultRegistrationConfig)) as Record<
      string,
      unknown
    >
  };
}

export function CompetitionDetailPanel({
  competitionId,
  onBack,
  onSuccess,
  onError,
  onOpenWizard
}: CompetitionDetailPanelProps) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<DetailTab>('basic');
  const [draft, setDraft] = useState<EditableCompetition | null>(null);
  const [originalDraft, setOriginalDraft] = useState<EditableCompetition | null>(null);
  const [registrationText, setRegistrationText] = useState('');
  const [registrationError, setRegistrationError] = useState<string | null>(null);
  const [rulesText, setRulesText] = useState<Record<RulesKey, string>>({
    scoring: '',
    flow: '',
    penalties: ''
  });
  const [rulesError, setRulesError] = useState<Record<RulesKey, string | null>>({
    scoring: null,
    flow: null,
    penalties: null
  });
  const [hasPendingChanges, setHasPendingChanges] = useState(false);

  const detailQuery = useQuery({
    queryKey: ['competition-detail', competitionId],
    queryFn: () => fetchCompetitionDetail(competitionId),
    staleTime: 30_000
  });

  useEffect(() => {
    if (!detailQuery.data) return;
    const editable = mapDetailToEditable(detailQuery.data);
    setDraft(editable);
    setOriginalDraft(deepClone(editable));
    setRegistrationText(JSON.stringify(editable.registration, null, 2));
    setRegistrationError(null);
    setRulesText({
      scoring: JSON.stringify(editable.rules?.scoring ?? {}, null, 2),
      flow: JSON.stringify(editable.rules?.flow ?? {}, null, 2),
      penalties: JSON.stringify(editable.rules?.penalties ?? {}, null, 2)
    });
    setRulesError({ scoring: null, flow: null, penalties: null });
    setHasPendingChanges(false);
  }, [detailQuery.data]);

  const updateMutation = useMutation({
    mutationFn: (payload: CompetitionRuleInput & { config: Record<string, unknown> }) => {
      const { config, ...rest } = payload;
      const currentDraft = draft;
      if (!currentDraft) throw new Error('缺少赛事信息草稿');
      return updateCompetition(competitionId, {
        name: currentDraft.basic.name,
        location: currentDraft.basic.location || undefined,
        signupStartAt: toIsoString(currentDraft.basic.signupStartAt)!,
        signupEndAt: toIsoString(currentDraft.basic.signupEndAt)!,
        startAt: toIsoString(currentDraft.basic.startAt),
        endAt: toIsoString(currentDraft.basic.endAt),
        events: currentDraft.events.filter((event) => event.name.trim().length > 0),
        groups: currentDraft.groups.filter((group) => group.name.trim().length > 0),
        rules: {
          scoring: rest.scoring,
          flow: rest.flow,
          penalties: rest.penalties
        },
        config
      });
    },
    onSuccess: async (updated) => {
      onSuccess('赛事详情已保存');
      const editable = mapDetailToEditable(updated);
      setDraft(editable);
      setOriginalDraft(deepClone(editable));
      setRegistrationText(JSON.stringify(editable.registration, null, 2));
      setRulesText({
        scoring: JSON.stringify(editable.rules?.scoring ?? {}, null, 2),
        flow: JSON.stringify(editable.rules?.flow ?? {}, null, 2),
        penalties: JSON.stringify(editable.rules?.penalties ?? {}, null, 2)
      });
      setRulesError({ scoring: null, flow: null, penalties: null });
      setRegistrationError(null);
      setHasPendingChanges(false);
      await queryClient.invalidateQueries({ queryKey: ['dashboard-competitions'] });
      await detailQuery.refetch();
    },
    onError: (error) => {
      onError(error instanceof Error ? error.message : '保存赛事信息失败');
    }
  });
  const changeSummary = useMemo(() => {
    if (!draft || !originalDraft) return [];
    const summary: string[] = [];
    if (draft.basic.name !== originalDraft.basic.name) {
      summary.push('基础信息：赛事名称已更新');
    }
    if (draft.basic.location !== originalDraft.basic.location) {
      summary.push('基础信息：赛事地点已调整');
    }
    if (
      draft.basic.signupStartAt !== originalDraft.basic.signupStartAt ||
      draft.basic.signupEndAt !== originalDraft.basic.signupEndAt ||
      draft.basic.startAt !== originalDraft.basic.startAt ||
      draft.basic.endAt !== originalDraft.basic.endAt
    ) {
      summary.push('时间配置：报名/赛事时间有改动');
    }
    const isEventChanged =
      draft.events.length !== originalDraft.events.length ||
      draft.events.some((event, index) => {
        const original = originalDraft.events[index];
        if (!original) return true;
        return (
          event.name !== original.name ||
          event.category !== original.category ||
          event.unitType !== original.unitType
        );
      });
    if (isEventChanged) {
      summary.push('项目配置已更新');
    }
    const isGroupChanged =
      draft.groups.length !== originalDraft.groups.length ||
      draft.groups.some((group, index) => {
        const original = originalDraft.groups[index];
        if (!original) return true;
        return (
          group.name !== original.name ||
          group.gender !== original.gender ||
          group.ageBracket !== original.ageBracket ||
          group.identityType !== original.identityType ||
          group.maxParticipants !== original.maxParticipants ||
          group.teamSize !== original.teamSize
        );
      });
    if (isGroupChanged) {
      summary.push('组别配置已更新');
    }
    const isRulesChanged =
      JSON.stringify(draft.rules?.scoring ?? {}) !==
        JSON.stringify(originalDraft.rules?.scoring ?? {}) ||
      JSON.stringify(draft.rules?.flow ?? {}) !== JSON.stringify(originalDraft.rules?.flow ?? {}) ||
      JSON.stringify(draft.rules?.penalties ?? {}) !==
        JSON.stringify(originalDraft.rules?.penalties ?? {});
    if (isRulesChanged) {
      summary.push('流程与积分规则已更新');
    }
    const isRegistrationChanged =
      JSON.stringify(draft.registration ?? {}) !== JSON.stringify(originalDraft.registration ?? {});
    if (isRegistrationChanged) {
      summary.push('报名规则已更新');
    }
    return summary;
  }, [draft, originalDraft]);

  const hasErrors =
    registrationError !== null || Object.values(rulesError).some((value) => Boolean(value));
  const canSave = hasPendingChanges && !hasErrors && !updateMutation.isLoading;

  const handleBasicChange = <K extends keyof BasicInfoDraft>(key: K, value: BasicInfoDraft[K]) => {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        basic: {
          ...prev.basic,
          [key]: value
        }
      };
    });
    setHasPendingChanges(true);
  };

  const handleEventChange = (
    index: number,
    key: keyof CompetitionEventInput,
    value: CompetitionEventInput[keyof CompetitionEventInput]
  ) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const nextEvents = prev.events.map((event, idx) =>
        idx === index ? { ...event, [key]: value } : event
      );
      return { ...prev, events: nextEvents };
    });
    setHasPendingChanges(true);
  };

  const handleGroupChange = (
    index: number,
    key: keyof CompetitionGroupInput,
    value: CompetitionGroupInput[keyof CompetitionGroupInput]
  ) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const nextGroups = prev.groups.map((group, idx) =>
        idx === index ? { ...group, [key]: value } : group
      );
      return { ...prev, groups: nextGroups };
    });
    setHasPendingChanges(true);
  };

  const handleRulesTextChange = (key: RulesKey, value: string) => {
    setRulesText((prev) => ({ ...prev, [key]: value }));
    setHasPendingChanges(true);
    const { data, error } = safeJsonParse(value, draft?.rules?.[key] ?? {});
    if (error) {
      setRulesError((prev) => ({ ...prev, [key]: 'JSON 解析失败，请检查格式' }));
      return;
    }
    setRulesError((prev) => ({ ...prev, [key]: null }));
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        rules: {
          ...prev.rules,
          [key]: data
        }
      };
    });
  };

  const handleRegistrationChange = (value: string) => {
    setRegistrationText(value);
    setHasPendingChanges(true);
    const { data, error } = safeJsonParse<Record<string, unknown>>(
      value,
      draft?.registration ?? {}
    );
    if (error) {
      setRegistrationError('JSON 解析失败，请检查格式');
      return;
    }
    setRegistrationError(null);
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        registration: data
      };
    });
  };

  const handleSave = () => {
    if (!draft) return;
    if (!draft.basic.name.trim()) {
      onError('请填写赛事名称');
      return;
    }
    if (!draft.basic.signupStartAt || !draft.basic.signupEndAt) {
      onError('请填写完整的报名时间范围');
      return;
    }
    if (hasErrors) {
      onError('仍存在未处理的配置错误，请先修正');
      return;
    }
    updateMutation.mutate({
      scoring: draft.rules?.scoring ?? {},
      flow: draft.rules?.flow ?? {},
      penalties: draft.rules?.penalties ?? {},
      config: {
        ...(detailQuery.data?.config ?? {}),
        registration: draft.registration
      }
    });
  };

  const handleAddEvent = () => {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        events: [
          ...prev.events,
          {
            name: '',
            category: 'track',
            unitType: 'individual',
            isCustom: true
          }
        ]
      };
    });
    setHasPendingChanges(true);
  };

  const handleRemoveEvent = (index: number) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const nextEvents = prev.events.filter((_, idx) => idx !== index);
      return { ...prev, events: nextEvents };
    });
    setHasPendingChanges(true);
  };

  const handleAddGroup = () => {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        groups: [
          ...prev.groups,
          {
            name: '',
            gender: 'mixed',
            ageBracket: '',
            identityType: '',
            maxParticipants: undefined,
            teamSize: undefined
          }
        ]
      };
    });
    setHasPendingChanges(true);
  };

  const handleRemoveGroup = (index: number) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const nextGroups = prev.groups.filter((_, idx) => idx !== index);
      return { ...prev, groups: nextGroups };
    });
    setHasPendingChanges(true);
  };
  if (detailQuery.isLoading || !draft || !originalDraft) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>赛事详情加载中</CardTitle>
          <CardDescription>正在获取赛事完整配置，请稍候…</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
          <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
          <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
        </CardContent>
      </Card>
    );
  }

  if (detailQuery.isError && !detailQuery.data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>赛事详情加载失败</CardTitle>
          <CardDescription>请检查网络后重试</CardDescription>
        </CardHeader>
        <CardFooter className="flex justify-between">
          <Button variant="outline" onClick={onBack}>
            返回列表
          </Button>
          <Button onClick={() => detailQuery.refetch()}>重新加载</Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="border border-border">
      <CardHeader className="space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <Button variant="ghost" className="px-0 text-sm text-muted-foreground" onClick={onBack}>
              ← 返回赛事列表
            </Button>
            <CardTitle className="mt-2 text-2xl font-semibold">
              {draft.basic.name || '赛事详情'}
            </CardTitle>
            <CardDescription>
              赛事编号：{competitionId} · 创建时间{' '}
              {detailQuery.data ? new Date(detailQuery.data.createdAt).toLocaleString() : '-'}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={() => detailQuery.refetch()}
              disabled={detailQuery.isFetching}
            >
              {detailQuery.isFetching ? '刷新中…' : '刷新数据'}
            </Button>
            {detailQuery.data && (
              <Button variant="outline" onClick={() => onOpenWizard(detailQuery.data)}>
                打开配置向导
              </Button>
            )}
            <Button onClick={handleSave} disabled={!canSave}>
              {updateMutation.isLoading ? '保存中…' : '保存变更'}
            </Button>
          </div>
        </div>
        <div className="grid gap-3 text-sm md:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-md border border-border p-3">
            <p className="text-muted-foreground">报名时间</p>
            <p className="font-medium">
              {draft.basic.signupStartAt
                ? new Date(draft.basic.signupStartAt).toLocaleString()
                : '待定'}{' '}
              至{' '}
              {draft.basic.signupEndAt ? new Date(draft.basic.signupEndAt).toLocaleString() : '待定'}
            </p>
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-muted-foreground">比赛时间</p>
            <p className="font-medium">
              {draft.basic.startAt ? new Date(draft.basic.startAt).toLocaleString() : '待定'} 至{' '}
              {draft.basic.endAt ? new Date(draft.basic.endAt).toLocaleString() : '待定'}
            </p>
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-muted-foreground">地点</p>
            <p className="font-medium">{draft.basic.location || '待定'}</p>
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-muted-foreground">项目数量 / 组别数量</p>
            <p className="font-medium">
              {draft.events.length} 项 · {draft.groups.length} 组
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as DetailTab)}>
          <TabsList className="mb-4 flex flex-wrap gap-2">
            <TabsTrigger value="basic">基础信息</TabsTrigger>
            <TabsTrigger value="projects">项目与组别</TabsTrigger>
            <TabsTrigger value="rules">流程与积分</TabsTrigger>
            <TabsTrigger value="registration">报名规则</TabsTrigger>
          </TabsList>
          <TabsContent value="basic" className="space-y-4">
            <section className="space-y-3 rounded-md border border-border p-4">
              <h3 className="text-sm font-medium">赛事基础信息</h3>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="detail-name">赛事名称</Label>
                  <Input
                    id="detail-name"
                    value={draft.basic.name}
                    onChange={(event) => handleBasicChange('name', event.target.value)}
                    placeholder="请输入赛事名称"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="detail-location">赛事地点</Label>
                  <Input
                    id="detail-location"
                    value={draft.basic.location}
                    onChange={(event) => handleBasicChange('location', event.target.value)}
                    placeholder="例如：主体育场"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="detail-signup-start">报名开始时间</Label>
                  <Input
                    id="detail-signup-start"
                    type="datetime-local"
                    value={draft.basic.signupStartAt}
                    onChange={(event) => handleBasicChange('signupStartAt', event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="detail-signup-end">报名结束时间</Label>
                  <Input
                    id="detail-signup-end"
                    type="datetime-local"
                    value={draft.basic.signupEndAt}
                    onChange={(event) => handleBasicChange('signupEndAt', event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="detail-event-start">比赛开始时间</Label>
                  <Input
                    id="detail-event-start"
                    type="datetime-local"
                    value={draft.basic.startAt}
                    onChange={(event) => handleBasicChange('startAt', event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="detail-event-end">比赛结束时间</Label>
                  <Input
                    id="detail-event-end"
                    type="datetime-local"
                    value={draft.basic.endAt}
                    onChange={(event) => handleBasicChange('endAt', event.target.value)}
                  />
                </div>
              </div>
            </section>
          </TabsContent>

          <TabsContent value="projects" className="space-y-6">
            <section className="space-y-3 rounded-md border border-border p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">竞赛项目</h3>
                <Button variant="outline" size="sm" onClick={handleAddEvent}>
                  新增项目
                </Button>
              </div>
              <div className="space-y-4">
                {draft.events.length === 0 ? (
                  <p className="text-sm text-muted-foreground">尚未配置项目，点击“新增项目”开始设置。</p>
                ) : (
                  draft.events.map((event, index) => (
                    <div
                      key={`competition-event-${index}`}
                      className="rounded-md border border-dashed border-border p-4"
                    >
                      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                        <div className="grid flex-1 gap-4 md:grid-cols-2">
                          <div className="space-y-2">
                            <Label>项目名称</Label>
                            <Input
                              value={event.name}
                              onChange={(evt) => handleEventChange(index, 'name', evt.target.value)}
                              placeholder="如：100 米"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>类别</Label>
                            <select
                              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                              value={event.category}
                              onChange={(evt) =>
                                handleEventChange(index, 'category', evt.target.value as any)
                              }
                            >
                              <option value="track">径赛</option>
                              <option value="field">田赛</option>
                            </select>
                          </div>
                          <div className="space-y-2">
                            <Label>赛制</Label>
                            <select
                              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                              value={event.unitType}
                              onChange={(evt) =>
                                handleEventChange(index, 'unitType', evt.target.value as any)
                              }
                            >
                              <option value="individual">个人</option>
                              <option value="team">团体</option>
                            </select>
                          </div>
                          <div className="space-y-2">
                            <Label>备注配置（可选）</Label>
                            <Textarea
                              className="min-h-[72px]"
                              placeholder="可填写项目补充说明或 JSON 配置"
                              value={
                                event.config ? JSON.stringify(event.config, null, 2) : ''
                              }
                              onChange={(evt) =>
                                handleEventChange(
                                  index,
                                  'config',
                                  evt.target.value ? safeJsonParse(evt.target.value, {}).data : undefined
                                )
                              }
                            />
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="self-start text-destructive"
                          onClick={() => handleRemoveEvent(index)}
                        >
                          删除
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="space-y-3 rounded-md border border-border p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">组别与人群</h3>
                <Button variant="outline" size="sm" onClick={handleAddGroup}>
                  新增组别
                </Button>
              </div>
              <div className="space-y-4">
                {draft.groups.length === 0 ? (
                  <p className="text-sm text-muted-foreground">尚未配置组别，点击“新增组别”设置参赛人群。</p>
                ) : (
                  draft.groups.map((group, index) => (
                    <div
                      key={`competition-group-${index}`}
                      className="rounded-md border border-dashed border-border p-4"
                    >
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label>组别名称</Label>
                          <Input
                            value={group.name}
                            onChange={(evt) => handleGroupChange(index, 'name', evt.target.value)}
                            placeholder="如：男子甲组"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>性别限定</Label>
                          <select
                            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                            value={group.gender}
                            onChange={(evt) => handleGroupChange(index, 'gender', evt.target.value as any)}
                          >
                            <option value="male">男子</option>
                            <option value="female">女子</option>
                            <option value="mixed">混合</option>
                          </select>
                        </div>
                        <div className="space-y-2">
                          <Label>年龄段</Label>
                          <Input
                            value={group.ageBracket ?? ''}
                            onChange={(evt) => handleGroupChange(index, 'ageBracket', evt.target.value || undefined)}
                            placeholder="如：18-25"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>身份类型</Label>
                          <Input
                            value={group.identityType ?? ''}
                            onChange={(evt) =>
                              handleGroupChange(index, 'identityType', evt.target.value || undefined)
                            }
                            placeholder="如：学生 / 教师"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>参赛人数上限</Label>
                          <Input
                            type="number"
                            value={group.maxParticipants ?? ''}
                            onChange={(evt) =>
                              handleGroupChange(
                                index,
                                'maxParticipants',
                                evt.target.value ? Number(evt.target.value) : undefined
                              )
                            }
                            min={0}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>团队人数</Label>
                          <Input
                            type="number"
                            value={group.teamSize ?? ''}
                            onChange={(evt) =>
                              handleGroupChange(
                                index,
                                'teamSize',
                                evt.target.value ? Number(evt.target.value) : undefined
                              )
                            }
                            min={0}
                          />
                        </div>
                      </div>
                      <div className="mt-4 flex justify-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          onClick={() => handleRemoveGroup(index)}
                        >
                          删除组别
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </TabsContent>

          <TabsContent value="rules" className="space-y-6">
            <section className="space-y-3 rounded-md border border-border p-4">
              <h3 className="text-sm font-medium">流程配置</h3>
              <Textarea
                value={rulesText.flow}
                onChange={(event) => handleRulesTextChange('flow', event.target.value)}
                placeholder="使用 JSON 描述流程设置，例如阶段、晋级规则等"
              />
              {rulesError.flow && <p className="text-sm text-destructive">{rulesError.flow}</p>}
            </section>
            <section className="space-y-3 rounded-md border border-border p-4">
              <h3 className="text-sm font-medium">积分与判罚</h3>
              <div className="space-y-2">
                <Label>积分规则</Label>
                <Textarea
                  value={rulesText.scoring}
                  onChange={(event) => handleRulesTextChange('scoring', event.target.value)}
                  placeholder='如：{"defaultTable":[9,7,6,5,4,3,2,1]}'
                />
                {rulesError.scoring && <p className="text-sm text-destructive">{rulesError.scoring}</p>}
              </div>
              <div className="space-y-2">
                <Label>异常与判罚</Label>
                <Textarea
                  value={rulesText.penalties}
                  onChange={(event) => handleRulesTextChange('penalties', event.target.value)}
                  placeholder="描述弃权、犯规、取消成绩等处理规则"
                />
                {rulesError.penalties && (
                  <p className="text-sm text-destructive">{rulesError.penalties}</p>
                )}
              </div>
            </section>
          </TabsContent>

          <TabsContent value="registration" className="space-y-6">
            <section className="space-y-3 rounded-md border border-border p-4">
              <h3 className="text-sm font-medium">报名规则</h3>
              <p className="text-sm text-muted-foreground">
                以 JSON 方式描述报名与限制配置，系统会在保存时进行校验并同步数据库。
              </p>
              <Textarea
                value={registrationText}
                onChange={(event) => handleRegistrationChange(event.target.value)}
                placeholder="例如：{\"maxEventsPerParticipant\": 2, \"allowTeamOverlap\": false}"
              />
              {registrationError && <p className="text-sm text-destructive">{registrationError}</p>}
            </section>
            <section className="space-y-3 rounded-md border border-border p-4">
              <h3 className="text-sm font-medium">最近一次更新</h3>
              <p className="text-sm text-muted-foreground">
                {detailQuery.data?.rules?.updatedAt
                  ? new Date(detailQuery.data.rules.updatedAt).toLocaleString()
                  : '暂无记录'}
              </p>
              <p className="text-sm text-muted-foreground">
                每次保存后会记录更新时间与操作者，用于后续审计。
              </p>
            </section>
          </TabsContent>
        </Tabs>
      </CardContent>
      <CardFooter className="flex flex-col items-start gap-4 md:flex-row md:items-center md:justify-between">
        <div className="text-sm text-muted-foreground">
          {hasPendingChanges ? (
            <span>
              存在未保存的修改，请点击“保存变更”同步至后端。
              {changeSummary.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-foreground">
                  {changeSummary.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
            </span>
          ) : (
            <span>所有配置均已保存。</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onBack}>
            返回列表
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {updateMutation.isLoading ? '保存中…' : '保存变更'}
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}
