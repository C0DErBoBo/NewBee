import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from "../ui/card";
import { Button } from "../ui/button";
import { CompetitionDetail, fetchCompetitionDetail } from "@/services/competitions";
import { cn } from "@/lib/utils";

interface CompetitionDetailPanelProps {
  competitionId: string;
  onBack: () => void;
  onOpenWizard: (detail: CompetitionDetail) => void;
}

export function CompetitionDetailPanel({ competitionId, onBack, onOpenWizard }: CompetitionDetailPanelProps) {
  const detailQuery = useQuery({
    queryKey: ["competition-detail", competitionId],
    queryFn: () => fetchCompetitionDetail(competitionId),
    staleTime: 30_000
  });

  const competition = detailQuery.data;

  const basicInfo = useMemo(() => {
    if (!competition) {
      return [] as Array<{ label: string; value: string }>;
    }

    return [
      { label: "报名时间", value: formatRange(competition.signupStartAt, competition.signupEndAt) },
      { label: "比赛时间", value: formatRange(competition.startAt, competition.endAt) },
      { label: "举办地点", value: competition.location ?? "待定" },
      {
        label: "当前报名/团队",
        value: `${competition.stats.participantCount} / ${competition.stats.teamCount}`
      }
    ];
  }, [competition]);

  if (detailQuery.isLoading || !competition) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>赛事详情加载中</CardTitle>
          <CardDescription>正在获取赛事完整信息，请稍候…</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <SkeletonLine className="w-1/2" />
          <SkeletonLine className="w-2/3" />
          <SkeletonLine className="w-3/4" />
        </CardContent>
        <CardFooter>
          <Button variant="outline" onClick={onBack}>
            返回列表
          </Button>
        </CardFooter>
      </Card>
    );
  }

  if (detailQuery.isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>赛事详情加载失败</CardTitle>
          <CardDescription>请检查网络后再试一次。</CardDescription>
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
      <CardHeader className="space-y-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <Button variant="ghost" className="px-0 text-sm text-muted-foreground" onClick={onBack}>
              ← 返回赛事列表
            </Button>
            <CardTitle className="mt-2 text-2xl font-semibold">{competition.name}</CardTitle>
            <CardDescription>
              赛事编号：{competition.id} · 创建于 {new Date(competition.createdAt).toLocaleString()}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => detailQuery.refetch()}
              disabled={detailQuery.isFetching}
            >
              {detailQuery.isFetching ? "刷新中…" : "刷新数据"}
            </Button>
            <Button onClick={() => onOpenWizard(competition)}>打开配置向导</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <section className="grid gap-3 md:grid-cols-2">
          {basicInfo.map((item) => (
            <div key={item.label} className="rounded-md border border-border p-3">
              <p className="text-sm text-muted-foreground">{item.label}</p>
              <p className="text-base font-medium">{item.value}</p>
            </div>
          ))}
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium">竞赛项目</h3>
          {competition.events.length === 0 ? (
            <p className="text-sm text-muted-foreground">尚未配置项目，请通过向导添加。</p>
          ) : (
            <div className="grid gap-2 md:grid-cols-2">
              {competition.events.map((event) => (
                <div key={event.id ?? event.name} className="rounded-md border border-dashed border-border p-3">
                  <p className="text-sm font-medium">{event.name}</p>
                  <p className="text-xs text-muted-foreground">
                    类别：{event.category === "track" ? "径赛" : "田赛"} · 赛制：
                    {event.unitType === "team" ? "团体" : "个人"}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium">参赛组别</h3>
          {competition.groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">尚未设置组别。</p>
          ) : (
            <div className="grid gap-2 md:grid-cols-2">
              {competition.groups.map((group) => (
                <div key={group.id ?? group.name} className="rounded-md border border-dashed border-border p-3">
                  <p className="text-sm font-medium">{group.name}</p>
                  <p className="text-xs text-muted-foreground">
                    性别：{renderGender(group.gender)} · 年龄：{group.ageBracket ?? "不限"} · 身份：
                    {group.identityType ?? "不限"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    人数上限：{group.maxParticipants ?? "不限"} · 团队人数：{group.teamSize ?? "不限"}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium">规则概览</h3>
          <div className="rounded-md border border-border p-4 text-sm text-muted-foreground space-y-1">
            <p>积分规则：{competition.rules?.scoring ? "已配置" : "沿用默认 9-7-6-5-4-3-2-1"}</p>
            <p>赛程流程：{competition.rules?.flow ? "已配置" : "默认预赛 / 决赛流程"}</p>
            <p>异常处理：{competition.rules?.penalties ? "已配置" : "尚未配置"}</p>
          </div>
        </section>
      </CardContent>
      <CardFooter className="flex flex-wrap justify-between gap-2">
        <Button variant="outline" onClick={onBack}>
          返回列表
        </Button>
        <Button onClick={() => onOpenWizard(competition)}>打开配置向导</Button>
      </CardFooter>
    </Card>
  );
}

function formatRange(start?: string, end?: string) {
  if (!start && !end) {
    return "待定";
  }

  const startText = start ? new Date(start).toLocaleString() : "待定";
  const endText = end ? new Date(end).toLocaleString() : "待定";
  return `${startText} ~ ${endText}`;
}

function renderGender(value: CompetitionDetail['groups'][number]['gender']) {
  switch (value) {
    case 'male':
      return '男子';
    case 'female':
      return '女子';
    default:
      return '混合';
  }
}

function SkeletonLine({ className }: { className?: string }) {
  return <div className={cn('h-4 animate-pulse rounded bg-muted', className)} />;
}
