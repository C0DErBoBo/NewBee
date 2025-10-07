import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle
} from './ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import {
  CompetitionEventInput,
  CompetitionGroupInput,
  CompetitionRuleInput,
  CompetitionSummary,
  createCompetition,
  fetchCompetitions,
  fetchEventTemplates
} from '@/services/competitions';

interface WizardProps {
  onCreated?: (competitionId: string) => void;
}

type StepKey = 'basic' | 'events' | 'groups' | 'rules' | 'confirm';

const steps: Array<{ key: StepKey; label: string }> = [
  { key: 'basic', label: '基础信息' },
  { key: 'events', label: '项目配置' },
  { key: 'groups', label: '组别设置' },
  { key: 'rules', label: '赛制规则' },
  { key: 'confirm', label: '确认提交' }
];

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
    waiver: ['赛前 24 小时书面说明']
  }
};

const DEFAULT_GROUPS: CompetitionGroupInput[] = [
  { name: '男子组', gender: 'male', ageBracket: '18-25', identityType: '学生' },
  { name: '女子组', gender: 'female', ageBracket: '18-25', identityType: '学生' }
];

const DATE_INPUT_FORMAT = 'datetime-local';

const toIsoString = (value: string) =>
  value ? new Date(value).toISOString() : undefined;

const currentIso = () => new Date().toISOString().slice(0, 16);

export function CompetitionWizard({ onCreated }: WizardProps) {
  const [currentStep, setCurrentStep] = useState<StepKey>('basic');
  const [name, setName] = useState('校运会');
  const [location, setLocation] = useState('田径场');
  const [signupStartAt, setSignupStartAt] = useState(currentIso());
  const [signupEndAt, setSignupEndAt] = useState(currentIso());
  const [eventStartAt, setEventStartAt] = useState('');
  const [eventEndAt, setEventEndAt] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<CompetitionEventInput[]>([]);
  const [customEvent, setCustomEvent] = useState<{
    name: string;
    category: CompetitionEventInput['category'];
    unitType: CompetitionEventInput['unitType'];
  }>({ name: '', category: 'track', unitType: 'individual' });
  const [groups, setGroups] = useState<CompetitionGroupInput[]>(DEFAULT_GROUPS);
  const [rules, setRules] = useState<CompetitionRuleInput>(defaultRules);
  const [submissionMessage, setSubmissionMessage] = useState<string | null>(null);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [competitionList, setCompetitionList] = useState<CompetitionSummary[]>([]);

  const templatesQuery = useQuery({
    queryKey: ['event-templates'],
    queryFn: fetchEventTemplates
  });

  const listQuery = useQuery({
    queryKey: ['competitions'],
    queryFn: fetchCompetitions,
    onSuccess: setCompetitionList
  });

  const createMutation = useMutation({
    mutationFn: createCompetition,
    onSuccess: (competition) => {
      setSubmissionMessage('赛事创建成功');
      setSubmissionError(null);
      listQuery.refetch();
      if (onCreated) {
        onCreated(competition.id);
      }
    },
    onError: (error: unknown) => {
      setSubmissionError(
        error instanceof Error ? error.message : '创建赛事失败，请稍后重试'
      );
    }
  });

  useEffect(() => {
    if (templatesQuery.data?.length && selectedEvents.length === 0) {
      setSelectedEvents(templatesQuery.data.slice(0, 5));
    }
  }, [templatesQuery.data, selectedEvents.length]);

  const competitionPayload = useMemo(() => ({
    name,
    location,
    signupStartAt: toIsoString(signupStartAt)!,
    signupEndAt: toIsoString(signupEndAt)!,
    startAt: toIsoString(eventStartAt),
    endAt: toIsoString(eventEndAt),
    events: selectedEvents,
    groups,
    rules
  }), [name, location, signupStartAt, signupEndAt, eventStartAt, eventEndAt, selectedEvents, groups, rules]);

  const canProceed = useMemo(() => {
    switch (currentStep) {
      case 'basic':
        return (
          name.trim().length > 0 &&
          signupStartAt.trim().length > 0 &&
          signupEndAt.trim().length > 0
        );
      case 'events':
        return selectedEvents.length > 0;
      case 'groups':
        return groups.length > 0;
      default:
        return true;
    }
  }, [currentStep, name, signupStartAt, signupEndAt, selectedEvents.length, groups.length]);

  const handleAddCustomEvent = () => {
    if (!customEvent.name.trim()) return;
    setSelectedEvents((prev) => [
      ...prev,
      {
        name: customEvent.name.trim(),
        category: customEvent.category,
        unitType: customEvent.unitType,
        isCustom: true
      }
    ]);
    setCustomEvent({ name: '', category: 'track', unitType: 'individual' });
  };

  const handleAddGroup = () => {
    setGroups((prev) => [
      ...prev,
      {
        name: `新增组别${prev.length + 1}`,
        gender: 'mixed',
        identityType: '不限'
      }
    ]);
  };

  const handleRemoveGroup = (index: number) => {
    setGroups((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleSubmit = async () => {
    setSubmissionMessage(null);
    setSubmissionError(null);
    await createMutation.mutateAsync(competitionPayload);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>赛事配置向导</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <Tabs value={currentStep} onValueChange={(value) => setCurrentStep(value as StepKey)}>
          <TabsList className="grid grid-cols-5 gap-2">
            {steps.map((step) => (
              <TabsTrigger key={step.key} value={step.key}>
                {step.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="basic" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="competition-name">赛事名称</Label>
              <Input
                id="competition-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="例如：2025 校园田径运动会"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="competition-location">举办地点</Label>
              <Input
                id="competition-location"
                value={location}
                onChange={(event) => setLocation(event.target.value)}
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="signup-start">报名开始时间</Label>
                <Input
                  id="signup-start"
                  type={DATE_INPUT_FORMAT}
                  value={signupStartAt}
                  onChange={(event) => setSignupStartAt(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="signup-end">报名结束时间</Label>
                <Input
                  id="signup-end"
                  type={DATE_INPUT_FORMAT}
                  value={signupEndAt}
                  onChange={(event) => setSignupEndAt(event.target.value)}
                  required
                />
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="event-start">比赛开始时间</Label>
                <Input
                  id="event-start"
                  type={DATE_INPUT_FORMAT}
                  value={eventStartAt}
                  onChange={(event) => setEventStartAt(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="event-end">比赛结束时间</Label>
                <Input
                  id="event-end"
                  type={DATE_INPUT_FORMAT}
                  value={eventEndAt}
                  onChange={(event) => setEventEndAt(event.target.value)}
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="events" className="space-y-4">
            <p className="text-sm text-muted-foreground">
              选择或新增竞赛项目，每个项目可标记为团体或个人。
            </p>
            <div className="grid gap-2 md:grid-cols-2">
              {templatesQuery.data?.map((event) => {
                const checked = selectedEvents.some((item) => item.name === event.name);
                return (
                  <label
                    key={event.name}
                    className="flex items-center justify-between rounded-md border border-border p-3 text-sm"
                  >
                    <span>
                      {event.name} · {event.category === 'track' ? '径赛' : '田赛'} ·
                      {event.unitType === 'team' ? '团体' : '个人'}
                    </span>
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={checked}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedEvents((prev) => [...prev, event]);
                        } else {
                          setSelectedEvents((prev) =>
                            prev.filter((item) => item.name !== event.name)
                          );
                        }
                      }}
                    />
                  </label>
                );
              })}
            </div>
            <div className="space-y-2 rounded-md border border-dashed border-border p-4">
              <p className="text-sm font-medium">自定义项目</p>
              <div className="grid gap-2 md:grid-cols-3">
                <Input
                  placeholder="项目名称"
                  value={customEvent.name}
                  onChange={(event) =>
                    setCustomEvent((prev) => ({ ...prev, name: event.target.value }))
                  }
                />
                <select
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={customEvent.category}
                  onChange={(event) =>
                    setCustomEvent((prev) => ({
                      ...prev,
                      category: event.target.value as CompetitionEventInput['category']
                    }))
                  }
                >
                  <option value="track">径赛类</option>
                  <option value="field">田赛类</option>
                </select>
                <select
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={customEvent.unitType}
                  onChange={(event) =>
                    setCustomEvent((prev) => ({
                      ...prev,
                      unitType: event.target.value as CompetitionEventInput['unitType']
                    }))
                  }
                >
                  <option value="individual">个人赛</option>
                  <option value="team">团体赛</option>
                </select>
              </div>
              <Button type="button" variant="secondary" onClick={handleAddCustomEvent}>
                添加项目
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="groups" className="space-y-4">
            <p className="text-sm text-muted-foreground">
              配置参赛组别、报名限制和团队人数等信息。
            </p>
            <div className="space-y-3">
              {groups.map((group, index) => (
                <div key={index} className="rounded-md border border-border p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{group.name}</span>
                    <Button variant="ghost" type="button" onClick={() => handleRemoveGroup(index)}>
                      删除
                    </Button>
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    <Input
                      value={group.name}
                      onChange={(event) =>
                        setGroups((prev) =>
                          prev.map((item, idx) =>
                            idx === index ? { ...item, name: event.target.value } : item
                          )
                        )
                      }
                    />
                    <select
                      className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                      value={group.gender}
                      onChange={(event) =>
                        setGroups((prev) =>
                          prev.map((item, idx) =>
                            idx === index
                              ? {
                                  ...item,
                                  gender: event.target.value as CompetitionGroupInput['gender']
                                }
                              : item
                          )
                        )
                      }
                    >
                      <option value="male">男子</option>
                      <option value="female">女子</option>
                      <option value="mixed">混合</option>
                    </select>
                    <Input
                      placeholder="身份类型"
                      value={group.identityType ?? ''}
                      onChange={(event) =>
                        setGroups((prev) =>
                          prev.map((item, idx) =>
                            idx === index
                              ? { ...item, identityType: event.target.value }
                              : item
                          )
                        )
                      }
                    />
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    <Input
                      placeholder="年龄段"
                      value={group.ageBracket ?? ''}
                      onChange={(event) =>
                        setGroups((prev) =>
                          prev.map((item, idx) =>
                            idx === index
                              ? { ...item, ageBracket: event.target.value }
                              : item
                          )
                        )
                      }
                    />
                    <Input
                      placeholder="最大参赛人数"
                      type="number"
                      value={group.maxParticipants ?? ''}
                      onChange={(event) =>
                        setGroups((prev) =>
                          prev.map((item, idx) =>
                            idx === index
                              ? {
                                  ...item,
                                  maxParticipants: event.target.value
                                    ? Number(event.target.value)
                                    : undefined
                                }
                              : item
                          )
                        )
                      }
                    />
                    <Input
                      placeholder="团队人数限制"
                      type="number"
                      value={group.teamSize ?? ''}
                      onChange={(event) =>
                        setGroups((prev) =>
                          prev.map((item, idx) =>
                            idx === index
                              ? {
                                  ...item,
                                  teamSize: event.target.value
                                    ? Number(event.target.value)
                                    : undefined
                                }
                              : item
                          )
                        )
                      }
                    />
                  </div>
                </div>
              ))}
              <Button type="button" variant="secondary" onClick={handleAddGroup}>
                新增组别
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="rules" className="space-y-4">
            <p className="text-sm text-muted-foreground">
              设置竞赛流程、评分方式和异常处理规则，可根据赛事需求随时调整。
            </p>
            <div className="space-y-2">
              <Label>积分规则（JSON）</Label>
              <textarea
                className="min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={JSON.stringify(rules.scoring ?? {}, null, 2)}
                onChange={(event) =>
                  setRules((prev) => ({
                    ...prev,
                    scoring: safeJsonParse(event.target.value, prev.scoring)
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>流程配置（JSON）</Label>
              <textarea
                className="min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={JSON.stringify(rules.flow ?? {}, null, 2)}
                onChange={(event) =>
                  setRules((prev) => ({
                    ...prev,
                    flow: safeJsonParse(event.target.value, prev.flow)
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>异常与判罚规则（JSON）</Label>
              <textarea
                className="min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={JSON.stringify(rules.penalties ?? {}, null, 2)}
                onChange={(event) =>
                  setRules((prev) => ({
                    ...prev,
                    penalties: safeJsonParse(event.target.value, prev.penalties)
                  }))
                }
              />
            </div>
          </TabsContent>

          <TabsContent value="confirm" className="space-y-4">
            <p className="text-sm text-muted-foreground">
              确认以下配置后点击提交。提交后仍可进入赛事管理进行修改。
            </p>
            <pre className="max-h-64 overflow-auto rounded-md bg-muted p-4 text-xs">
              {JSON.stringify(competitionPayload, null, 2)}
            </pre>
          </TabsContent>
        </Tabs>
      </CardContent>
      <CardFooter className="flex flex-col items-stretch gap-3 md:flex-row md:items-center md:justify-between">
        <div className="space-x-2">
          <Button
            type="button"
            variant="outline"
            disabled={currentStep === 'basic'}
            onClick={() => {
              const index = steps.findIndex((step) => step.key === currentStep);
              if (index > 0) {
                setCurrentStep(steps[index - 1].key);
              }
            }}
          >
            上一步
          </Button>
          {currentStep !== 'confirm' ? (
            <Button
              type="button"
              disabled={!canProceed}
              onClick={() => {
                const index = steps.findIndex((step) => step.key === currentStep);
                if (index < steps.length - 1) {
                  setCurrentStep(steps[index + 1].key);
                }
              }}
            >
              下一步
            </Button>
          ) : (
            <Button type="button" onClick={handleSubmit} disabled={createMutation.isPending}>
              {createMutation.isPending ? '提交中...' : '提交赛事配置'}
            </Button>
          )}
        </div>
        <div className="flex-1 text-right text-sm">
          {submissionMessage && (
            <span className="text-green-600 dark:text-green-500">{submissionMessage}</span>
          )}
          {submissionError && <span className="text-destructive">{submissionError}</span>}
        </div>
      </CardFooter>

      {competitionList.length > 0 && (
        <CardFooter className="flex-col items-start gap-3 border-t border-border bg-muted/30 p-6">
          <h3 className="text-sm font-semibold">近期创建赛事</h3>
          <div className="w-full overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-2 pr-4">名称</th>
                  <th className="py-2 pr-4">报名时间</th>
                  <th className="py-2 pr-4">比赛时间</th>
                  <th className="py-2 pr-4">地点</th>
                  <th className="py-2 pr-4 text-right">报名人数 / 团队</th>
                </tr>
              </thead>
              <tbody>
                {competitionList.map((item) => (
                  <tr key={item.id} className="border-t border-border">
                    <td className="py-2 pr-4 font-medium">{item.name}</td>
                    <td className="py-2 pr-4">
                      {formatRange(item.signupStartAt, item.signupEndAt)}
                    </td>
                    <td className="py-2 pr-4">{formatRange(item.startAt, item.endAt)}</td>
                    <td className="py-2 pr-4">{item.location ?? '-'}</td>
                    <td className="py-2 pr-4 text-right">
                      {item.stats.participantCount} / {item.stats.teamCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardFooter>
      )}
    </Card>
  );
}

function safeJsonParse<T>(value: string, fallback: T | undefined): T | undefined {
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    console.warn('JSON 解析失败', error);
    return fallback;
  }
}

function formatRange(start?: string, end?: string) {
  if (!start && !end) return '-';
  const startText = start ? new Date(start).toLocaleString() : '待定';
  const endText = end ? new Date(end).toLocaleString() : '待定';
  return `${startText} ~ ${endText}`;
}
