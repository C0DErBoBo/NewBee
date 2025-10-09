import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import type { TeamCompetitionOverview } from './RegistrationManager';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Input } from './ui/input';
import {
  fetchTeamMembers,
  updateTeamMembers,
  TeamMember,
  TeamMemberEvent
} from '@/services/team';
import { useAppSelector } from '@/store';
import {
  CompetitionSummary,
  fetchCompetitionDetail,
  CompetitionDetail
} from '@/services/competitions';
import { cn } from '@/lib/utils';

type MemberHistoryEntry = {
  submittedAt: string | null;
  events: string;
  group: string | null;
  statusLabel?: string;
};

type TeamMembersManagerVariant = 'page' | 'modal';

interface TeamMembersManagerProps {
  competitions: CompetitionSummary[];
  variant?: TeamMembersManagerVariant;
  open?: boolean;
  onClose?: () => void;
  initialCompetitionId?: string | null;
  highlightedCompetitionId?: string | null;
  selectedCompetitionOverview?: TeamCompetitionOverview | null;
  onCompetitionChange?: (competitionId: string | null, overview?: TeamCompetitionOverview | null) => void;
}

function cleanEvents(events: TeamMemberEvent[] = []): TeamMemberEvent[] {
  return events
    .map((event) => ({
      name: event?.name?.trim() || null,
      result: event?.result?.trim() || null
    }))
    .filter((event) => event.name || event.result)
    .slice(0, 5);
}

function normalizeMembers(members: TeamMember[]): TeamMember[] {
  return members.map((member) => ({
    name: member.name.trim(),
    gender: member.gender?.trim() || null,
    group: member.group?.trim() || null,
    events: cleanEvents(member.events ?? []),
    registered: Boolean(member.registered)
  }));
}

function parseMembersInput(raw: string): TeamMember[] {
  const lines = raw
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return [];
  }

  const parsed: TeamMember[] = [];

  lines.forEach((line, index) => {
    const cells = line.split(',').map((cell) => cell.trim());
    if (!cells[0]) {
      throw new Error(`第 ${index + 1} 行缺少姓名`);
    }

    const [name, gender = '', group = '', ...rest] = cells;
    const events: TeamMemberEvent[] = [];
    for (let i = 0; i < rest.length && events.length < 5; i += 2) {
      const eventName = rest[i] ?? '';
      const result = rest[i + 1] ?? '';
      if (!eventName && !result) continue;
      events.push({ name: eventName || null, result: result || null });
    }

    parsed.push({
      name,
      gender: gender || null,
      group: group || null,
      events
    });
  });

  return normalizeMembers(parsed);
}

function formatDateTime(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function TeamMembersManager({
  competitions,
  variant = 'page',
  open,
  onClose,
  initialCompetitionId,
  highlightedCompetitionId,
  selectedCompetitionOverview,
  onCompetitionChange
}: TeamMembersManagerProps) {
  const user = useAppSelector((state) => state.auth.user);
  const isTeamRole = user?.role === 'team';

  if (!isTeamRole) {
    return null;
  }

  const isModal = variant === 'modal';
  const isVisible = isModal ? Boolean(open) : true;

  const [membersDraft, setMembersDraft] = useState<TeamMember[]>([]);
  const [bulkInputVisible, setBulkInputVisible] = useState(false);
  const [bulkInput, setBulkInput] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [activeDropdowns, setActiveDropdowns] = useState(0);
  const [showResults, setShowResults] = useState(false);
  const [invalidGroups, setInvalidGroups] = useState<Record<number, boolean>>({});
  const [invalidEvents, setInvalidEvents] = useState<Record<string, boolean>>({});

  const registeredNameSet = useMemo(() => {
    const set = new Set<string>();
    if (selectedCompetitionOverview) {
      selectedCompetitionOverview.members.forEach((member) => {
        if (member.status !== 'cancelled') {
          const key = member.name.trim().toLowerCase();
          if (key) {
            set.add(key);
          }
        }
      });
    }
    return set;
  }, [selectedCompetitionOverview]);

  const overviewHistoryMap = useMemo(() => {
    const map = new Map<string, MemberHistoryEntry[]>();

    (selectedCompetitionOverview?.members ?? []).forEach((entry) => {
      const key = entry.name.trim().toLowerCase();
      if (!key) return;
      const history = map.get(key) ?? [];
      history.push({
        submittedAt: entry.submittedAt ?? null,
        events: entry.events ?? '—',
        group: entry.group ?? null,
        statusLabel: entry.statusLabel
      });
      map.set(key, history);
    });

    const getTimeValue = (value?: string | null) => {
      if (!value) return 0;
      const time = new Date(value).getTime();
      return Number.isNaN(time) ? 0 : time;
    };

    map.forEach((records) => {
      records.sort((a, b) => getTimeValue(b.submittedAt) - getTimeValue(a.submittedAt));
    });

    return map;
  }, [selectedCompetitionOverview]);

  const queryClient = useQueryClient();
  const competitionOptions = useMemo(() => competitions ?? [], [competitions]);

  const [selectedCompetitionId, setSelectedCompetitionId] = useState<string | null>(
    initialCompetitionId ?? competitionOptions[0]?.id ?? null
  );

  const membersQuery = useQuery({
    queryKey: ['team-members', selectedCompetitionId],
    queryFn: () => fetchTeamMembers(selectedCompetitionId),
    enabled: isVisible && Boolean(selectedCompetitionId),
    keepPreviousData: false
  });

  const handleDropdownFocus = useCallback(() => {
    setActiveDropdowns((count) => count + 1);
  }, []);

  const handleDropdownBlur = useCallback(() => {
    setTimeout(() => {
      setActiveDropdowns((count) => Math.max(count - 1, 0));
    }, 0);
  }, []);

  useEffect(() => {
    if (!isVisible) return;
    if (!selectedCompetitionId && competitionOptions[0]?.id) {
      setSelectedCompetitionId(competitionOptions[0].id);
    }
  }, [competitionOptions, selectedCompetitionId, isVisible]);

useEffect(() => {
  if (!isVisible) return;
  if (initialCompetitionId && initialCompetitionId !== selectedCompetitionId) {
    setSelectedCompetitionId(initialCompetitionId);
  }
}, [initialCompetitionId, isVisible, selectedCompetitionId]);

useEffect(() => {
  if (!isVisible) return;
  setSaveError(null);
}, [selectedCompetitionId, isVisible]);

useEffect(() => {
  if (!isVisible) return;
  if (!selectedCompetitionId) {
    setMembersDraft([]);
    return;
  }
  if (membersQuery.data) {
    const normalized = normalizeMembers(membersQuery.data.members ?? []).map((member) => ({
      ...member,
      registered:
        typeof member.registered === 'boolean'
          ? member.registered
          : registeredNameSet.has(member.name.trim().toLowerCase())
    }));
    setMembersDraft(normalized);
    return;
  }
  if (!membersQuery.isFetching) {
    setMembersDraft([]);
  }
}, [isVisible, selectedCompetitionId, membersQuery.data, membersQuery.isFetching, registeredNameSet]);

useEffect(() => {
  if (!isVisible) return;
  if (!highlightedCompetitionId) return;
  if (highlightedCompetitionId !== selectedCompetitionId) {
    setSelectedCompetitionId(highlightedCompetitionId);
  }
}, [highlightedCompetitionId, isVisible, selectedCompetitionId]);

  const competitionDetailQuery = useQuery<CompetitionDetail | undefined>({
    queryKey: ['team-members-competition-detail', selectedCompetitionId],
    queryFn: async () => {
      if (!selectedCompetitionId) return undefined;
      return fetchCompetitionDetail(selectedCompetitionId);
    },
    enabled: Boolean(selectedCompetitionId) && isVisible
  });

  const currentCompetitionSummary = useMemo(() => {
    if (!selectedCompetitionId) {
      return [] as Array<{
        name: string;
        group: string | null;
        gender: string | null;
        events: Array<{ name: string; result: string | null }>;
      }>;
    }

    const allowedEvents = new Set(
      (competitionDetailQuery.data?.events ?? [])
        .map((event) => event.name?.trim())
        .filter((value): value is string => Boolean(value))
    );

    return membersDraft
      .map((member) => {
        const filteredEvents = (member.events ?? []).filter((event) =>
          event?.name ? allowedEvents.has(event.name.trim()) : false
        );
        return {
          name: member.name,
          group: member.group ?? null,
          gender: member.gender ?? null,
          events: filteredEvents.map((event) => ({
            name: event?.name ?? '-',
            result: event?.result ?? null
          }))
        };
      })
      .filter((entry) => entry.events.length > 0);
  }, [membersDraft, selectedCompetitionId, competitionDetailQuery.data]);

  const summaryData = useMemo(() => {
    if (selectedCompetitionOverview) {
      const draftMap = new Map(membersDraft.map((member) => [member.name, member]));
      return {
        title: selectedCompetitionOverview.name,
        statusLabel: selectedCompetitionOverview.statusLabel,
        statusTone: selectedCompetitionOverview.statusTone,
        entries: selectedCompetitionOverview.members.map((member) => {
          const draft = draftMap.get(member.name);
          return {
            id: member.id,
            name: member.name,
            group: member.group ?? draft?.group ?? null,
            gender: draft?.gender ?? null,
            events: member.events,
            statusLabel: member.statusLabel,
            statusTone: member.statusTone
          };
        })
      };
    }

    const entries = currentCompetitionSummary.map((entry) => ({
      id: entry.name,
      name: entry.name,
      group: entry.group,
      gender: entry.gender,
      events:
        entry.events
          .map((event) =>
            event.result && event.result.trim()
              ? `${event.name ?? '—'}（${event.result}）`
              : event.name ?? '—'
          )
          .filter(Boolean)
          .join('，') || '—',
      statusLabel: '—',
      statusTone: 'text-muted-foreground'
    }));

    const title =
      competitionOptions.find((item) => item.id === selectedCompetitionId)?.name ?? '当前赛事';

    return {
      title,
      statusLabel: '—',
      statusTone: 'text-muted-foreground',
      entries
    };
  }, [
    selectedCompetitionOverview,
    membersDraft,
    currentCompetitionSummary,
    competitionOptions,
    selectedCompetitionId
  ]);
  const updateMutation = useMutation({
    mutationFn: ({ members, competitionId }: { members: TeamMember[]; competitionId: string }) =>
      updateTeamMembers(members, competitionId),
    onSuccess: (data, variables) => {
      const cacheKey = ['team-members', variables.competitionId] as const;
      queryClient.setQueryData(cacheKey, data);
      queryClient.invalidateQueries({ queryKey: ['team-members'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['dashboard-competitions'] });
      queryClient.invalidateQueries({ queryKey: ['registrations'] });
      setMembersDraft((prev) => {
        const normalized = normalizeMembers(data.members);
        const prevStatusMap = new Map(
          prev.map((member) => [member.name.trim().toLowerCase(), Boolean(member.registered)])
        );
        return normalized.map((member) => ({
          ...member,
          registered: prevStatusMap.get(member.name.trim().toLowerCase()) ?? false
        }));
      });
      setBulkInput('');
      setParseError(null);
      setSaveError(null);
      setBulkInputVisible(false);
      if (isModal) {
        onClose?.();
      }
    },
    onError: (error: unknown) => {
      setSaveError(error instanceof Error ? error.message : '保存失败，请稍后重试。');
    }
  });

  const isLoading = membersQuery.isLoading;
  const isSaving = updateMutation.isPending;

  const groupOptions = competitionDetailQuery.data?.groups ?? [];
  const eventOptions = competitionDetailQuery.data?.events ?? [];
  const validGroupNames = useMemo(() => {
    return new Set(
      groupOptions
        .map((group) => group?.name?.trim())
        .filter((name): name is string => Boolean(name))
    );
  }, [groupOptions]);
  const validEventNames = useMemo(() => {
    return new Set(
      eventOptions
        .map((event) => event?.name?.trim())
        .filter((name): name is string => Boolean(name))
    );
  }, [eventOptions]);
  const eventVisibility = useMemo(() => {
    const visibility = Array.from({ length: 5 }, () => false);
    visibility[0] = true;
    for (let i = 1; i < 5; i += 1) {
      visibility[i] = membersDraft.some((member) => Boolean(member.events?.[i - 1]?.name));
    }
    return visibility;
  }, [membersDraft]);
  useEffect(() => {
    const nextInvalidGroups: Record<number, boolean> = {};
    const nextInvalidEvents: Record<string, boolean> = {};

    membersDraft.forEach((member, memberIndex) => {
      const groupName = member.group?.trim();
      if (groupName && validGroupNames.size > 0 && !validGroupNames.has(groupName)) {
        nextInvalidGroups[memberIndex] = true;
      }
      member.events?.forEach((event, eventIndex) => {
        const eventName = event.name?.trim();
        if (eventName && validEventNames.size > 0 && !validEventNames.has(eventName)) {
          nextInvalidEvents[`${memberIndex}-${eventIndex}`] = true;
        }
      });
    });

    setInvalidGroups(nextInvalidGroups);
    setInvalidEvents(nextInvalidEvents);
  }, [membersDraft, validGroupNames, validEventNames]);

  useEffect(() => {
    if (
      Object.keys(invalidGroups).length === 0 &&
      Object.keys(invalidEvents).length === 0 &&
      parseError &&
      parseError.startsWith('存在无效的组别或项目')
    ) {
      setParseError(null);
    }
  }, [invalidGroups, invalidEvents, parseError]);

  const handleAddMembers = () => {
    try {
      setParseError(null);
      setSaveError(null);
      const parsed = parseMembersInput(bulkInput);
      if (!parsed.length) {
        setParseError('请至少填写一行队员数据');
        return;
      }
      const normalizedParsed = normalizeMembers(parsed);
      let hasInvalid = false;
      if (validGroupNames.size > 0 || validEventNames.size > 0) {
        normalizedParsed.forEach((member) => {
          const groupName = member.group?.trim();
          if (groupName && validGroupNames.size > 0 && !validGroupNames.has(groupName)) {
            hasInvalid = true;
          }
          member.events?.forEach((event) => {
            const eventName = event.name?.trim();
            if (eventName && validEventNames.size > 0 && !validEventNames.has(eventName)) {
              hasInvalid = true;
            }
          });
        });
      }
      setMembersDraft((prev) => normalizeMembers([...prev, ...normalizedParsed]));
      if (hasInvalid) {
        setParseError('存在无效的组别或项目，已用红色标注，请检查。');
        return;
      }
      setBulkInput('');
      setBulkInputVisible(false);
    } catch (error) {
      setParseError(error instanceof Error ? error.message : '解析失败，请检查格式');
    }
  };

  const handleMemberNameChange = (index: number, value: string) => {
    setMembersDraft((prev) =>
      prev.map((member, idx) => (idx === index ? { ...member, name: value } : member))
    );
  };

  const handleGenderChange = (index: number, value: string) => {
    setMembersDraft((prev) =>
      prev.map((member, idx) =>
        idx === index ? { ...member, gender: value || null } : member
      )
    );
  };

  const handleGroupChange = (index: number, value: string) => {
    setMembersDraft((prev) =>
      prev.map((member, idx) =>
        idx === index ? { ...member, group: value || null } : member
      )
    );
  };

  const handleEventChange = (
    memberIndex: number,
    eventIndex: number,
    field: 'name' | 'result',
    value: string
  ) => {
    setMembersDraft((prev) =>
      prev.map((member, idx) => {
        if (idx !== memberIndex) return member;
        const events = [...(member.events ?? [])];
        while (events.length <= eventIndex) {
          events.push({ name: null, result: null });
        }
        const updatedValue = value || null;
        const updated = { ...events[eventIndex], [field]: updatedValue };
        events[eventIndex] = updated;
        if (field === 'name' && !updatedValue) {
          for (let i = eventIndex + 1; i < events.length; i += 1) {
            events[i] = { name: null, result: null };
          }
        } else if (field === 'name' && updatedValue) {
          for (let i = 0; i < events.length; i += 1) {
            if (i !== eventIndex && events[i]?.name === updatedValue) {
              events[i] = { ...events[i], name: null, result: null };
            }
          }
        }
        return {
          ...member,
          events
        };
      })
    );
  };

  const handleRemoveMember = (index: number) => {
    setMembersDraft((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleRegisterMember = (index: number) => {
    const target = membersDraft[index];
    if (!selectedCompetitionId) {
      setSaveError('请选择赛事后再报名。');
      return;
    }

    if (!target) {
      return;
    }

    const hasSelectedEvents = target.events?.some((event) => event?.name);
    if (!hasSelectedEvents) {
      setSaveError('请先为该队员选择至少一个参赛项目。');
      return;
    }

    const nextDraft = membersDraft.map((member, idx) =>
      idx === index ? { ...member, registered: true } : member
    );
    setMembersDraft(nextDraft);
    setSaveError(null);
    updateMutation.mutate({
      members: normalizeMembers(nextDraft),
      competitionId: selectedCompetitionId!
    });
  };

  const handleWithdrawMember = (index: number) => {
    const target = membersDraft[index];
    if (!selectedCompetitionId) {
      setSaveError('请选择赛事后再撤销报名。');
      return;
    }

    if (!target || !target.registered) {
      setSaveError('该队员尚未报名。');
      return;
    }

    const nextDraft = membersDraft.map((member, idx) =>
      idx === index ? { ...member, registered: false } : member
    );
    setMembersDraft(nextDraft);
    setSaveError(null);
    updateMutation.mutate({
      members: normalizeMembers(nextDraft),
      competitionId: selectedCompetitionId!
    });
  };

  const handleSave = () => {
    if (!selectedCompetitionId) {
      setSaveError('请选择赛事后再保存队员信息。');
      return;
    }

    const cleaned = normalizeMembers(membersDraft).filter((member) => member.name);
    const validMembers = cleaned.filter(
      (member) => member.events && member.events.some((event) => event.name)
    );

    if (!validMembers.length) {
      setSaveError('请至少为一名队员选择参赛项目。');
      return;
    }

    if (validMembers.length < cleaned.length) {
      setSaveError('部分队员未选择项目，已跳过录入。');
    } else {
      setSaveError(null);
    }

    updateMutation.mutate({ members: cleaned, competitionId: selectedCompetitionId });
  };

  const handleClose = () => {
    setBulkInputVisible(false);
    setBulkInput('');
    setParseError(null);
    setSaveError(null);
    onClose?.();
  };

  const genders = ['', '男', '女', '混合'];

  const content = (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-medium">当前赛事</p>
          <p className="text-xs text-muted-foreground">
            请选择需要维护的赛事，以便匹配可选项目与组别。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            className="h-9 min-w-[9rem] rounded-md border border-input bg-background px-3 pr-8 text-sm text-center"
            style={{ textAlignLast: 'center' }}
            value={selectedCompetitionId ?? ''}
            onFocus={handleDropdownFocus}
            onBlur={handleDropdownBlur}
            onChange={(event) => {
              const value = event.target.value || null;
              setSelectedCompetitionId(value);
              onCompetitionChange?.(value, null);
            }}
          >
            {!selectedCompetitionId && (
              <option value="" className="text-center">
                选择赛事
              </option>
            )}
            {competitionOptions.map((item) => (
              <option key={item.id} value={item.id} className="text-center">
                {item.name}
              </option>
            ))}
          </select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => membersQuery.refetch()}
            disabled={!selectedCompetitionId || membersQuery.isFetching}
          >
            {membersQuery.isFetching ? '刷新中...' : '刷新数据'}
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={() => setBulkInputVisible((prev) => !prev)}
          >
            <Plus className="mr-2 h-4 w-4" /> 批量添加队员
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowResults((prev) => !prev)}
          >
            {showResults ? '隐藏成绩列' : '显示成绩列'}
          </Button>
        </div>
      </div>

      {bulkInputVisible && (
        <div className="space-y-3 rounded-md border border-dashed border-border p-4">
          <p className="text-xs text-muted-foreground">
            每行代表一名队员，格式：姓名,性别,组别,项目一,成绩一,...,项目五,成绩五。
          </p>
          <Textarea
            value={bulkInput}
            onChange={(event) => setBulkInput(event.target.value)}
            placeholder="示例：张三,男,青年组,100米,11.20s,200米,22.90s"
            className="h-40"
          />
          {parseError && <p className="text-xs text-destructive">{parseError}</p>}
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setBulkInput('');
                setParseError(null);
                setBulkInputVisible(false);
              }}
            >
              取消
            </Button>
            <Button size="sm" onClick={handleAddMembers}>
              解析并添加
            </Button>
          </div>
        </div>
      )}

      <div
        className={cn(
          'rounded-md border border-border overflow-x-auto',
          activeDropdowns > 0 ? 'overflow-y-visible' : 'overflow-y-hidden'
        )}
      >
        <table className="min-w-[1100px] text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-center">姓名</th>
              <th className="px-3 py-2 text-center">性别</th>
              <th className="px-3 py-2 text-center">组别</th>
              {[0, 1, 2, 3, 4].map((index) =>
                eventVisibility[index] ? (
                  <Fragment key={`event-header-${index}`}>
                    <th className="px-3 py-2 text-center">项目{index + 1}</th>
                    {showResults && (
                      <th className="px-3 py-2 text-center">成绩{index + 1}</th>
                    )}
                  </Fragment>
                ) : null
              )}
              <th className="px-3 py-2 text-center">操作</th>
              <th className="px-3 py-2 text-center">报名时间</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={16} className="px-3 py-6 text-center text-sm text-muted-foreground">
                  加载中...
                </td>
              </tr>
            ) : membersDraft.length === 0 ? (
              <tr>
                <td colSpan={16} className="px-3 py-6 text-center text-sm text-muted-foreground">
                  暂无队员数据，点击“批量添加队员”快速录入。
                </td>
              </tr>
            ) : (
              membersDraft.map((member, memberIndex) => {
                const groupHasError = Boolean(invalidGroups[memberIndex]);
                const groupSelectClass = cn(
                  'h-9 w-full min-w-[12rem] rounded-md border border-input bg-background px-3 pr-8 text-sm text-center',
                  groupHasError ? 'border-destructive text-destructive focus-visible:ring-destructive/40' : ''
                );
                const genderSelectClass =
                  'h-9 w-full min-w-[8rem] rounded-md border border-input bg-background px-3 pr-8 text-sm text-center';
                const hasSelectedEvents = Boolean(member.events?.some((event) => event?.name));
                const isRegistered = Boolean(member.registered);
                const rowTone = isRegistered
                  ? 'bg-emerald-400/70'
                  : hasSelectedEvents
                    ? 'bg-orange-400/70'
                    : '';
                const historyRecords =
                  overviewHistoryMap.get(member.name.trim().toLowerCase()) ?? [];
                const formattedHistory = historyRecords.map((record) => ({
                  time: formatDateTime(record.submittedAt),
                  group: record.group ?? '—',
                  events: record.events || '—',
                  statusLabel: record.statusLabel ?? '已报名'
                }));
                const historyTooltip = formattedHistory.length
                  ? formattedHistory
                      .map(
                        (record) =>
                          `${record.time}｜${record.group}｜${record.events}｜${record.statusLabel}`
                      )
                      .join('\n')
                  : '暂无历史记录';
                const historyPreview = formattedHistory.slice(0, 5);
                const latestHistory = historyPreview[0] ?? null;
                return (
                  <tr
                    key={`member-${memberIndex}`}
                    className={cn(
                      'border-t border-border transition-colors',
                      rowTone
                    )}
                  >
                    <td className="px-3 py-3 text-center">
                      <Input
                        value={member.name}
                        onChange={(event) => handleMemberNameChange(memberIndex, event.target.value)}
                        placeholder="请输入姓名"
                        className="h-9 min-w-[10rem] text-center"
                      />
                    </td>
                    <td className="px-3 py-3 text-center">
                      <select
                        className={genderSelectClass}
                        style={{ textAlignLast: 'center' }}
                        value={member.gender ?? ''}
                        onFocus={handleDropdownFocus}
                        onBlur={handleDropdownBlur}
                        onChange={(event) => handleGenderChange(memberIndex, event.target.value)}
                      >
                        {genders.map((gender) => (
                          <option key={gender || 'empty'} value={gender} className="text-center">
                            {gender ? gender : '未选择'}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <select
                        className={groupSelectClass}
                        style={{ textAlignLast: 'center' }}
                        value={member.group ?? ''}
                        onFocus={handleDropdownFocus}
                        onBlur={handleDropdownBlur}
                        onChange={(event) => handleGroupChange(memberIndex, event.target.value)}
                      >
                        <option value="" className="text-center">
                          未选择
                        </option>
                        {groupHasError && member.group ? (
                          <option value={member.group ?? ''} className="text-center">
                            {member.group}（无效）
                          </option>
                        ) : null}
                        {groupOptions.map((group) => (
                          <option key={group.id ?? group.name} value={group.name} className="text-center">
                            {group.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    {[0, 1, 2, 3, 4].map((eventIndex) => {
                      if (!eventVisibility[eventIndex]) {
                        return null;
                      }
                      const previousEvent = eventIndex > 0 ? member.events?.[eventIndex - 1] : null;
                      const event = member.events?.[eventIndex] ?? { name: null, result: null };
                      const canEditEvent = eventIndex === 0 || Boolean(previousEvent?.name);
                      const eventKey = `${memberIndex}-${eventIndex}`;
                      const eventHasError = Boolean(invalidEvents[eventKey]);
                      const previousSelectedNames = new Set(
                        (member.events ?? [])
                          .slice(0, eventIndex)
                          .map((item) => item?.name?.trim())
                          .filter((name): name is string => Boolean(name))
                      );
                      const currentEventName = event.name?.trim() ?? '';
                      const filteredEventOptions = eventOptions.filter((option) => {
                        const optionName = option?.name?.trim();
                        if (!optionName) return false;
                        if (previousSelectedNames.has(optionName) && optionName !== currentEventName) {
                          return false;
                        }
                        return true;
                      });
                      const eventSelectClass = cn(
                        'h-9 w-full min-w-[12rem] rounded-md border border-input bg-background px-3 pr-8 text-sm text-center',
                        eventHasError ? 'border-destructive text-destructive focus-visible:ring-destructive/40' : ''
                      );
                      return (
                        <Fragment key={`event-${memberIndex}-${eventIndex}`}>
                          <td className="px-3 py-3 text-center">
                            {canEditEvent ? (
                              <select
                                className={eventSelectClass}
                                style={{ textAlignLast: 'center' }}
                                value={event.name ?? ''}
                                onFocus={handleDropdownFocus}
                                onBlur={handleDropdownBlur}
                                onChange={(eventChange) =>
                                  handleEventChange(memberIndex, eventIndex, 'name', eventChange.target.value)
                                }
                              >
                                <option value="" className="text-center">
                                  未选择
                                </option>
                                {eventHasError && currentEventName ? (
                                  <option value={event.name ?? ''} className="text-center">
                                    {event.name}（无效）
                                  </option>
                                ) : null}
                                {filteredEventOptions.map((option) => (
                                  <option
                                    key={option.id ?? option.name}
                                    value={option.name}
                                    className="text-center"
                                  >
                                    {option.name}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <div className="flex h-9 min-w-[12rem] items-center justify-center rounded-md border border-dashed border-border/60 bg-muted/30 px-3 text-sm text-muted-foreground">
                                —
                              </div>
                            )}
                          </td>
                          {showResults && (
                            <td className="px-3 py-3 text-center">
                              {canEditEvent && event.name ? (
                                <Input
                                  value={event.result ?? ''}
                                  onChange={(eventChange) =>
                                    handleEventChange(memberIndex, eventIndex, 'result', eventChange.target.value)
                                  }
                                  placeholder="成绩"
                                  className="h-9 min-w-[8rem] text-center"
                                />
                              ) : (
                                <div className="flex h-9 min-w-[8rem] items-center justify-center rounded-md border border-dashed border-border/60 bg-muted/30 px-3 text-sm text-muted-foreground">
                                  —
                                </div>
                              )}
                            </td>
                          )}
                        </Fragment>
                      );
                    })}
                    <td className="px-3 py-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className={cn(
                            'min-w-[72px]',
                            isRegistered
                              ? 'border-orange-500 text-orange-700 hover:bg-orange-50'
                              : hasSelectedEvents
                                ? 'border-orange-400 text-orange-600 hover:bg-orange-50'
                                : 'border-border text-muted-foreground cursor-not-allowed'
                          )}
                          onClick={() =>
                            isRegistered
                              ? handleWithdrawMember(memberIndex)
                              : handleRegisterMember(memberIndex)
                          }
                          disabled={
                            isSaving ||
                            !selectedCompetitionId ||
                            (!isRegistered && !hasSelectedEvents)
                          }
                        >
                          {isRegistered ? '撤销' : '报名'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          onClick={() => handleRemoveMember(memberIndex)}
                          disabled={isSaving}
                        >
                          删除
                        </Button>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-center align-top">
                      <div className="flex flex-col items-center gap-1 text-xs text-muted-foreground">
                        <span className="text-sm font-medium text-foreground">
                          {latestHistory ? latestHistory.time : '—'}
                        </span>
                        <div
                          className="max-h-28 w-full min-w-[12rem] overflow-y-auto rounded-md border border-border/60 bg-muted/30 px-2 py-1 text-[10px] leading-relaxed break-words"
                          title={historyTooltip}
                        >
                          {historyPreview.length ? (
                            historyPreview.map((record, idx) => (
                              <div
                                key={`${record.time}-${record.group}-${idx}`}
                                className="flex flex-col items-center gap-0.5 text-center"
                              >
                                <span
                                  className={cn(
                                    'font-medium',
                                    idx === 0 ? 'text-foreground' : 'text-muted-foreground'
                                  )}
                                >
                                  {record.time}
                                </span>
                                <span className="text-muted-foreground/80">
                                  {record.group}｜{record.events}
                                </span>
                                <span className="text-muted-foreground/70">{record.statusLabel}</span>
                                {idx < historyPreview.length - 1 && (
                                  <span className="my-1 block h-px w-full bg-border/60" />
                                )}
                              </div>
                            ))
                          ) : (
                            <span className="text-muted-foreground/70">暂无历史记录</span>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {selectedCompetitionId && (
        <div className="space-y-3 rounded-md border border-border bg-muted/30 p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h4 className="text-sm font-semibold">当前赛事报名汇总</h4>
              <p className="text-xs text-muted-foreground">{summaryData.title}</p>
            </div>
            <div className="flex flex-col items-end gap-1 text-right">
              <span className={`text-xs font-medium ${summaryData.statusTone}`}>
                {summaryData.statusLabel}
              </span>
              <span className="text-xs text-muted-foreground">
                共 {summaryData.entries.length} 名队员
              </span>
            </div>
          </div>
          {summaryData.entries.length ? (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-muted/60 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">队员</th>
                    <th className="px-3 py-2">组别</th>
                    <th className="px-3 py-2">性别</th>
                    <th className="px-3 py-2">项目 & 成绩</th>
                    <th className="px-3 py-2 text-right">状态</th>
                  </tr>
                </thead>
                <tbody>
                  {summaryData.entries.map((entry) => (
                    <tr key={entry.id} className="border-t border-border">
                      <td className="px-3 py-2 font-medium">{entry.name}</td>
                      <td className="px-3 py-2">{entry.group ?? '—'}</td>
                      <td className="px-3 py-2">{entry.gender ?? '—'}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{entry.events}</td>
                      <td className="px-3 py-2 text-right">
                        <span className={`text-xs font-medium ${entry.statusTone ?? 'text-muted-foreground'}`}>
                          {entry.statusLabel ?? '—'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              当前赛事暂未匹配到报名数据，请在报名管理中完成队员报名后再查看。
            </p>
          )}
        </div>
      )}

      {saveError && <p className="text-xs text-destructive text-right">{saveError}</p>}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-xs text-muted-foreground">共 {membersDraft.length} 名队员</span>
        <div className="flex items-center gap-2">
          {isModal && (
            <Button variant="outline" onClick={handleClose} disabled={isSaving}>
              关闭
            </Button>
          )}
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 保存中...
              </>
            ) : (
              '保存更改'
            )}
          </Button>
        </div>
      </div>
    </div>
  );

  if (!isVisible) {
    return null;
  }

  if (isModal) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur">
        <div className="w-full max-w-5xl rounded-lg border border-border bg-card p-6 shadow-xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold">队员管理</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                批量维护队伍报名名单，支持按赛事切换并调整参赛项目与成绩。
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-foreground"
              onClick={handleClose}
              aria-label="关闭"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="mt-4">{content}</div>
        </div>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>队员管理</CardTitle>
        <CardDescription>
          维护队伍报名名单，可按赛事切换并使用下拉框调整组别与参赛项目。
        </CardDescription>
      </CardHeader>
      <CardContent>{content}</CardContent>
    </Card>
  );
}





