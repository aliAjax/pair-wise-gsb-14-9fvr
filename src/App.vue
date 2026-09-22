<script setup lang="ts">
// 界面层：批零联动定价台 —— 调价单录入、实时换算预览、阻断原因与记录列表。
import { computed, reactive, ref } from "vue";
import PriceRecordCard from "./components/PriceRecordCard.vue";
import {
  type OrderInput,
  DENSITY_MAX,
  DENSITY_MIN,
  FUELS,
  MIN_MARGIN_YUAN,
  STATIONS,
  emptyOrder,
  marginOf,
  wholesalePerLiter
} from "./domain/pricing";
import { usePricingStore } from "./stores/pricingStore";

const store = usePricingStore();

const form = reactive<OrderInput>(emptyOrder());
const filter = ref<string>("全部油品");

const publishBlockReasons = computed(() =>
  store.lastBlockContext === store.PUBLISH_CONTEXT ? store.lastBlockReasons : []
);

const livePreview = computed(() => {
  const retail = Number(form.retailPricePerLiter);
  const ton = Number(form.wholesalePricePerTon);
  const density = Number(form.density);
  if (
    !Number.isFinite(retail) || retail <= 0 ||
    !Number.isFinite(ton) || ton <= 0 ||
    !Number.isFinite(density) || density < DENSITY_MIN || density > DENSITY_MAX
  ) {
    return null;
  }
  const perLiter = wholesalePerLiter(ton, density);
  return { perLiter, margin: marginOf(retail, ton, density) };
});
const liveLowMargin = computed(() => livePreview.value !== null && livePreview.value.margin < MIN_MARGIN_YUAN);

function submit() {
  if (store.publish({ ...form })) {
    // 仅发布成功才清空；整批拒绝时输入原样保留，便于修正后重提
    Object.assign(form, emptyOrder());
  }
}

const filteredRecords = computed(() =>
  filter.value === "全部油品"
    ? store.records
    : store.records.filter((record) => record.fuel === filter.value)
);

const chartRows = computed(() =>
  FUELS.map((fuel) => ({
    fuel,
    value: store.records.filter((record) => record.fuel === fuel).length
  }))
);
const maxChart = computed(() => Math.max(1, ...chartRows.value.map((row) => row.value)));
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">石油行业 · 批零联动定价台</p>
          <h1>批零联动定价台</h1>
          <p class="subtitle">
            按站点、油品录入零售升价、批发吨价、密度与生效日；吨价按密度换算每升批发价，
            批零差低于五角须复核人确认，发布后价格与密度冻结，更正生成新版本并保留旧值。
          </p>
        </div>
        <div class="stack">
          <span class="tag">Vue3</span>
          <span class="tag">Pinia</span>
          <span class="tag">TypeScript</span>
          <span class="tag">localStorage</span>
        </div>
      </header>

      <section class="metrics">
        <article class="metric">
          <span>发布记录</span>
          <strong>{{ store.records.length }}</strong>
        </article>
        <article class="metric">
          <span>批零差不足五角（需复核）</span>
          <strong>{{ store.reviewCount }}</strong>
        </article>
        <article class="metric">
          <span>当前平均批零差（元/升）</span>
          <strong>{{ store.averageMargin }}</strong>
        </article>
      </section>

      <section class="workspace">
        <form class="panel" @submit.prevent="submit">
          <h2>调价单</h2>
          <div class="form-grid">
            <label>
              站点
              <select v-model="form.station">
                <option value="">请选择站点</option>
                <option v-for="station in STATIONS" :key="station" :value="station">{{ station }}</option>
              </select>
            </label>
            <label>
              油品
              <select v-model="form.fuel">
                <option value="">请选择油品</option>
                <option v-for="fuel in FUELS" :key="fuel" :value="fuel">{{ fuel }}</option>
              </select>
            </label>
            <label>
              零售升价（元/升）
              <input v-model="form.retailPricePerLiter" type="number" step="0.01" min="0" placeholder="如 7.62" />
            </label>
            <label>
              批发吨价（元/吨）
              <input v-model="form.wholesalePricePerTon" type="number" step="1" min="0" placeholder="如 9800" />
            </label>
            <label>
              密度（kg/L，{{ DENSITY_MIN }}–{{ DENSITY_MAX }}）
              <input v-model="form.density" type="number" step="0.001" :min="DENSITY_MIN" :max="DENSITY_MAX" placeholder="如 0.725" />
            </label>
            <label>
              生效日
              <input v-model="form.effectiveDate" type="date" />
            </label>
            <label>
              操作员
              <input v-model="form.operator" placeholder="调价单录入人" />
            </label>
            <label>
              复核人{{ liveLowMargin ? "（批零差不足五角，必填）" : "（选填）" }}
              <input v-model="form.reviewer" placeholder="不得与操作员为同一人" />
            </label>
          </div>

          <div v-if="livePreview" class="preview" :class="{ 'preview-warn': liveLowMargin }">
            <p>
              换算批发升价：<strong>{{ livePreview.perLiter.toFixed(4) }} 元/升</strong>
              （吨价 × 密度 ÷ 1000）
            </p>
            <p :class="{ 'warn-text': liveLowMargin }">
              批零差：<strong>{{ livePreview.margin.toFixed(4) }} 元/升</strong>
              <template v-if="liveLowMargin">
                — 低于 {{ MIN_MARGIN_YUAN }} 元，须复核人确认，操作员不得自审
              </template>
            </p>
          </div>

          <ul v-if="publishBlockReasons.length" class="error-box">
            <li v-for="(reason, index) in publishBlockReasons" :key="index">{{ reason }}</li>
          </ul>

          <button class="submit-btn" type="submit">发布调价单</button>
          <p class="form-hint">任一字段无效将整批拒绝，已填写内容保留在表单中。</p>
        </form>

        <section class="list-panel">
          <div class="toolbar">
            <h2>在役定价</h2>
            <select v-model="filter" class="filter-select">
              <option value="全部油品">全部油品</option>
              <option v-for="fuel in FUELS" :key="fuel" :value="fuel">{{ fuel }}</option>
            </select>
          </div>

          <div class="record-grid">
            <div v-if="filteredRecords.length === 0" class="empty">暂无匹配的发布记录</div>
            <PriceRecordCard
              v-for="record in filteredRecords"
              :key="record.id"
              :record="record"
            />
          </div>

          <div class="mini-chart">
            <p class="chart-title">各油品在役记录分布</p>
            <div v-for="row in chartRows" :key="row.fuel" class="bar">
              <span>{{ row.fuel }}</span>
              <div class="bar-track">
                <div class="bar-fill" :style="{ width: `${(row.value / maxChart) * 100}%` }" />
              </div>
              <strong>{{ row.value }}</strong>
            </div>
          </div>
        </section>
      </section>
    </div>
  </main>
</template>
