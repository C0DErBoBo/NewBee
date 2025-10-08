import { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
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
      return '已通过';
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

export function RegistrationManager({ competitions }: RegistrationManagerProps) {
  const user = useAppSelector((state) => state.auth.user);
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<RegistrationStatus | ''>('');
  const [competitionFilter, setCompetitionFilter] = useState<string | ''>('');
  const [page, setPage] = useState(1);

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

  const canManageApproval = user?.role === 'admin' || user?.role === 'organizer';
  const isParticipant = user?.role === 'team' || user?.role === 'participant';

  const pageSize = data?.pagination.pageSize ?? 20;
  const total = data?.pagination.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <Card>
      <CardHeader>
        <CardTitle>报名管理</CardTitle>
        <CardDescription>
          查看与筛选报名记录，跟进审批进度，并支持修改备注与撤销操作。
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
                        提交于 {new Date(registration.createdAt).toLocaleString()}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">
                      {registration.selections.length
                        ? registration.selections
                            .map((selection) => selection.eventName ?? selection.eventId ?? '-')
                            .join('、')
                        : '-'}
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
                                approveMutation.mutate({ id: registration.id, status: 'approved' })
                              }
                              disabled={approveMutation.isPending || isFetching}
                            >
                              通过
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                approveMutation.mutate({ id: registration.id, status: 'rejected' })
                              }
                              disabled={approveMutation.isPending || isFetching}
                            >
                              驳回
                            </Button>
                          </>
                        )}
                        {registration.status !== 'cancelled' && (
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
                        {(isParticipant || canManageApproval) &&
                          registration.status !== 'cancelled' && (
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
              第 {page} / {totalPages} 页，共 {total} 条报名
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
