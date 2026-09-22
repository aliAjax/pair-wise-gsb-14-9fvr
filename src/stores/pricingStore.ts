// 数据层：Pinia store，串联领域校验、版本化发布/更正与存储层持久化。
import { computed, ref } from "vue";
import { defineStore } from "pinia";
import {
  type CorrectionInput,
  type OrderInput,
  type PriceRecord,
  type PriceVersion,
  MIN_MARGIN_YUAN,
  latestVersion,
  round4,
  validateCorrection,
  validateOrder
} from "../domain/pricing";
import { loadState, saveState } from "../storage/priceStorage";

const PUBLISH_CONTEXT = "publish";

export const usePricingStore = defineStore("pricing", () => {
  const initial = loadState();
  const records = ref<PriceRecord[]>(initial.records);
  const lastBlockReasons = ref<string[]>(initial.lastBlockReasons);
  const lastBlockContext = ref<string>(initial.lastBlockContext);

  function persist(): void {
    saveState({
      records: records.value,
      lastBlockReasons: lastBlockReasons.value,
      lastBlockContext: lastBlockContext.value
    });
  }

  function reportBlock(context: string, reasons: string[]): void {
    lastBlockReasons.value = reasons;
    lastBlockContext.value = context;
    persist();
  }

  /** 发布调价单；校验未过时整批拒绝（不改任何记录），界面保留输入。 */
  function publish(input: OrderInput): boolean {
    const result = validateOrder(input, records.value);
    if (!result.value) {
      reportBlock(PUBLISH_CONTEXT, result.errors);
      return false;
    }
    const order = result.value;
    const now = new Date().toISOString();
    const firstVersion: PriceVersion = {
      version: 1,
      retailPricePerLiter: order.retailPricePerLiter,
      wholesalePricePerTon: order.wholesalePricePerTon,
      wholesalePricePerLiter: order.wholesalePricePerLiter,
      density: order.density,
      margin: order.margin,
      reason: "首次发布",
      operator: order.operator,
      reviewer: order.reviewer,
      createdAt: now
    };
    const record: PriceRecord = {
      id: crypto.randomUUID(),
      station: order.station,
      fuel: order.fuel,
      effectiveDate: order.effectiveDate,
      status: "生效中",
      createdAt: now,
      versions: [firstVersion]
    };
    records.value = [record, ...records.value];
    reportBlock(PUBLISH_CONTEXT, []);
    return true;
  }

  /** 更正在役记录：冻结站点/油品/生效日，旧价格与密度作为历史版本保留。 */
  function correct(recordId: string, input: CorrectionInput): boolean {
    const record = records.value.find((item) => item.id === recordId);
    if (!record) return false;

    const result = validateCorrection(input);
    if (!result.value) {
      reportBlock(recordId, result.errors);
      return false;
    }
    const correction = result.value;
    record.versions.push({
      version: record.versions.length + 1,
      retailPricePerLiter: correction.retailPricePerLiter,
      wholesalePricePerTon: correction.wholesalePricePerTon,
      wholesalePricePerLiter: correction.wholesalePricePerLiter,
      density: correction.density,
      margin: correction.margin,
      reason: correction.reason,
      operator: correction.operator,
      reviewer: correction.reviewer,
      createdAt: new Date().toISOString()
    });
    record.status = "已更正";
    reportBlock(recordId, []);
    return true;
  }

  const reviewCount = computed(
    () => records.value.filter((record) => latestVersion(record).margin < MIN_MARGIN_YUAN).length
  );

  const averageMargin = computed(() => {
    if (records.value.length === 0) return "0.0000";
    const total = records.value.reduce((sum, record) => sum + latestVersion(record).margin, 0);
    return round4(total / records.value.length).toFixed(4);
  });

  return {
    records,
    lastBlockReasons,
    lastBlockContext,
    publish,
    correct,
    reviewCount,
    averageMargin,
    PUBLISH_CONTEXT
  };
});
