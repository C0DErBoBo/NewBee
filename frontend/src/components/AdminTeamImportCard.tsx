import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  importTeamAccounts,
  ImportedTeamAccount,
  TeamImportInput
} from '@/services/admin';

interface AdminTeamImportCardProps {
  onSuccess?: (teams: ImportedTeamAccount[]) => void;
  onError?: (message: string) => void;
}

interface ParsedTeamResult {
  teams: TeamImportInput[];
  errors: string[];
}

type ParsedTeamWithLine = TeamImportInput & { line: number };

function parseTeamInput(raw: string): ParsedTeamResult {
  const lines = raw
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const candidates: ParsedTeamWithLine[] = [];
  const errors: string[] = [];

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const match = line.match(/^(.+?)(?:\s*[,\uFF0C]\s*(.*))?$/u);

    if (!match) {
      errors.push(`第 ${lineNumber} 行格式不正确，请使用“全称，简称”的格式`);
      return;
    }

    const name = match[1]?.trim() ?? '';
    const shortNameRaw = match[2]?.trim() ?? '';
    const lineErrors: string[] = [];

    if (!name) {
      lineErrors.push('队伍全称不能为空');
    }
    if (name.length > 100) {
      lineErrors.push('全称需在 100 个字符以内');
    }
    if (shortNameRaw && shortNameRaw.length > 50) {
      lineErrors.push('简称需在 50 个字符以内');
    }

    if (lineErrors.length > 0) {
      errors.push(`第 ${lineNumber} 行存在问题：${lineErrors.join('，')}`);
      return;
    }

    candidates.push({
      line: lineNumber,
      name,
      shortName: shortNameRaw || undefined
    });
  });

  const seenNames = new Map<string, number>();
  candidates.forEach((candidate) => {
    const previousLine = seenNames.get(candidate.name);
    if (previousLine) {
      errors.push(`第 ${candidate.line} 行与第 ${previousLine} 行的队伍全称重复`);
      return;
    }
    seenNames.set(candidate.name, candidate.line);
  });

  return {
    teams: candidates.map(({ line: _line, ...team }) => team),
    errors
  };
}

export function AdminTeamImportCard({ onSuccess, onError }: AdminTeamImportCardProps) {
  const [rawInput, setRawInput] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [importedTeams, setImportedTeams] = useState<ImportedTeamAccount[]>([]);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const copyTimerRef = useRef<number | null>(null);

  const parsedResult = useMemo(() => parseTeamInput(rawInput), [rawInput]);

  useEffect(() => {
    if (copyTimerRef.current) {
      window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = null;
    }
    return () => {
      if (copyTimerRef.current) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setSubmitError(null);
  }, [rawInput]);

  const importMutation = useMutation({
    mutationFn: (payload: TeamImportInput[]) => importTeamAccounts(payload),
    onSuccess: (teams) => {
      setImportedTeams(teams);
      setSubmitError(null);
      if (onSuccess) {
        onSuccess(teams);
      }
    },
    onError: (error: unknown) => {
      const message =
        error instanceof Error ? error.message : '导入失败，请稍后重试';
      setSubmitError(message);
      if (onError) {
        onError(message);
      }
    }
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = parseTeamInput(rawInput);
    if (!result.teams.length) {
      setSubmitError('请输入至少一行有效的队伍信息');
      return;
    }
    if (result.errors.length > 0) {
      setSubmitError(result.errors.join('；'));
      return;
    }
    importMutation.mutate(result.teams);
  };

  const handleClear = () => {
    setRawInput('');
    setImportedTeams([]);
    setCopyFeedback(null);
    setSubmitError(null);
  };

  const handleCopyAccounts = async () => {
    if (!importedTeams.length) {
      return;
    }

    const lines = [
      '队伍全称\t队伍简称\t登录账号\t初始密码',
      ...importedTeams.map((team) =>
        [team.name, team.shortName ?? '-', team.username, team.password].join('\t')
      )
    ];

    try {
      const clipboard = typeof navigator === 'undefined' ? null : navigator.clipboard;
      if (!clipboard || typeof clipboard.writeText !== 'function') {
        throw new Error('clipboard-not-supported');
      }
      await clipboard.writeText(lines.join('\n'));
      setCopyFeedback('账号列表已复制到剪贴板');
    } catch (error) {
      if (error instanceof Error && error.message === 'clipboard-not-supported') {
        setCopyFeedback('当前环境不支持自动复制，请手动选择并复制表格内容');
      } else {
        console.error('复制账号列表失败', error);
        setCopyFeedback('复制失败，请手动选择并复制表格内容');
      }
    }

    if (copyTimerRef.current) {
      window.clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = window.setTimeout(() => {
      setCopyFeedback(null);
      copyTimerRef.current = null;
    }, 3000);
  };

  const hasInput = rawInput.trim().length > 0;
  const canSubmit =
    parsedResult.teams.length > 0 && parsedResult.errors.length === 0 && !importMutation.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle>批量导入队伍账号</CardTitle>
        <CardDescription>
          粘贴“队伍全称，队伍简称”列表，每行一支队伍。提交后系统将自动创建队伍账号并生成随机密码。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="team-import-input">队伍名单</Label>
            <Textarea
              id="team-import-input"
              value={rawInput}
              onChange={(event) => setRawInput(event.target.value)}
              placeholder={`示例：\n电子科技大学田径队，电子科大\n成都七中代表队，七中\n城市青年业余队`}
              rows={6}
            />
            <p className="text-xs text-muted-foreground">
              支持中文逗号或英文逗号分隔简称，简称可留空。导入前会自动去除重复与空行。
            </p>
            {hasInput && (
              <p className="text-xs text-muted-foreground">
                已解析 {parsedResult.teams.length} 支队伍
                {parsedResult.errors.length > 0 ? `，发现 ${parsedResult.errors.length} 处格式问题` : ''}。
              </p>
            )}
            {parsedResult.errors.length > 0 && (
              <ul className="space-y-1 text-xs text-destructive">
                {parsedResult.errors.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={!canSubmit}>
              {importMutation.isPending ? '导入中...' : '导入队伍账号'}
            </Button>
            <Button type="button" variant="outline" onClick={handleClear} disabled={!hasInput}>
              清空输入
            </Button>
          </div>
        </form>

        {submitError && <p className="text-sm text-destructive">{submitError}</p>}

        {importedTeams.length > 0 && (
          <div className="space-y-3">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <p className="text-sm text-muted-foreground">
                成功创建 {importedTeams.length} 支队伍账号，请妥善保存以下初始密码。
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleCopyAccounts}
                  disabled={!importedTeams.length}
                >
                  复制账号列表
                </Button>
                {copyFeedback && <span className="text-xs text-muted-foreground">{copyFeedback}</span>}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-4">队伍全称</th>
                    <th className="py-2 pr-4">队伍简称</th>
                    <th className="py-2 pr-4">登录账号</th>
                    <th className="py-2 pr-4">初始密码</th>
                  </tr>
                </thead>
                <tbody>
                  {importedTeams.map((team) => (
                    <tr key={team.teamId} className="border-t border-border">
                      <td className="py-2 pr-4 font-medium">{team.name}</td>
                      <td className="py-2 pr-4">{team.shortName ?? '-'}</td>
                      <td className="py-2 pr-4">{team.username}</td>
                      <td className="py-2 pr-4 font-mono text-sm">{team.password}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
