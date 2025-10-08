import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from "../ui/card";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { Textarea } from "../ui/textarea";
import {
  CompetitionDetail,
  CompetitionEventInput,
  CompetitionGroupInput,
  CompetitionRuleInput,
  fetchCompetitionDetail,
  updateCompetition
} from "@/services/competitions";
import { cn } from "@/lib/utils";

interface CompetitionDetailPanelProps {
  competitionId: string;
  onBack: () => void;
  onOpenWizard: (detail: CompetitionDetail) => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

type DetailTab = "basic" | "events" | "groups" | "rules" | "registration";

type RulesKey = keyof CompetitionRuleInput;

type EditableEvent = CompetitionEventInput & { id?: string };
type EditableGroup = CompetitionGroupInput & { id?: string };

interface EditableCompetition {
  basic: {
    name: string;
    location: string;
    signupStartAt: string;
    signupEndAt: string;
    startAt: string;
    endAt: string;
  };
  events: EditableEvent[];
  groups: EditableGroup[];
  rules: CompetitionRuleInput;
  registration: Record<string, unknown>;
}

const defaultRules: CompetitionRuleInput = {
  scoring: {
    defaultTable: [9, 7, 6, 5, 4, 3, 2, 1]
  },
  flow: {
    stages: ["预赛", "决赛"],
    advance: "成绩前 8 名晋级决赛"
  },
  penalties: {
    disqualified: ["两次抢跑", "严重犯规"],
    waiver: ["赛前书面说明"]
  }
};

const defaultRegistrationConfig: Record<string, unknown> = {
  maxEventsPerParticipant: 2,
  allowTeamOverlap: false,
  requireRealName: true
};

const toInputDateTime = (value?: string) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
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

const mapDetailToEditable = (detail: CompetitionDetail): EditableCompetition => ({
  basic: {
    name: detail.name,
    location: detail.location ?? "",
    signupStartAt: toInputDateTime(detail.signupStartAt),
    signupEndAt: toInputDateTime(detail.signupEndAt),
    startAt: toInputDateTime(detail.startAt),
    endAt: toInputDateTime(detail.endAt)
  },
  events: detail.events.map((event) => ({
    id: event.id,
    name: event.name,
    category: event.category,
    unitType: event.unitType,
    isCustom: event.isCustom,
    config: event.config
  })),
  groups: detail.groups.map((group) => ({
    id: group.id,
    name: group.name,
    gender: group.gender,
    ageBracket: group.ageBracket,
    identityType: group.identityType,
    maxParticipants: group.maxParticipants,
    teamSize: group.teamSize,
    config: group.config
  })),
  rules: detail.rules ? deepClone(detail.rules) : deepClone(defaultRules),
  registration: (detail.config?.registration ?? deepClone(defaultRegistrationConfig)) as Record<
    string,
    unknown
  >
});

export function CompetitionDetailPanel({
  competitionId,
  onBack,
  onOpenWizard,
  onSuccess,
  onError
}: CompetitionDetailPanelProps) {
  const queryClient = useQueryClient();
  const detailQuery = useQuery({
    queryKey: ["competition-detail", competitionId],
    queryFn: () => fetchCompetitionDetail(competitionId),
    staleTime: 30_000
  });

  const competition = detailQuery.data;

  const [activeTab, setActiveTab] = useState<DetailTab>("basic");
  const [draft, setDraft] = useState<EditableCompetition | null>(null);
  const [original, setOriginal] = useState<EditableCompetition | null>(null);
  const [rulesText, setRulesText] = useState<Record<RulesKey, string>>({
    scoring: "",
    flow: "",
    penalties: ""
  });
  const [rulesError, setRulesError] = useState<Record<RulesKey, string | null>>({
    scoring: null,
    flow: null,
    penalties: null
  });
  const [registrationText, setRegistrationText] = useState("");
  const [registrationError, setRegistrationError] = useState<string | null>(null);
  const [hasPendingChanges, setHasPendingChanges] = useState(false);

  useEffect(() => {
    if (!competition) return;
    const editable = mapDetailToEditable(competition);
    setDraft(editable);
    setOriginal(deepClone(editable));
    setRulesText({
      scoring: JSON.stringify(editable.rules.scoring ?? {}, null, 2),
      flow: JSON.stringify(editable.rules.flow ?? {}, null, 2),
      penalties: JSON.stringify(editable.rules.penalties ?? {}, null, 2)
    });
    setRulesError({ scoring: null, flow: null, penalties: null });
    setRegistrationText(JSON.stringify(editable.registration, null, 2));
    setRegistrationError(null);
    setHasPendingChanges(false);
    setActiveTab("basic");
  }, [competition]);

  const changeSummary = useMemo(() => {
    if (!draft || !original) return [] as string[];
    const summary: string[] = [];

    if (draft.basic.name !== original.basic.name || draft.basic.location !== original.basic.location) {
      summary.push("基础信息已调整");
    }

    if (
      draft.basic.signupStartAt !== original.basic.signupStartAt ||
      draft.basic.signupEndAt !== original.basic.signupEndAt ||
      draft.basic.startAt !== original.basic.startAt ||
      draft.basic.endAt !== original.basic.endAt
    ) {
      summary.push("时间配置发生变化");
    }

    if (JSON.stringify(draft.events) !== JSON.stringify(original.events)) {
      summary.push("项目列表已更新");
    }

    if (JSON.stringify(draft.groups) !== JSON.stringify(original.groups)) {
      summary.push("参赛组别已更新");
    }

    if (JSON.stringify(draft.rules) !== JSON.stringify(original.rules)) {
      summary.push("流程与积分规则已更新");
    }

    if (JSON.stringify(draft.registration) !== JSON.stringify(original.registration)) {
      summary.push("报名规则已更新");
    }

    return summary;
  }, [draft, original]);

  const hasErrors =
    registrationError !== null || Object.values(rulesError).some((error) => Boolean(error));

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error("缺少草稿数据");

      if (!draft.basic.name.trim()) {
        throw new Error("请填写赛事名称");
      }

      if (!draft.basic.signupStartAt || !draft.basic.signupEndAt) {
        throw new Error("请完善报名时间范围");
      }

      if (hasErrors) {
        throw new Error("仍存在未处理的配置错误，请先修正");
      }

      return updateCompetition(competitionId, {
        name: draft.basic.name,
        location: draft.basic.location || undefined,
        signupStartAt: toIsoString(draft.basic.signupStartAt)!,
        signupEndAt: toIsoString(draft.basic.signupEndAt)!,
        startAt: toIsoString(draft.basic.startAt),
        endAt: toIsoString(draft.basic.endAt),
        events: draft.events
          .filter((event) => event.name.trim())
          .map(({ name, category, unitType, isCustom, config }) => ({
            name,
            category,
            unitType,
            isCustom,
            config
          })),
        groups: draft.groups
          .filter((group) => group.name.trim())
          .map(({ name, gender, ageBracket, identityType, maxParticipants, teamSize, config }) => ({
            name,
            gender,
            ageBracket,
            identityType,
            maxParticipants,
            teamSize,
            config
          })),
        rules: draft.rules,
        config: {
          ...(competition?.config ?? {}),
          registration: draft.registration
        }
      });
    },
    onSuccess: async (updated) => {
      const editable = mapDetailToEditable(updated);
      setDraft(editable);
      setOriginal(deepClone(editable));
      setRulesText({
        scoring: JSON.stringify(editable.rules.scoring ?? {}, null, 2),
        flow: JSON.stringify(editable.rules.flow ?? {}, null, 2),
        penalties: JSON.stringify(editable.rules.penalties ?? {}, null, 2)
      });
      setRegistrationText(JSON.stringify(editable.registration, null, 2));
      setRegistrationError(null);
      setHasPendingChanges(false);
      onSuccess("赛事详情已保存");
      await queryClient.invalidateQueries({ queryKey: ["competition-detail", competitionId] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard-competitions"] });
    },
    onError: (error) => {
      onError(error instanceof Error ? error.message : "保存赛事信息失败");
    }
  });

  if (detailQuery.isLoading || !draft || !original) {
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

  const handleBasicChange = <K extends keyof EditableCompetition["basic"]>(key: K, value: string) => {
    setDraft((prev) => {
      if (!prev) return prev;
      setHasPendingChanges(true);
      return {
        ...prev,
        basic: {
          ...prev.basic,
          [key]: value
        }
      };
    });
  };

  const handleEventChange = <K extends keyof EditableEvent>(index: number, key: K, value: EditableEvent[K]) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const nextEvents = prev.events.map((event, idx) => (idx === index ? { ...event, [key]: value } : event));
      setHasPendingChanges(true);
      return { ...prev, events: nextEvents };
    });
  };

  const handleGroupChange = <K extends keyof EditableGroup>(index: number, key: K, value: EditableGroup[K]) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const nextGroups = prev.groups.map((group, idx) => (idx === index ? { ...group, [key]: value } : group));
      setHasPendingChanges(true);
      return { ...prev, groups: nextGroups };
    });
  };

  const handleRulesChange = (key: RulesKey, value: string) => {
    setRulesText((prev) => ({ ...prev, [key]: value }));
    const { data, error } = safeJsonParse(value, draft?.rules[key] ?? {});
    if (error) {
      setRulesError((prev) => ({ ...prev, [key]: "JSON 解析失败，请检查格式" }));
      return;
    }
    setRulesError((prev) => ({ ...prev, [key]: null }));
    setDraft((prev) => {
      if (!prev) return prev;
      setHasPendingChanges(true);
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
    const { data, error } = safeJsonParse<Record<string, unknown>>(value, draft?.registration ?? {});
    if (error) {
      setRegistrationError("JSON 解析失败，请检查格式");
      return;
    }
    setRegistrationError(null);
    setDraft((prev) => {
      if (!prev) return prev;
      setHasPendingChanges(true);
      return {
        ...prev,
        registration: data
      };
    });
  };

  const handleAddEvent = () => {
    setDraft((prev) => {
      if (!prev) return prev;
      setHasPendingChanges(true);
      return {
        ...prev,
        events: [
          ...prev.events,
          {
            name: "",
            category: "track",
            unitType: "individual",
            isCustom: true
          }
        ]
      };
    });
  };

  const handleRemoveEvent = (index: number) => {
    setDraft((prev) => {
      if (!prev) return prev;
      setHasPendingChanges(true);
      return {
        ...prev,
        events: prev.events.filter((_, idx) => idx !== index)
      };
    });
  };

  const handleAddGroup = () => {
    setDraft((prev) => {
      if (!prev) return prev;
      setHasPendingChanges(true);
      return {
        ...prev,
        groups: [
          ...prev.groups,
          {
            name: "",
            gender: "mixed",
            ageBracket: "",
            identityType: "",
            maxParticipants: undefined,
            teamSize: undefined
          }
        ]
      };
    });
  };

  const handleRemoveGroup = (index: number) => {
    setDraft((prev) => {
      if (!prev) return prev;
      setHasPendingChanges(true);
      return {
        ...prev,
        groups: prev.groups.filter((_, idx) => idx !== index)
      };
    });
  };

  const canSave = hasPendingChanges && !hasErrors && !updateMutation.isPending;

  return (
    <Card className="border border-border">
      <CardHeader className="space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <Button variant="ghost" className="px-0 text-sm text-muted-foreground" onClick={onBack}>
              ← 返回赛事列表
            </Button>
            <CardTitle className="mt-2 text-2xl font-semibold">{draft.basic.name || "赛事详情"}</CardTitle>
            <CardDescription>
              赛事编号：{competition?.id ?? competitionId} · 创建于 {competition ? new Date(competition.createdAt).toLocaleString() : "-"}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => detailQuery.refetch()} disabled={detailQuery.isFetching}>
              {detailQuery.isFetching ? "刷新中…" : "刷新数据"}
            </Button>
            <Button variant="outline" onClick={() => onOpenWizard(competition)}>
              打开配置向导
            </Button>
            <Button onClick={() => updateMutation.mutate()} disabled={!canSave}>
              {updateMutation.isPending ? "保存中…" : "保存变更"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as DetailTab)}>
          <TabsList className="mb-4 flex flex-wrap gap-2">
            <TabsTrigger value="basic">基础信息</TabsTrigger>
            <TabsTrigger value="events">项目配置</TabsTrigger>
            <TabsTrigger value="groups">参赛组别</TabsTrigger>
            <TabsTrigger value="rules">流程与积分</TabsTrigger>
            <TabsTrigger value="registration">报名规则</TabsTrigger>
          </TabsList>

          <TabsContent value="basic" className="space-y-4">
            <section className="space-y-3 rounded-md border border-border p-4">
              <h3 className="text-sm font-medium">赛事基础设置</h3>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="detail-name">赛事名称</Label>
                  <Input
                    id="detail-name"
                    value={draft.basic.name}
                    onChange={(event) => handleBasicChange("name", event.target.value)}
                    placeholder="请输入赛事名称"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="detail-location">举办地点</Label>
                  <Input
                    id="detail-location"
                    value={draft.basic.location}
                    onChange={(event) => handleBasicChange("location", event.target.value)}
                    placeholder="请输入场地信息"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="detail-signup-start">报名开始时间</Label>
                  <Input
                    id="detail-signup-start"
                    type="datetime-local"
                    value={draft.basic.signupStartAt}
                    onChange={(event) => handleBasicChange("signupStartAt", event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="detail-signup-end">报名结束时间</Label>
                  <Input
                    id="detail-signup-end"
                    type="datetime-local"
                    value={draft.basic.signupEndAt}
                    onChange={(event) => handleBasicChange("signupEndAt", event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="detail-event-start">比赛开始时间</Label>
                  <Input
                    id="detail-event-start"
                    type="datetime-local"
                    value={draft.basic.startAt}
                    onChange={(event) => handleBasicChange("startAt", event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="detail-event-end">比赛结束时间</Label>
                  <Input
                    id="detail-event-end"
                    type="datetime-local"
                    value={draft.basic.endAt}
                    onChange={(event) => handleBasicChange("endAt", event.target.value)}
                  />
                </div>
              </div>
            </section>
          </TabsContent>

          <TabsContent value="events" className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">项目列表</h3>
              <Button variant="outline" size="sm" onClick={handleAddEvent}>
                新增项目
              </Button>
            </div>
            <div className="space-y-3">
              {draft.events.length === 0 ? (
                <p className="text-sm text-muted-foreground">尚未配置项目，点击“新增项目”开始设置。</p>
              ) : (
                draft.events.map((event, index) => (
                  <div key={event.id ?? index} className="space-y-3 rounded-md border border-dashed border-border p-4">
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label>项目名称</Label>
                        <Input
                          value={event.name}
                          placeholder="例如：100 米"
                          onChange={(evt) => handleEventChange(index, "name", evt.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>项目类型</Label>
                        <select
                          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                          value={event.category}
                          onChange={(evt) => handleEventChange(index, "category", evt.target.value as EditableEvent["category"])}
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
                          onChange={(evt) => handleEventChange(index, "unitType", evt.target.value as EditableEvent["unitType"])}
                        >
                          <option value="individual">个人</option>
                          <option value="team">团体</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleRemoveEvent(index)}>
                        删除项目
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </TabsContent>

          <TabsContent value="groups" className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">参赛组别</h3>
              <Button variant="outline" size="sm" onClick={handleAddGroup}>
                新增组别
              </Button>
            </div>
            <div className="space-y-3">
              {draft.groups.length === 0 ? (
                <p className="text-sm text-muted-foreground">尚未配置组别，点击“新增组别”进行设置。</p>
              ) : (
                draft.groups.map((group, index) => (
                  <div key={group.id ?? index} className="space-y-3 rounded-md border border-dashed border-border p-4">
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label>组别名称</Label>
                        <Input
                          value={group.name}
                          placeholder="例如：男子甲组"
                          onChange={(evt) => handleGroupChange(index, "name", evt.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>性别限制</Label>
                        <select
                          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                          value={group.gender}
                          onChange={(evt) => handleGroupChange(index, "gender", evt.target.value as EditableGroup["gender"])}
                        >
                          <option value="male">男子</option>
                          <option value="female">女子</option>
                          <option value="mixed">混合</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <Label>年龄段</Label>
                        <Input
                          value={group.ageBracket ?? ""}
                          placeholder="例如：18-25"
                          onChange={(evt) => handleGroupChange(index, "ageBracket", evt.target.value || undefined)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>身份类型</Label>
                        <Input
                          value={group.identityType ?? ""}
                          placeholder="例如：学生 / 教师"
                          onChange={(evt) => handleGroupChange(index, "identityType", evt.target.value || undefined)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>人数上限</Label>
                        <Input
                          type="number"
                          value={group.maxParticipants ?? ""}
                          min={0}
                          onChange={(evt) => handleGroupChange(index, "maxParticipants", evt.target.value ? Number(evt.target.value) : undefined)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>团队人数</Label>
                        <Input
                          type="number"
                          value={group.teamSize ?? ""}
                          min={0}
                          onChange={(evt) => handleGroupChange(index, "teamSize", evt.target.value ? Number(evt.target.value) : undefined)}
                        />
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleRemoveGroup(index)}>
                        删除组别
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </TabsContent>

          <TabsContent value="rules" className="space-y-4">
            <section className="space-y-3 rounded-md border border-border p-4">
              <h3 className="text-sm font-medium">积分与流程设定</h3>
              <div className="space-y-2">
                <Label>积分规则</Label>
                <Textarea
                  className="min-h-[160px]"
                  value={rulesText.scoring}
                  onChange={(event) => handleRulesChange("scoring", event.target.value)}
                  placeholder='例如：{"defaultTable":[9,7,6,5,4,3,2,1]}'
                />
                {rulesError.scoring && <p className="text-xs text-destructive">{rulesError.scoring}</p>}
              </div>
              <div className="space-y-2">
                <Label>流程设定</Label>
                <Textarea
                  className="min-h-[160px]"
                  value={rulesText.flow}
                  onChange={(event) => handleRulesChange("flow", event.target.value)}
                  placeholder='例如：{"stages":["预赛","决赛"],"advance":"前 8 名晋级"}'
                />
                {rulesError.flow && <p className="text-xs text-destructive">{rulesError.flow}</p>}
              </div>
              <div className="space-y-2">
                <Label>异常处理</Label>
                <Textarea
                  className="min-h-[160px]"
                  value={rulesText.penalties}
                  onChange={(event) => handleRulesChange("penalties", event.target.value)}
                  placeholder='例如：{"disqualified":["两次抢跑"],"waiver":["赛前书面说明"]}'
                />
                {rulesError.penalties && <p className="text-xs text-destructive">{rulesError.penalties}</p>}
              </div>
            </section>
          </TabsContent>

          <TabsContent value="registration" className="space-y-4">
            <section className="space-y-3 rounded-md border border-border p-4">
              <h3 className="text-sm font-medium">报名规则配置</h3>
              <Textarea
                className="min-h-[200px]"
                value={registrationText}
                onChange={(event) => handleRegistrationChange(event.target.value)}
                placeholder='例如：{"maxEventsPerParticipant":2,"allowTeamOverlap":false}'
              />
              {registrationError && <p className="text-xs text-destructive">{registrationError}</p>}
            </section>
          </TabsContent>
        </Tabs>
      </CardContent>
      <CardFooter className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="text-sm text-muted-foreground">
          {hasPendingChanges ? (
            <div>
              <p>存在未保存的修改：</p>
              <ul className="list-disc pl-5">
                {(changeSummary.length ? changeSummary : ["字段内容发生变动"]).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : (
            <span>所有配置均已保存。</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onBack}>
            返回列表
          </Button>
          <Button onClick={() => updateMutation.mutate()} disabled={!canSave}>
            {updateMutation.isPending ? "保存中…" : "保存变更"}
          </Button>
        </div>
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

function renderGender(value: CompetitionDetail["groups"][number]["gender"]) {
  switch (value) {
    case "male":
      return "男子";
    case "female":
      return "女子";
    default:
      return "混合";
  }
}

function SkeletonLine({ className }: { className?: string }) {
  return <div className={cn("h-4 animate-pulse rounded bg-muted", className)} />;
}
