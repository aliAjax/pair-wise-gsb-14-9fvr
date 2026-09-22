<script setup lang="ts">
/**
 * 调价单（整批录入）界面：
 *  - 字段：站点 / 油品 / 零售升价 / 批发吨价 / 密度 / 生效日 / 复核人
 *  - 实时显示：吨价 × 密度 ÷ 1000 换算的每升批发价、批零差
 *  - 批零差 < 0.5 元时高亮提示必须复核；复核人=操作员时提示不得自审
 *  - 发布被整批拒绝时逐行标注阻断原因（已持久化，刷新后仍在），输入原样保留
 */
import { computed, onMounted } from "vue";
import { ElMessage } from "element-plus";
import { FUELS, MARGIN_REVIEW_THRESHOLD, STATIONS } from "@/pricing/constants";
import { densityRangeOf } from "@/pricing/conversion";
import { usePricingStore } from "@/pricing/store";
import type { PriceDraft } from "@/pricing/types";

const store = usePricingStore();

onMounted(() => {
  if (store.drafts.length === 0) store.addDraft();
});

type RowView = {
  draft: PriceDraft;
  values: ReturnType<ReturnType<typeof usePricingStore>["previewDraft"]>["values"];
  liveReasons: string[];
  reviewReasons: string[];
  densityHint: string;
};

const rows = computed<RowView[]>(() =>
  store.drafts.map((draft) => {
    const { values, reasons, reviewReasons } = store.previewDraft(draft);
    const [dmin, dmax] = densityRangeOf(draft.fuel);
    return {
      draft,
      values,
      // 正在编辑时显示实时校验；发布被拒后显示持久化的阻断原因
      liveReasons: reasons,
      reviewReasons,
      densityHint: draft.fuel ? `${dmin} ~ ${dmax} kg/L` : "请先选择油品"
    };
  })
);

const blockedRowCount = computed(
  () => store.drafts.filter((d) => d.blockReasons.length > 0).length
);

function update(draft: PriceDraft, key: keyof PriceDraft, value: string) {
  store.updateDraft(draft.id, { [key]: value });
}

function addRow() {
  store.addDraft();
}

function removeRow(draft: PriceDraft) {
  store.removeDraft(draft.id);
}

function publishAll() {
  const result = store.publish();
  if (result.ok) {
    ElMessage.success(result.message);
  } else {
    ElMessage.error(result.message);
  }
}

function marginClass(margin: number | undefined): string {
  if (margin === undefined) return "";
  return margin < MARGIN_REVIEW_THRESHOLD ? "margin-low" : "margin-ok";
}
</script>

<template>
  <section class="panel sheet">
    <div class="panel-head">
      <div>
        <h2>调价单 · 整批发布</h2>
        <p class="panel-tip">
          批发吨价按密度自动换算每升批发价；任一行数据无效则整批拒绝并保留全部输入。
        </p>
      </div>
      <div class="sheet-actions">
        <button type="button" class="secondary" @click="addRow">＋ 新增一行</button>
        <button type="button" class="primary" @click="publishAll">整批发布</button>
      </div>
    </div>

    <div v-if="blockedRowCount > 0" class="batch-banner">
      上一次发布被整批拒绝：{{ blockedRowCount }} 行存在问题（见各行红色标注），已保留输入，修正后可再次发布。
    </div>

    <div v-if="rows.length === 0" class="empty">
      调价单为空，点击「新增一行」开始调价。
    </div>

    <div v-for="(row, index) in rows" :key="row.draft.id" class="draft-row">
      <div class="draft-index">#{{ index + 1 }}</div>
      <div class="draft-grid">
        <label>
          站点
          <select
            :value="row.draft.station"
            @change="update(row.draft, 'station', ($event.target as HTMLSelectElement).value)"
          >
            <option value="">请选择站点</option>
            <option v-for="s in STATIONS" :key="s" :value="s">{{ s }}</option>
          </select>
        </label>

        <label>
          油品
          <select
            :value="row.draft.fuel"
            @change="update(row.draft, 'fuel', ($event.target as HTMLSelectElement).value)"
          >
            <option value="">请选择油品</option>
            <option v-for="f in FUELS" :key="f" :value="f">{{ f }}</option>
          </select>
        </label>

        <label>
          零售升价（元/升）
          <input
            :value="row.draft.retailPrice"
            type="number"
            step="0.01"
            min="0"
            placeholder="如 7.58"
            @input="update(row.draft, 'retailPrice', ($event.target as HTMLInputElement).value)"
          />
        </label>

        <label>
          批发吨价（元/吨）
          <input
            :value="row.draft.wholesaleTonPrice"
            type="number"
            step="1"
            min="0"
            placeholder="如 8380"
            @input="update(row.draft, 'wholesaleTonPrice', ($event.target as HTMLInputElement).value)"
          />
        </label>

        <label>
          密度（kg/L）
          <input
            :value="row.draft.density"
            type="number"
            step="0.001"
            min="0"
            :placeholder="row.densityHint"
            @input="update(row.draft, 'density', ($event.target as HTMLInputElement).value)"
          />
          <span class="hint">参考区间：{{ row.densityHint }}</span>
        </label>

        <label>
          生效日
          <input
            :value="row.draft.effectiveDate"
            type="date"
            @input="update(row.draft, 'effectiveDate', ($event.target as HTMLInputElement).value)"
          />
        </label>

        <label>
          复核人
          <input
            :value="row.draft.reviewer"
            type="text"
            :placeholder="row.values && row.values.margin < MARGIN_REVIEW_THRESHOLD ? '批零差低于五角，必须复核' : '无需复核时可留空'"
            @input="update(row.draft, 'reviewer', ($event.target as HTMLInputElement).value)"
          />
          <span v-if="row.values && row.values.margin < MARGIN_REVIEW_THRESHOLD" class="hint warn">
            批零差低于 0.50 元，须与操作员不同的复核人确认
          </span>
        </label>

        <div class="calc-box" :class="marginClass(row.values?.margin)">
          <div class="calc-line">
            <span>每升批发价（换算）</span>
            <strong>
              {{ row.values ? row.values.wholesaleLiterPrice.toFixed(4) : "—" }}
              <em>元/升</em>
            </strong>
          </div>
          <div class="calc-line">
            <span>批零差</span>
            <strong>
              {{ row.values ? row.values.margin.toFixed(4) : "—" }}
              <em>元/升</em>
            </strong>
          </div>
        </div>
      </div>

      <ul v-if="row.liveReasons.length > 0" class="reasons">
        <li v-for="reason in row.liveReasons" :key="reason">⚠ {{ reason }}</li>
      </ul>
      <ul v-else-if="row.reviewReasons.length > 0" class="reasons">
        <li v-for="reason in row.reviewReasons" :key="reason">⚠ {{ reason }}</li>
      </ul>
      <!-- 发布被拒后持久化的阻断原因（未再编辑时展示，刷新后仍一致） -->
      <ul v-if="row.draft.blockReasons.length > 0" class="reasons blocked">
        <li v-for="reason in row.draft.blockReasons" :key="reason">⛔ {{ reason }}</li>
      </ul>

      <div class="row-foot">
        <button type="button" class="danger ghost" @click="removeRow(row.draft)">删除本行</button>
      </div>
    </div>
  </section>
</template>
