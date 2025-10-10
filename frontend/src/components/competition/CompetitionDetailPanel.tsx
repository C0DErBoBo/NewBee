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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../ui/dialog";
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

type EditableEvent = CompetitionEventInput & { id?: string; groupIds: string[] };
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

const defaultCompetitionModeForCategory = (category: CompetitionEventInput['category']): 'lane' | 'mass' => (category === 'track' ? 'lane' : 'mass');

const defaultScoringTypeForCategory = (category: CompetitionEventInput['category']): CompetitionEventInput['scoringType'] => {
  switch (category) {
    case 'track':
      return 'timing';
    case 'field':
      return 'distance';
    case 'all_round':
      return 'timing';
    case 'fun':
      return 'distance';
    case 'score':
      return 'distance';
    default:
      return 'distance';
  }
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
  events: detail.events.map((event) => {
    const baseConfig = event.config ?? {};
    const assignedGroups =
      Array.isArray(event.groupIds) && event.groupIds.length
        ? event.groupIds
        : Array.isArray((baseConfig as { assignedGroups?: unknown }).assignedGroups)
          ? ((baseConfig as { assignedGroups?: unknown }).assignedGroups as unknown[]).filter(
              (value): value is string => typeof value === "string"
            )
          : [];
    return {
      id: event.id,
      name: event.name,
      category: event.category,
      unitType: event.unitType,
      competitionMode: event.competitionMode ?? defaultCompetitionModeForCategory(event.category),
      scoringType: event.scoringType ?? defaultScoringTypeForCategory(event.category),
      isCustom: event.isCustom,
      groupIds: assignedGroups,
      config: { ...baseConfig, assignedGroups }
    };
  }),
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
  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [eventModalDraft, setEventModalDraft] = useState<EditableEvent | null>(null);
  const [eventModalError, setEventModalError] = useState<string | null>(null);

  const groupOptions = useMemo(() => {
    if (!draft) return [] as Array<{ id: string; name: string }>;
    return draft.groups
      .map((group, index) => ({
        id: group.id ?? "",
        name: group.name.trim() || `未命名组别${index + 1}`
      }))
      .filter((option) => option.id.length > 0);
  }, [draft]);

  const groupIdToNameMap = useMemo(
    () => new Map(groupOptions.map((option) => [option.id, option.name])),
    [groupOptions]
  );

  const eventsGroupedById = useMemo(() => {
    if (!draft) return new Map<string, EditableEvent[]>();
    const map = new Map<string, EditableEvent[]>();
    const groups = draft.groups;
    groups.forEach((group) => {
      if (group.id) {
        map.set(group.id, []);
      }
    });
    draft.events.forEach((event) => {
      const assigned = Array.isArray(event.groupIds) ? event.groupIds : [];
      if (assigned.length === 0) {
        groups.forEach((group) => {
          if (group.id) {
            const list = map.get(group.id);
            if (list) {
              list.push(event);
            }
          }
        });
      } else {
        assigned.forEach((groupId) => {
          const list = map.get(groupId);
          if (list) {
            list.push(event);
          }
        });
      }
    });
    return map;
  }, [draft]);

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
        location: draft.basic.location.trim() || undefined,
        signupStartAt: toIsoString(draft.basic.signupStartAt)!,
        signupEndAt: toIsoString(draft.basic.signupEndAt)!,
        startAt: toIsoString(draft.basic.startAt),
        endAt: toIsoString(draft.basic.endAt),
        events: draft.events
          .map(({ name, category, unitType, competitionMode, scoringType, isCustom, config, groupIds }) => {
            const trimmedName = name.trim();
            const selectedGroupIds = Array.isArray(groupIds)
              ? groupIds.filter((value) => value.length > 0)
              : [];
            return {
              name: trimmedName,
              category,
              unitType,
              competitionMode: competitionMode ?? defaultCompetitionModeForCategory(category),
              scoringType: scoringType ?? defaultScoringTypeForCategory(category),
              isCustom,
              groupIds: selectedGroupIds,
              config: { ...(config ?? {}), assignedGroups: selectedGroupIds }
            };
          })
          .filter((event) => event.name.length > 0),
        groups: draft.groups
          .map(({ name, gender, ageBracket, identityType, maxParticipants, teamSize, config }) => {
            const trimmedName = name.trim();
            return {
              name: trimmedName,
              gender,
              ageBracket: ageBracket?.trim() || undefined,
              identityType: identityType?.trim() || undefined,
              maxParticipants:
                typeof maxParticipants === "number" && Number.isFinite(maxParticipants)
                  ? maxParticipants
                  : undefined,
              teamSize:
                typeof teamSize === "number" && Number.isFinite(teamSize)
                  ? teamSize
                  : undefined,
              config: config ?? {}
            };
          })
          .filter((group) => group.name.length > 0),
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

  const handleEventCategoryChange = (index: number, category: EditableEvent['category']) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const nextEvents = prev.events.map((event, idx) => {
        if (idx !== index) return event;
        return {
          ...event,
          category,
          competitionMode: defaultCompetitionModeForCategory(category),
          scoringType: defaultScoringTypeForCategory(category)
        };
      });
      setHasPendingChanges(true);
      return { ...prev, events: nextEvents };
    });
  };

  const handleEventGroupToggle = (eventIndex: number, groupId: string, checked: boolean) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const nextEvents = prev.events.map((event, idx) => {
        if (idx !== eventIndex) return event;
        const currentGroupIds = Array.isArray(event.groupIds) ? event.groupIds : [];
        const nextGroupIds = checked
          ? Array.from(new Set([...currentGroupIds, groupId]))
          : currentGroupIds.filter((value) => value !== groupId);
        return { ...event, groupIds: nextGroupIds };
      });
      setHasPendingChanges(true);
      return { ...prev, events: nextEvents };
    });
  };

  const buildEventDraft = (groupIds: string[]): EditableEvent => ({
    id: undefined,
    name: "",
    category: "track",
    unitType: "individual",
    competitionMode: defaultCompetitionModeForCategory("track"),
    scoringType: defaultScoringTypeForCategory("track"),
    isCustom: false,
    groupIds,
    config: {}
  });

  const openEventModalWithGroups = (groupIds: string[]) => {
    setEventModalDraft(buildEventDraft(groupIds));
    setEventModalError(null);
    setEventModalOpen(true);
  };

  const closeEventModal = () => {
    setEventModalOpen(false);
    setEventModalDraft(null);
    setEventModalError(null);
  };

  const updateEventModalDraft = <K extends keyof EditableEvent>(key: K, value: EditableEvent[K]) => {
    setEventModalDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const toggleEventModalGroup = (groupId: string, checked: boolean) => {
    setEventModalDraft((prev) => {
      if (!prev) return prev;
      const currentGroupIds = Array.isArray(prev.groupIds) ? prev.groupIds : [];
      const nextGroupIds = checked
        ? Array.from(new Set([...currentGroupIds, groupId]))
        : currentGroupIds.filter((value) => value !== groupId);
      return { ...prev, groupIds: nextGroupIds };
    });
  };

  const handleEventModalSubmit = () => {
    if (!eventModalDraft) return;
    const trimmedName = eventModalDraft.name.trim();
    if (!trimmedName) {
      setEventModalError("请输入项目名称");
      return;
    }

    const selectedGroupIds = Array.isArray(eventModalDraft.groupIds)
      ? eventModalDraft.groupIds.filter((value) => value.length > 0)
      : [];
    if ((draft?.groups.length ?? 0) > 0 && selectedGroupIds.length === 0) {
      setEventModalError("请至少选择一个适用组别");
      return;
    }

    setDraft((prev) => {
      if (!prev) return prev;
      setHasPendingChanges(true);
      return {
        ...prev,
        events: [
          ...prev.events,
          {
            id: undefined,
            name: trimmedName,
            category: eventModalDraft.category,
            unitType: eventModalDraft.unitType,
            competitionMode: eventModalDraft.competitionMode,
            scoringType: eventModalDraft.scoringType,
            isCustom: eventModalDraft.isCustom ?? false,
            groupIds: selectedGroupIds,
            config: eventModalDraft.config ?? {}
          }
        ]
      };
    });

    closeEventModal();
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
    const availableGroupIds =
      draft?.groups.map((group) => group.id ?? "").filter((value) => value.length > 0) ?? [];
    openEventModalWithGroups(availableGroupIds);
  };

  const handleAddEventForGroup = (groupId: string) => {
    if (!groupId) {
      return;
    }
    openEventModalWithGroups([groupId]);
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
            id: createTempId(),
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
      const groupToRemove = prev.groups[index];
      const removedGroupId = groupToRemove?.id ?? null;
      return {
        ...prev,
        events:
          removedGroupId !== null
            ? prev.events.map((event) => ({
                ...event,
                groupIds: (event.groupIds ?? []).filter((groupId) => groupId !== removedGroupId)
              }))
            : prev.events,
        groups: prev.groups.filter((_, idx) => idx !== index)
      };
    });
  };

  const canSave = hasPendingChanges && !hasErrors && !updateMutation.isPending;

  return (
    <>
      <Dialog open={eventModalOpen} onOpenChange={(open) => { if (!open) closeEventModal(); }}>
        {eventModalDraft ? (
          <DialogContent className="sm:max-w-[560px]">
            <DialogHeader>
              <DialogTitle>新增项目</DialogTitle>
              <DialogDescription>配置项目基础信息，并选择适用的参赛组别。</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="event-modal-name">项目名称</Label>
                  <Input
                    id="event-modal-name"
                    value={eventModalDraft.name}
                    onChange={(event) => updateEventModalDraft("name", event.target.value)}
                    placeholder="例如：100 米"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="event-modal-category">项目类型</Label>
                  <select
                    id="event-modal-category"
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                    value={eventModalDraft.category}
                    onChange={(event) =>
                      updateEventModalDraft("category", event.target.value as EditableEvent["category"])
                    }
                  >
                    <option value="track">径赛</option>
                    <option value="field">田赛</option>
                    <option value="all_round">全能</option>
                    <option value="fun">趣味</option>
                    <option value="score">评分类</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="event-modal-unit">赛制</Label>
                  <select
                    id="event-modal-unit"
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                    value={eventModalDraft.unitType}
                    onChange={(event) =>
                      updateEventModalDraft("unitType", event.target.value as EditableEvent["unitType"])
                    }
                  >
                    <option value="individual">个人</option>
                    <option value="team">团体</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="event-modal-mode">竞赛模式</Label>
                  <select
                    id="event-modal-mode"
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                    value={
                      eventModalDraft.competitionMode ?? defaultCompetitionModeForCategory(eventModalDraft.category)
                    }
                    onChange={(event) =>
                      updateEventModalDraft(
                        "competitionMode",
                        event.target.value as NonNullable<EditableEvent["competitionMode"]>
                      )
                    }
                  >
                    <option value="lane">分道</option>
                    <option value="mass">不分道</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="event-modal-scoring">计分方式</Label>
                  <select
                    id="event-modal-scoring"
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                    value={
                      eventModalDraft.scoringType ?? defaultScoringTypeForCategory(eventModalDraft.category)
                    }
                    onChange={(event) =>
                      updateEventModalDraft(
                        "scoringType",
                        event.target.value as NonNullable<EditableEvent["scoringType"]>
                      )
                    }
                  >
                    <option value="timing">计时</option>
                    <option value="distance">距离</option>
                    <option value="height">高度</option>
                  </select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>适用组别</Label>
                {groupOptions.length ? (
                  <div className="flex flex-wrap gap-2">
                    {groupOptions.map((option) => {
                      const checked = (eventModalDraft.groupIds ?? []).includes(option.id);
                      return (
                        <label
                          key={option.id}
                          className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
                        >
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border border-input"
                            checked={checked}
                            onChange={(event) => toggleEventModalGroup(option.id, event.target.checked)}
                          />
                          <span>{option.name}</span>
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">尚未配置组别，可先在"组别设置"内新增。</p>
                )}
              </div>
            </div>
            {eventModalError && <p className="text-xs text-destructive">{eventModalError}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={closeEventModal}>
                取消
              </Button>
              <Button onClick={handleEventModalSubmit}>确认添加</Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
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
              <Button
                variant="outline"
                size="sm"
                className="border-emerald-200 bg-emerald-100 text-emerald-700 hover:bg-emerald-200 hover:text-emerald-900"
                onClick={handleAddEvent}
              >
                新增项目
              </Button>
            </div>
            <div className="space-y-3">
              {draft.events.length === 0 ? (
                <p className="text-sm text-muted-foreground">尚未配置项目，点击“新增项目”开始设置。</p>
              ) : (
                draft.events.map((event, index) => (
                  <div key={event.id ?? index} className="space-y-3 rounded-md border border-dashed border-border p-4">
                    <div className="grid gap-3 md:grid-cols-5">
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
                          onChange={(evt) => handleEventCategoryChange(index, evt.target.value as EditableEvent['category'])}
                        >
                          <option value="track">径赛</option>
                          <option value="field">田赛</option>
                          <option value="all_round">全能类</option>
                          <option value="fun">趣味类</option>
                          <option value="score">评分类</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <Label>赛制</Label>
                        <select
                          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                          value={event.unitType}
                          onChange={(evt) => handleEventChange(index, "unitType", evt.target.value as EditableEvent['unitType'])}
                        >
                          <option value="individual">个人</option>
                          <option value="team">团体</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <Label>赛道模式</Label>
                        <select
                          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                          value={event.competitionMode ?? defaultCompetitionModeForCategory(event.category)}
                          onChange={(evt) =>
                            handleEventChange(
                              index,
                              "competitionMode",
                              evt.target.value as NonNullable<EditableEvent['competitionMode']>
                            )
                          }
                        >
                          <option value="lane">分道跑</option>
                          <option value="mass">不分道跑</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <Label>计分类型</Label>
                        <select
                          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                          value={event.scoringType ?? defaultScoringTypeForCategory(event.category)}
                          onChange={(evt) =>
                            handleEventChange(
                              index,
                              "scoringType",
                              evt.target.value as NonNullable<EditableEvent['scoringType']>
                            )
                          }
                        >
                          <option value="timing">计时类</option>
                          <option value="distance">远度类</option>
                          <option value="height">高度类</option>
                        </select>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>适用组别</Label>
                      {groupOptions.length ? (
                        <div className="flex flex-wrap gap-2">
                          {groupOptions.map((option) => {
                            const checked = (event.groupIds ?? []).includes(option.id);
                            return (
                              <label
                                key={`${event.id ?? index}-${option.id}`}
                                className="flex items-center gap-1 rounded-md border border-input px-2 py-1 text-xs"
                              >
                                <input
                                  type="checkbox"
                                  className="h-3 w-3"
                                  checked={checked}
                                  onChange={(evt) => handleEventGroupToggle(index, option.id, evt.target.checked)}
                                />
                                <span>{option.name}</span>
                              </label>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">尚未配置组别，本项目默认对全部组别生效。</p>
                      )}
                      {groupOptions.length > 0 ? (
                        (event.groupIds ?? []).length ? (
                          <p className="text-xs text-muted-foreground">
                            已选择：
                            {(event.groupIds ?? []).map((id) => groupIdToNameMap.get(id) ?? "未知组别").join("、")}
                          </p>
                        ) : (
                          <p className="text-xs text-muted-foreground">未选择时默认适用于全部组别。</p>
                        )
                      ) : null}
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
                draft.groups.map((group, index) => {
                  const groupId = group.id ?? '';
                  const eventsForGroup =
                    groupId && eventsGroupedById.has(groupId)
                      ? eventsGroupedById.get(groupId) ?? []
                      : [];
                  return (
                    <div key={groupId || index} className="space-y-3 rounded-md border border-dashed border-border p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">组别信息</span>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => (groupId ? handleAddEventForGroup(groupId) : openEventModalWithGroups([]))}
                          disabled={!groupId}
                        >
                          新增项目
                        </Button>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label>组别名称</Label>
                          <Input
                            value={group.name}
                            placeholder="例如：男子甲组"
                            onChange={(evt) => handleGroupChange(index, 'name', evt.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>性别</Label>
                          <select
                            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                            value={group.gender}
                            onChange={(evt) => handleGroupChange(index, 'gender', evt.target.value as EditableGroup['gender'])}
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
                            placeholder="例如：18-25"
                            onChange={(evt) => handleGroupChange(index, 'ageBracket', evt.target.value || undefined)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>身份类型</Label>
                          <Input
                            value={group.identityType ?? ''}
                            placeholder="例如：学生 / 教师"
                            onChange={(evt) => handleGroupChange(index, 'identityType', evt.target.value || undefined)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>参赛人数上限</Label>
                          <Input
                            type="number"
                            value={group.maxParticipants ?? ''}
                            min={0}
                            onChange={(evt) => handleGroupChange(index, 'maxParticipants', evt.target.value ? Number(evt.target.value) : undefined)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>团队人数</Label>
                          <Input
                            type="number"
                            value={group.teamSize ?? ''}
                            min={0}
                            onChange={(evt) => handleGroupChange(index, 'teamSize', evt.target.value ? Number(evt.target.value) : undefined)}
                          />
                        </div>
                      </div>
                      <div className="space-y-2 rounded-md border border-dashed border-border p-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-muted-foreground">关联项目</span>
                          <Button
                            variant="outline"
                            size="xs"
                            onClick={() => (groupId ? handleAddEventForGroup(groupId) : openEventModalWithGroups([]))}
                            disabled={!groupId}
                          >
                            添加项目
                          </Button>
                        </div>
                        {eventsForGroup.length ? (
                          <div className="flex flex-wrap gap-2 text-xs">
                            {eventsForGroup.map((event) => (
                              <span key={(event.id ?? event.name) + groupId} className="rounded-full bg-muted px-2 py-1">
                                {event.name}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">当前组别尚未关联项目。</p>
                        )}
                      </div>
                    </div>
                  );
                })
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
    </>
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











