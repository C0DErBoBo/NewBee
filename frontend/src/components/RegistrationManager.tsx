import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import {
  RegistrationListResponse,
  RegistrationStatus,
  cancelRegistration,
  fetchRegistrations,
  updateRegistration
} from '@/services/registrations';
import { CompetitionSummary } from '@/services/competitions';
import { useAppSelector } from '@/store';

interface RegistrationManagerProps {
  competitions: CompetitionSummary[];
  externalCompetitionId?: string | null;
  onExternalCompetitionConsumed?: () => void;
}

const statusOptions: Array<{ label: string; value: RegistrationStatus | '' }> = [
  { label: '全部状态', value: '' },
  { label: '待审核', value: 'pending' },
  { label: '已通过', value: 'approved' },
  { label: '已驳回', value: 'rejected' },
  { label: '已撤销', value: 'cancelled' }
];

function formatStatus(status: RegistrationStatus) {
  switch (status) {
    case 'pending':
      return '待审核';
    case 'approved':
      return '已报名';
    case 'rejected':
      return '已驳回';
    case 'cancelled':
      return '已撤销';
    default:
      return status;
  }
}

function statusTone(status: RegistrationStatus) {
  switch (status) {
    case 'approved':
      return 'text-green-600 dark:text-green-500';
    case 'rejected':
      return 'text-destructive';
    case 'cancelled':
      return 'text-muted-foreground';
    default:
      return 'text-amber-600 dark:text-amber-500';
  }
}

function aggregateStatus(statuses: RegistrationStatus[]): RegistrationStatus | 'mixed' {
  const unique = Array.from(new Set(statuses));
  return unique.length === 1 ? unique[0] : 'mixed';
}

function aggregateStatusLabel(statuses: RegistrationStatus[]): { label: string; tone: string } {
  const aggregated = aggregateStatus(statuses);
  if (aggregated === 'mixed') {
    return { label: '状态不一', tone: 'text-muted-foreground' };
  }
  return { label: formatStatus(aggregated), tone: statusTone(aggregated) };
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatSelections(selections: { eventName: string | null; eventId: string | null }[]) {
  const names = selections
    .map((selection) => selection.eventName ?? selection.eventId ?? '')
    .filter(Boolean);
  return names.length ? names.join('、') : '-';
}

export function RegistrationManager({
  competitions,
  externalCompetitionId,
  onExternalCompetitionConsumed
}: RegistrationManagerProps) {
  const user = useAppSelector((state) => state.auth.user);
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<RegistrationStatus | ''>('');
  const [competitionFilter, setCompetitionFilter] = useState<string | ''>('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (!externalCompetitionId) return;
    setCompetitionFilter(externalCompetitionId);
    setStatusFilter('');
    setPage(1);
    onExternalCompetitionConsumed?.();
  }, [externalCompetitionId, onExternalCompetitionConsumed]);

  const { data, isLoading, isFetching } = useQuery<RegistrationListResponse>({
    queryKey: ['registrations', { statusFilter, competitionFilter, page }],
    queryFn: () =>
      fetchRegistrations({
        status: statusFilter || undefined,
        competitionId: competitionFilter || undefined,
        page
      }),
    enabled: Boolean(user)
  });

  const approveMutation = useMutation({
    mutationFn: (vars: { id: string; status: RegistrationStatus }) =>
      updateRegistration(vars.id, { status: vars.status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['registrations'] });
    }
  });

  const remarkMutation = useMutation({
    mutationFn: (vars: { id: string; remark: string }) =>
      updateRegistration(vars.id, { remark: vars.remark }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['registrations'] });
    }
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => cancelRegistration(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['registrations'] });
    }
  });

  const summary = useMemo(() => {
    if (!data) return { pending: 0, approved: 0, rejected: 0, cancelled: 0 };
    return data.registrations.reduce(
      (acc, item) => {
        acc[item.status] += 1;
        return acc;
      },
      { pending: 0, approved: 0, rejected: 0, cancelled: 0 }
    );
  }, [data]);

  const groupedTeams = useMemo(() => {
    if (!competitionFilter || !data) return [] as Array<{
      id: string;
      name: string;
      statusLabel: string;
      statusTone: string;
      members: Array<{
        id: string;
        name: string;
        statusLabel: string;
        statusTone: string;
        events: string;
        group: string | null;
      }>;
    }>;

    const map = new Map<
      string,
      {
        id: string;
        name: string;
        statuses: RegistrationStatus[];
        members: Array<{
          id: string;
          name: string;
          status: RegistrationStatus;
          events: string;
          group: string | null;
        }>;
      }
    >();

    data.registrations
      .filter((registration) => registration.competitionId === competitionFilter)
      .forEach((registration) => {
        if (statusFilter && registration.status !== statusFilter) {
          return;
        }
        const key = registration.team?.id ?? `individual-${registration.id}`;
        const displayName = registration.team?.name ?? `${registration.participant.name}（个人）`;

        if (!map.has(key)) {
          map.set(key, {
            id: key,
            name: displayName,
            statuses: [],
            members: []
          });
        }

        const group = map.get(key)!;
        group.statuses.push(registration.status);
        group.members.push({
          id: registration.id,
          name: registration.participant.name,
          status: registration.status,
          events: formatSelections(registration.selections),
          group: registration.participant.organization ?? registration.participant.identityType ?? null
        });
      });

    return Array.from(map.values()).map((group) => {
      const { label, tone } = aggregateStatusLabel(group.statuses);
      return {
        id: group.id,
        name: group.name,
        statusLabel: label,
        statusTone: tone,
        members: group.members.map((member) => ({
          id: member.id,
          name: member.name,
          statusLabel: formatStatus(member.status),
          statusTone: statusTone(member.status),
          events: member.events,
          group: member.group
        }))
      };
    });
  }, [competitionFilter, data]);

  const isTeamRole = user?.role === 'team';
  const canManageApproval = user?.role === 'admin' || user?.role === 'organizer';
  const canCancel = user?.role === 'team' || user?.role === 'participant' || canManageApproval;

  const pageSize = data?.pagination.pageSize ?? 20;
  const total = data?.pagination.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const registeredCompetitions = useMemo(() => {
    if (!isTeamRole || !data) return [];
    const map = new Map<
      string,
      {
        id: string;
        name: string;
        status: RegistrationStatus;
        submittedAt: string;
        events: string;
      }
    >();

    data.registrations.forEach((registration) => {
      const existing = map.get(registration.competitionId);
      const eventText = formatSelections(registration.selections);
      if (!existing) {
        map.set(registration.competitionId, {
          id: registration.competitionId,
          name: registration.competitionName,
          status: registration.status,
          submittedAt: registration.createdAt,
          events: eventText
        });
        return;
      }

      if (new Date(registration.createdAt).getTime() > new Date(existing.submittedAt).getTime()) {
        map.set(registration.competitionId, {
          id: registration.competitionId,
          name: registration.competitionName,
          status: registration.status,
          submittedAt: registration.createdAt,
          events: eventText
        });
      }
    });

    return Array.from(map.values());
  }, [data, isTeamRole]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>报名管理</CardTitle>
        <CardDescription>
          {isTeamRole
            ? '查看队伍已报名的赛事，跟踪审核状态并可在截止前撤销报名。'
            : '查看与筛选全部报名记录，跟进审批进度，并支持修改备注与撤销操作。'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>共 {total} 条记录</span>
          {isFetching && (
            <span className="inline-flex items-center gap-1">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> 同步中...
            </span>
          )}
        </div>

        {isTeamRole ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">已报名赛事</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => queryClient.invalidateQueries({ queryKey: ['registrations'] })}
                disabled={isFetching}
              >
                刷新
              </Button>
            </div>
            {registeredCompetitions.length ? (
              <div className="grid gap-3 md:grid-cols-2">
                {registeredCompetitions.map((item) => (
                  <div key={item.id} className="rounded-md border border-border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold">{item.name}</p>
                        <p className="text-xs text-muted-foreground">
                          报名时间：{formatDateTime(item.submittedAt)}
                        </p>
                      </div>
                      <span className={`text-xs font-medium ${statusTone(item.status)}`}>
                        {formatStatus(item.status)}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      项目：{item.events}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">暂无报名记录，请先完成报名。</p>
            )}
          </div>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-4">
              <div className="rounded-md border border-border p-3">
                <p className="text-xs text-muted-foreground">待审核</p>
                <p className="text-lg font-semibold text-amber-600 dark:text-amber-500">
                  {summary.pending}
                </p>
              </div>
              <div className="rounded-md border border-border p-3">
                <p className="text-xs text-muted-foreground">已通过</p>
                <p className="text-lg font-semibold text-green-600 dark:text-green-500">
                  {summary.approved}
                </p>
              </div>
              <div className="rounded-md border border-border p-3">
                <p className="text-xs text-muted-foreground">已驳回</p>
                <p className="text-lg font-semibold text-destructive">{summary.rejected}</p>
              </div>
              <div className="rounded-md border border-border p-3">
                <p className="text-xs text-muted-foreground">已撤销</p>
                <p className="text-lg font-semibold text-muted-foreground">{summary.cancelled}</p>
              </div>
            </div>

            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex flex-wrap gap-3">
                <select
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={competitionFilter}
                  onChange={(event) => {
                    setCompetitionFilter(event.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">全部赛事</option>
                  {competitions.map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>

                <select
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={statusFilter}
                  onChange={(event) => {
                    setStatusFilter(event.target.value as RegistrationStatus | '');
                    setPage(1);
                  }}
                >
                  {statusOptions.map((option) => (
                    <option key={option.label} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setCompetitionFilter('');
                    setStatusFilter('');
                    setPage(1);
                  }}
                  disabled={!competitionFilter && !statusFilter}
                >
                  重置筛选
                </Button>
              </div>
            </div>
          </>
        )}

        {competitionFilter && !isTeamRole && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">已报名队伍与队员</h3>
              <span className="text-xs text-muted-foreground">
                共 {groupedTeams.length} 个队伍/个人
              </span>
            </div>
            {groupedTeams.length ? (
              groupedTeams.map((team) => (
                <div key={team.id} className="rounded-md border border-border p-4">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold">{team.name}</p>
                    </div>
                    <span className={`text-xs font-medium ${team.statusTone}`}>{team.statusLabel}</span>
                  </div>
                  <ul className="mt-3 space-y-2">
                    {team.members.map((member) => (
                      <li
                        key={member.id}
                        className="flex flex-col gap-1 rounded-md bg-muted/50 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="font-medium">
                          {member.name}
                          {member.group && (
                            <span className="ml-2 text-xs text-muted-foreground">{member.group}</span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground sm:text-sm">
                          项目：{member.events}
                        </div>
                        <span className={`text-xs font-medium ${member.statusTone}`}>{member.statusLabel}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">当前赛事暂无报名记录。</p>
            )}
          </div>
        )}

        <div className="rounded-md border border-border">
          <table className="min-w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">报名人</th>
                <th className="px-3 py-2">赛事</th>
                <th className="px-3 py-2">项目</th>
                <th className="px-3 py-2">联系方式</th>
                <th className="px-3 py-2">状态</th>
                <th className="px-3 py-2">备注</th>
                <th className="px-3 py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-sm text-muted-foreground">
                    加载中...
                  </td>
                </tr>
              ) : !data || data.registrations.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-sm text-muted-foreground">
                    暂无报名记录。
                  </td>
                </tr>
              ) : (
                data.registrations.map((registration) => (
                  <tr key={registration.id} className="border-t border-border">
                    <td className="px-3 py-3">
                      <div className="font-medium">{registration.participant.name}</div>
                      {registration.team ? (
                        <div className="text-xs text-muted-foreground">
                          团队：{registration.team.name ?? '未命名团队'}
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground">个人报名</div>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-medium">{registration.competitionName}</div>
                      <div className="text-xs text-muted-foreground">
                        提交于 {formatDateTime(registration.createdAt)}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">
                      {formatSelections(registration.selections)}
                    </td>
                    <td className="px-3 py-3">
                      <div>{registration.participant.contact ?? '-'}</div>
                      {registration.participant.organization && (
                        <div className="text-xs text-muted-foreground">
                          单位：{registration.participant.organization}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <span className={`text-xs font-medium ${statusTone(registration.status)}`}>
                        {formatStatus(registration.status)}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="text-xs text-muted-foreground">
                        {registration.remark ?? '—'}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        {canManageApproval && registration.status === 'pending' && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                approveMutation.mutate({
                                  id: registration.id,
                                  status: 'approved'
                                })
                              }
                              disabled={approveMutation.isPending || isFetching}
                            >
                              通过
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                approveMutation.mutate({
                                  id: registration.id,
                                  status: 'rejected'
                                })
                              }
                              disabled={approveMutation.isPending || isFetching}
                            >
                              驳回
                            </Button>
                          </>
                        )}
                        {canManageApproval && registration.status !== 'cancelled' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              const remark = window.prompt('填写备注或说明', registration.remark ?? '');
                              if (remark !== null) {
                                remarkMutation.mutate({ id: registration.id, remark });
                              }
                            }}
                            disabled={remarkMutation.isPending}
                          >
                            修改备注
                          </Button>
                        )}
                        {canCancel && registration.status !== 'cancelled' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            onClick={() => cancelMutation.mutate(registration.id)}
                            disabled={cancelMutation.isPending}
                          >
                            撤销
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-2 text-sm">
            <span className="text-muted-foreground">
              第 {page} / {totalPages} 页，共 {total} 条记录
            </span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                disabled={page === 1}
              >
                上一页
              </Button>
              <span className="text-sm font-medium">{page}</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                disabled={page === totalPages}
              >
                下一页
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
