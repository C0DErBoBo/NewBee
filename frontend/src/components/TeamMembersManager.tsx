import { useMemo, useState } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { fetchTeamMembers, updateTeamMembers, TeamMember } from '@/services/team';
import { useAppSelector } from '@/store';

function normalizeMembers(members: TeamMember[]): TeamMember[] {
  return members.map((member) => ({
    name: member.name.trim(),
    gender: member.gender?.trim() || null,
    group: member.group?.trim() || null,
    events: (member.events ?? [])
      .slice(0, 5)
      .map((event) => ({
        name: event?.name?.trim() || null,
        result: event?.result?.trim() || null
      }))
  }));
}

function parseMembersInput(raw: string): TeamMember[] {
  const lines = raw
    .split(/\r?\n/)
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
    const events = [] as TeamMember['events'];
    for (let i = 0; i < rest.length && events.length < 5; i += 2) {
      const eventName = rest[i] ?? '';
      const result = rest[i + 1] ?? '';
      if (!eventName && !result) {
        continue;
      }
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

export function TeamMembersManager() {
  const user = useAppSelector((state) => state.auth.user);
  const queryClient = useQueryClient();
  const isTeamRole = user?.role === 'team';

  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [inputText, setInputText] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);

  const membersQuery = useQuery({
    queryKey: ['team-members'],
    queryFn: fetchTeamMembers,
    enabled: isTeamRole
  });

  const saveMutation = useMutation({
    mutationFn: (members: TeamMember[]) => updateTeamMembers(normalizeMembers(members)),
    onSuccess: (data) => {
      queryClient.setQueryData(['team-members'], data);
      setIsEditorOpen(false);
      setInputText('');
      setParseError(null);
    }
  });

  const currentMembers = useMemo(
    () => normalizeMembers(membersQuery.data?.members ?? []),
    [membersQuery.data]
  );

  const isLoading = membersQuery.isLoading;
  const isSaving = saveMutation.isPending;

  const handleSubmitInput = async () => {
    try {
      setParseError(null);
      const parsed = parseMembersInput(inputText);
      if (!parsed.length) {
        setParseError('请至少填写一名队员。');
        return;
      }
      const nextMembers = normalizeMembers([...currentMembers, ...parsed]);
      await saveMutation.mutateAsync(nextMembers);
    } catch (error) {
      setParseError(error instanceof Error ? error.message : '解析失败，请检查格式。');
    }
  };

  const handleRemoveMember = (index: number) => {
    const nextMembers = currentMembers.filter((_, i) => i !== index);
    saveMutation.mutate(nextMembers);
  };

  if (!isTeamRole) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>队员管理</CardTitle>
        <CardDescription>
          批量导入或维护队伍报名名单，支持按照“姓名,性别,组别,项目一,成绩一,项目二,成绩二...”格式快速录入。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">当前队员</p>
            <p className="text-xs text-muted-foreground">
              共 {currentMembers.length} 人
            </p>
          </div>
          <Button onClick={() => setIsEditorOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> 添加队员
          </Button>
        </div>

        <div className="rounded-md border border-border overflow-x-auto">
          <table className="min-w-[900px] text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">姓名</th>
                <th className="px-3 py-2">性别</th>
                <th className="px-3 py-2">组别</th>
                {[1, 2, 3, 4, 5].map((index) => (
                  <th key={`event-${index}`} className="px-3 py-2">
                    项目{index}
                  </th>
                ))}
                {[1, 2, 3, 4, 5].map((index) => (
                  <th key={`result-${index}`} className="px-3 py-2">
                    成绩{index}
                  </th>
                ))}
                <th className="px-3 py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={14} className="px-3 py-6 text-center text-sm text-muted-foreground">
                    加载中...
                  </td>
                </tr>
              ) : currentMembers.length === 0 ? (
                <tr>
                  <td colSpan={14} className="px-3 py-6 text-center text-sm text-muted-foreground">
                    暂无队员信息，点击右上角“添加队员”快速录入。
                  </td>
                </tr>
              ) : (
                currentMembers.map((member, index) => (
                  <tr key={`${member.name}-${index}`} className="border-t border-border">
                    <td className="px-3 py-3 font-medium">{member.name}</td>
                    <td className="px-3 py-3">{member.gender ?? '—'}</td>
                    <td className="px-3 py-3">{member.group ?? '—'}</td>
                    {[0, 1, 2, 3, 4].map((eventIndex) => {
                      const event = member.events?.[eventIndex];
                      return (
                        <td key={`event-name-${eventIndex}`} className="px-3 py-3 text-xs text-muted-foreground">
                          {event?.name ?? '—'}
                        </td>
                      );
                    })}
                    {[0, 1, 2, 3, 4].map((eventIndex) => {
                      const event = member.events?.[eventIndex];
                      return (
                        <td key={`event-result-${eventIndex}`} className="px-3 py-3 text-xs text-muted-foreground">
                          {event?.result ?? '—'}
                        </td>
                      );
                    })}
                    <td className="px-3 py-3 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => handleRemoveMember(index)}
                        disabled={isSaving}
                      >
                        删除
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {isEditorOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur">
            <div className="w-full max-w-3xl rounded-lg border border-border bg-card p-6 shadow-xl">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold">批量添加队员</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    每行代表一名队员，字段顺序为：姓名,性别,组别,项目一,成绩一,项目二,成绩二,项目三,成绩三,项目四,成绩四,项目五,成绩五。
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setIsEditorOpen(false);
                    setParseError(null);
                    setInputText('');
                  }}
                  aria-label="关闭"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <Textarea
                className="mt-4 h-48"
                value={inputText}
                onChange={(event) => setInputText(event.target.value)}
                placeholder="示例：张三,男,青年组,100米,11.20s,200米,22.90s"
              />

              {parseError && <p className="mt-2 text-xs text-destructive">{parseError}</p>}

              <div className="mt-4 flex items-center justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setParseError(null);
                    setInputText('');
                  }}
                  disabled={isSaving}
                >
                  清空
                </Button>
                <Button onClick={handleSubmitInput} disabled={isSaving}>
                  {isSaving ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 保存中...
                    </>
                  ) : (
                    '解析并添加'
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
