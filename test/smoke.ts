/**
 * 核心业务规则冒烟测试（不经过界面）：
 * 覆盖换算、整批拒绝、唯一约束、不得自审、冻结更正版本、持久化一致性。
 * 用 esbuild 临时打包后由 node 运行：npx esbuild test/smoke.ts --bundle --platform=node --format=esm | node
 */
import { createPinia, setActivePinia } from "pinia";
import { MARGIN_REVIEW_THRESHOLD, priceKey } from "../src/pricing/constants";
import { tonToLiter, validateRow, validateReview } from "../src/pricing/conversion";
import { usePricingStore } from "../src/pricing/store";
import type { PriceDraft } from "../src/pricing/types";

let passed = 0;
function assert(cond: boolean, message: string) {
  if (!cond) throw new Error(`断言失败：${message}`);
  passed++;
  console.log(`  ✓ ${message}`);
}

// ---- 纯换算 ----
console.log("换算：");
assert(tonToLiter(8380, 0.74) === Number((6.2012).toFixed(4)), "8380 元/吨 × 0.74 = 6.2012 元/升");
assert(tonToLiter(8600, 0.84) === 7.224, "8600 元/吨 × 0.84 = 7.224 元/升");

console.log("行校验：");
const good = validateRow({
  station: "城东加油站",
  fuel: "92号汽油",
  retailPrice: "7.58",
  wholesaleTonPrice: "8380",
  density: "0.74",
  effectiveDate: "2026-09-22"
});
assert(good.values !== null && good.reasons.length === 0, "合法行通过校验");
assert(good.values !== null && good.values.margin === Number((7.58 - 6.2012).toFixed(4)), "批零差=零售升价-每升批发价");

const badDensity = validateRow({
  station: "城东加油站",
  fuel: "柴油",
  retailPrice: "7.18",
  wholesaleTonPrice: "8600",
  density: "0.74", // 柴油密度给了汽油区间
  effectiveDate: "2026-09-22"
});
assert(badDensity.values === null && badDensity.reasons.some((r) => r.includes("密度")), "柴油密度 0.74 超出 0.81~0.87 区间被拦截");

const badDate = validateRow({
  station: "城东加油站",
  fuel: "92号汽油",
  retailPrice: "7.58",
  wholesaleTonPrice: "8380",
  density: "0.74",
  effectiveDate: "2026-02-31"
});
assert(badDate.values === null && badDate.reasons.some((r) => r.includes("日期")), "非法日期 2026-02-31 被拦截");

const nonNumeric = validateRow({
  station: "城东加油站",
  fuel: "92号汽油",
  retailPrice: "abc",
  wholesaleTonPrice: "",
  density: "0.74",
  effectiveDate: "2026-09-22"
});
assert(nonNumeric.values === null && nonNumeric.reasons.length === 2, "空/非数字逐字段收集原因");

console.log("复核：");
assert(
  validateReview({ margin: 0.4 }, "", "张三").length === 1,
  "批零差 0.40 < 0.50 且无复核人 → 必须复核"
);
assert(
  validateReview({ margin: 0.4 }, "张三", "张三")[0]?.includes("自审"),
  "复核人=操作员 → 不得自审"
);
assert(
  validateReview({ margin: 0.4 }, "李四", "张三").length === 0,
  "批零差低但有他人复核 → 通过"
);
assert(
  validateReview({ margin: MARGIN_REVIEW_THRESHOLD }, "", "张三").length === 0,
  "批零差恰好 0.50 无需复核（低于五角才触发）"
);

// ---- 存储 mock + store 整批事务 ----
console.log("整批发布事务：");
const mem = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k)
};
Object.defineProperty(globalThis, "crypto", {
  value: { randomUUID: () => `u${Math.random().toString(36).slice(2)}` },
  configurable: true
});
function draft(partial: Partial<PriceDraft>): PriceDraft {
  return {
    id: crypto.randomUUID(),
    station: "",
    fuel: "",
    retailPrice: "",
    wholesaleTonPrice: "",
    density: "",
    effectiveDate: "",
    reviewer: "",
    blockReasons: [],
    ...partial
  };
}

setActivePinia(createPinia());
const store = usePricingStore();
store.setOperator("张三");
const seedCount = store.records.length;
assert(seedCount === 2, `种子数据 ${seedCount} 条已发布记录`);

// 整批：一行合法、一行缺站点 → 整批拒绝
store.drafts.splice(0, store.drafts.length);
const idBad = store.addDraft();
const idGood = store.addDraft();
store.updateDraft(idBad, { station: "", fuel: "92号汽油", retailPrice: "7.6", wholesaleTonPrice: "8400", density: "0.74", effectiveDate: "2026-10-01" });
store.updateDraft(idGood, { station: "城西加油站", fuel: "95号汽油", retailPrice: "7.9", wholesaleTonPrice: "8600", density: "0.74", effectiveDate: "2026-10-01" });
const blocked = store.publish();
assert(!blocked.ok, "含无效行时整批拒绝");
assert(store.records.length === seedCount, "整批拒绝不写入任何记录");
assert(store.drafts.length === 2, "整批拒绝后输入全部保留");
assert(store.drafts.find((d) => d.id === idBad)!.blockReasons.some((r) => r.includes("站点")), "阻断原因逐行回写");
assert(store.blockEvents.length === 1, "生成 1 条阻断事件");

// 刷新（重新从 localStorage 加载 store）
setActivePinia(createPinia());
const reloaded = usePricingStore();
assert(reloaded.drafts.length === 2, "刷新后调价单输入仍在");
assert(reloaded.drafts.find((d) => d.id === idBad)!.blockReasons.length > 0, "刷新后阻断原因仍在");
assert(reloaded.blockEvents.length === 1, "刷新后阻断事件一致");

// 修正后整批发布成功
reloaded.updateDraft(idBad, { station: "城东加油站" });
const okPub = reloaded.publish();
assert(okPub.ok && okPub.recordIds.length === 2, "修正后整批发布成功 2 行");
assert(reloaded.records.length === seedCount + 2, "新增 2 条冻结记录");
assert(reloaded.drafts.length === 0, "发布成功后调价单清空");

// 唯一约束：同站同油品同日再发 → 阻断
const dup = reloaded.addDraft();
reloaded.updateDraft(dup, { station: "城东加油站", fuel: "92号汽油", retailPrice: "7.7", wholesaleTonPrice: "8400", density: "0.74", effectiveDate: "2026-10-01" });
const dupRes = reloaded.publish();
assert(!dupRes.ok, "同站同油品同日重复发布被阻断");
assert(
  reloaded.drafts[0].blockReasons.some((r) => r.includes("不能重复发布")),
  "唯一约束阻断原因正确"
);

// 批次内重复
reloaded.drafts.splice(0, reloaded.drafts.length);
const a = reloaded.addDraft();
const b = reloaded.addDraft();
for (const id of [a, b]) {
  reloaded.updateDraft(id, { station: "城南加油站", fuel: "柴油", retailPrice: "7.2", wholesaleTonPrice: "8600", density: "0.84", effectiveDate: "2026-11-01" });
}
assert(!reloaded.publish().ok, "批次内同站同油品同日重复被阻断");

console.log("冻结与更正版本：");
reloaded.drafts.splice(0, reloaded.drafts.length);
const target = reloaded.records.find(
  (r) => priceKey(r.station, r.fuel, r.effectiveDate) === priceKey("城东加油站", "92号汽油", "2026-10-01")
)!;
const before = JSON.stringify(target.versions[0]);
const noReason = reloaded.correct(target.id, {
  retailPrice: "7.71", wholesaleTonPrice: "8500", density: "0.74", reason: "", reviewer: ""
});
assert(!noReason.ok && noReason.message.includes("原因"), "更正不写原因被拒绝");

const selfReview = reloaded.correct(target.id, {
  retailPrice: "7.00", wholesaleTonPrice: "8800", density: "0.74", reason: "测试", reviewer: "张三"
});
assert(!selfReview.ok && selfReview.message.includes("自审"), "更正后批零差低于五角时自审被拒绝");

const corrected = reloaded.correct(target.id, {
  retailPrice: "7.71", wholesaleTonPrice: "8500", density: "0.742", reason: "执行总部调价通知", reviewer: "李四"
});
assert(corrected.ok, "有原因的更正成功并生成新版本");
const after = reloaded.records.find((r) => r.id === target.id)!;
assert(after.currentVersion === 2 && after.versions.length === 2, "版本号 v2，共 2 个版本");
assert(JSON.stringify(after.versions[0]) === before, "旧版本 v1 原封不动冻结保留");
assert(after.versions[1].reason === "执行总部调价通知", "新版本记录更正原因");
assert(after.versions[1].density === 0.742, "新版本密度为更正值");

// 刷新后版本一致
setActivePinia(createPinia());
const reloaded2 = usePricingStore();
const afterRefresh = reloaded2.records.find((r) => r.id === target.id)!;
assert(afterRefresh.versions.length === 2 && afterRefresh.currentVersion === 2, "刷新后版本链一致");

console.log(`\n全部通过：${passed} 项断言`);
