/**
 * 批零联动定价台 —— 编排层（Pinia）
 * 组合 数据 / 换算 / 存储 三部分：
 *  - 调价单草稿的增删改（输入原样保留，整批被拒也不丢失）
 *  - 整批发布：任一行无效 → 整批拒绝，逐行记录阻断原因
 *  - 唯一约束：同站同油品同生效日不可重复发布（含批次内重复）
 *  - 复核约束：批零差 < 0.5 元须复核人，操作员不得自审
 *  - 更正：冻结旧值，写原因后追加新版本
 */

import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { priceKey } from "./constants";
import { validateCorrectionValues, validateReview, validateRow } from "./conversion";
import { loadState, saveState } from "./storage";
import type {
  BlockEvent,
  CorrectionInput,
  PriceDraft,
  PriceValues,
  PriceVersion,
  PublishedRecord
} from "./types";

export interface PublishResult {
  ok: boolean;
  message: string;
  /** 发布成功时新生成的记录 id 列表 */
  recordIds: string[];
}

function blankDraft(): PriceDraft {
  return {
    id: crypto.randomUUID(),
    station: "",
    fuel: "",
    retailPrice: "",
    wholesaleTonPrice: "",
    density: "",
    effectiveDate: "",
    reviewer: "",
    blockReasons: []
  };
}

export const usePricingStore = defineStore("pricing", () => {
  const initial = loadState();

  const operator = ref(initial.operator);
  const drafts = ref<PriceDraft[]>(initial.drafts);
  const records = ref<PublishedRecord[]>(initial.records);
  const blockEvents = ref<BlockEvent[]>(initial.blockEvents);

  const currentVersionOf = (record: PublishedRecord): PriceVersion =>
    record.versions[record.versions.length - 1];

  const latestRecords = computed(() =>
    records.value
      .map((record) => ({ record, version: currentVersionOf(record) }))
      .sort((a, b) =>
        a.record.effectiveDate === b.record.effectiveDate
          ? b.record.publishedAt.localeCompare(a.record.publishedAt)
          : a.record.effectiveDate.localeCompare(b.record.effectiveDate)
      )
  );

  const lastBlockEvent = computed(() =>
    blockEvents.value.length > 0 ? blockEvents.value[blockEvents.value.length - 1] : null
  );

  function persist() {
    saveState({
      schemaVersion: 1,
      operator: operator.value,
      drafts: drafts.value,
      records: records.value,
      blockEvents: blockEvents.value
    });
  }

  function setOperator(name: string) {
    operator.value = name;
    persist();
  }

  function addDraft(): string {
    const draft = blankDraft();
    drafts.value = [...drafts.value, draft];
    persist();
    return draft.id;
  }

  function updateDraft(id: string, patch: Partial<Omit<PriceDraft, "id">>) {
    drafts.value = drafts.value.map((draft) =>
      draft.id === id
        ? {
            ...draft,
            ...patch,
            // 只要用户重新输入，就清掉上一轮阻断标记，发布时重新计算
            blockReasons: []
          }
        : draft
    );
    persist();
  }

  function removeDraft(id: string) {
    drafts.value = drafts.value.filter((draft) => draft.id !== id);
    persist();
  }

  /** 实时预览某一行的换算结果（不产生阻断，仅用于界面联动显示） */
  function previewDraft(draft: PriceDraft) {
    const { values, reasons } = validateRow(draft);
    const reviewReasons = values
      ? validateReview(values, draft.reviewer, operator.value)
      : [];
    return { values, reasons, reviewReasons };
  }

  /**
   * 整批发布。任一行无效 → 整批拒绝：
   * 不写入任何记录、不改变输入，并把逐行阻断原因写回草稿（持久化）。
   */
  function publish(): PublishResult {
    const globalReasons: string[] = [];
    if (!operator.value.trim()) globalReasons.push("未填写操作员");
    if (drafts.value.length === 0) globalReasons.push("调价单为空，没有可发布的行");

    // 已发布记录占用的唯一键
    const takenKeys = new Set(
      records.value.map((r) => priceKey(r.station, r.fuel, r.effectiveDate))
    );
    // 批次内同站同油品同日也只允许出现一次
    const seenInBatch = new Map<string, number>();

    const rowResults = drafts.value.map((draft) => {
      const { values, reasons } = validateRow(draft);
      const allReasons = [...reasons];

      if (values) {
        allReasons.push(...validateReview(values, draft.reviewer, operator.value));

        const key = priceKey(values.station, values.fuel, values.effectiveDate);
        if (takenKeys.has(key)) {
          allReasons.push(
            `${values.station} / ${values.fuel} / ${values.effectiveDate} 已发布，同站同油品同日不能重复发布`
          );
        } else {
          const seen = seenInBatch.get(key);
          if (seen !== undefined) {
            allReasons.push(`与本批次第 ${seen + 1} 行同站同油品同日，不能重复发布`);
          } else {
            seenInBatch.set(key, seenInBatch.size);
          }
        }
      }

      return { draft, values, reasons: allReasons };
    });

    const hasBlockedRow = rowResults.some((r) => r.reasons.length > 0);

    if (globalReasons.length > 0 || hasBlockedRow) {
      // 整批拒绝：阻断原因回写到每一行并持久化，输入原样保留
      drafts.value = drafts.value.map((draft) => {
        const row = rowResults.find((r) => r.draft.id === draft.id)!;
        return { ...draft, blockReasons: row.reasons };
      });

      const event: BlockEvent = {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        operator: operator.value.trim(),
        rowCount: drafts.value.length,
        globalReasons,
        rows: rowResults.map((r) => ({ rowId: r.draft.id, reasons: r.reasons }))
      };
      blockEvents.value = [...blockEvents.value, event];
      persist();

      const rowFailCount = rowResults.filter((r) => r.reasons.length > 0).length;
      const detail =
        globalReasons.length > 0
          ? `${globalReasons.join("；")}；`
          : "";
      return {
        ok: false,
        recordIds: [],
        message: `整批拒绝（${detail}${rowFailCount}/${drafts.value.length} 行存在问题，已标注阻断原因，输入已保留）`
      };
    }

    // 全部通过：逐行生成冻结的已发布记录 v1
    const now = new Date().toISOString();
    const recordIds: string[] = [];
    const newRecords = rowResults.map((r) => {
      const v = r.values!;
      const record: PublishedRecord = {
        id: crypto.randomUUID(),
        station: v.station,
        fuel: v.fuel,
        effectiveDate: v.effectiveDate,
        currentVersion: 1,
        publishedAt: now,
        versions: [
          {
            version: 1,
            ...pickValues(v),
            reason: "",
            operator: operator.value.trim(),
            reviewer: v.margin < 0.5 ? r.draft.reviewer.trim() : "",
            createdAt: now
          }
        ]
      };
      recordIds.push(record.id);
      return record;
    });

    records.value = [...newRecords, ...records.value];
    drafts.value = []; // 发布成功后清空调价单（输入已转化为冻结记录）
    persist();

    return {
      ok: true,
      recordIds,
      message: `发布成功：共 ${newRecords.length} 行，价格与密度已冻结，如需更正请在记录上生成新版本`
    };
  }

  /**
   * 更正已发布记录：旧值永久保留，写原因后追加新版本。
   * 站点 / 油品 / 生效日不可更改（否则破坏唯一键）。
   */
  function correct(
    recordId: string,
    input: CorrectionInput
  ): { ok: boolean; message: string } {
    const record = records.value.find((r) => r.id === recordId);
    if (!record) return { ok: false, message: "记录不存在或已被移除" };

    const reasons: string[] = [];
    if (!operator.value.trim()) reasons.push("未填写操作员");
    if (!input.reason.trim()) reasons.push("更正必须填写原因");

    const { values } = validateCorrectionValues({
      retailPrice: input.retailPrice,
      wholesaleTonPrice: input.wholesaleTonPrice,
      density: input.density,
      fuel: record.fuel
    });
    if (!values) {
      reasons.push("更正数据无效（请检查零售升价、批发吨价与密度）");
    } else {
      reasons.push(...validateReview(values, input.reviewer, operator.value));
      const last = currentVersionOf(record);
      const unchanged =
        values.retailPrice === last.retailPrice &&
        values.wholesaleTonPrice === last.wholesaleTonPrice &&
        values.density === last.density;
      if (unchanged) reasons.push("零售升价、批发吨价、密度均未变化，无需更正");
    }

    if (reasons.length > 0) {
      return { ok: false, message: `更正被拒绝：${reasons.join("；")}` };
    }

    const v = values!;
    const newVersion: PriceVersion = {
      version: record.currentVersion + 1,
      ...pickValues(v),
      reason: input.reason.trim(),
      operator: operator.value.trim(),
      reviewer: v.margin < 0.5 ? input.reviewer.trim() : "",
      createdAt: new Date().toISOString()
    };

    records.value = records.value.map((r) =>
      r.id === recordId
        ? {
            ...r,
            currentVersion: newVersion.version,
            versions: [...r.versions, newVersion] // 旧版本原封不动保留
          }
        : r
    );
    persist();
    return {
      ok: true,
      message: `已生成 v${newVersion.version}，旧版本 v${newVersion.version - 1} 的价格与密度已冻结保留`
    };
  }

  function pickValues(v: PriceValues): PriceValues {
    return {
      retailPrice: v.retailPrice,
      wholesaleTonPrice: v.wholesaleTonPrice,
      density: v.density,
      wholesaleLiterPrice: v.wholesaleLiterPrice,
      margin: v.margin
    };
  }

  return {
    // state
    operator,
    drafts,
    records,
    blockEvents,
    // getters
    latestRecords,
    lastBlockEvent,
    // actions
    setOperator,
    addDraft,
    updateDraft,
    removeDraft,
    previewDraft,
    publish,
    correct,
    currentVersionOf
  };
});
