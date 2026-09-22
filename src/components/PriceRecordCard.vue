<script setup lang="ts">
// 界面层：单条定价记录卡片，展示冻结的当前版本、历史版本与更正入口。
import { computed, reactive, ref } from "vue";
import {
  type CorrectionInput,
  type PriceRecord,
  DENSITY_MAX,
  DENSITY_MIN,
  MIN_MARGIN_YUAN,
  latestVersion,
  marginOf,
  wholesalePerLiter
} from "../domain/pricing";
import { usePricingStore } from "../stores/pricingStore";

const props = defineProps<{ record: PriceRecord }>();
const store = usePricingStore();

const showVersions = ref(false);
const correctionOpen = ref(false);

const current = computed(() => latestVersion(props.record));
const lowMargin = computed(() => current.value.margin < MIN_MARGIN_YUAN);
const blockReasons = computed(() =>
  store.lastBlockContext === props.record.id ? store.lastBlockReasons : []
);

const correction = reactive<CorrectionInput>({
  retailPricePerLiter: "",
  wholesalePricePerTon: "",
  density: "",
  operator: "",
  reviewer: "",
  reason: ""
});

const correctionPreview = computed(() => {
  const retail = Number(correction.retailPricePerLiter);
  const ton = Number(correction.wholesalePricePerTon);
  const density = Number(correction.density);
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
const correctionLowMargin = computed(() =>
  correctionPreview.value !== null && correctionPreview.value.margin < MIN_MARGIN_YUAN
);

function openCorrection() {
  Object.assign(correction, {
    retailPricePerLiter: String(current.value.retailPricePerLiter),
    wholesalePricePerTon: String(current.value.wholesalePricePerTon),
    density: String(current.value.density),
    operator: current.value.operator,
    reviewer: current.value.reviewer,
    reason: ""
  });
  correctionOpen.value = true;
}

function submitCorrection() {
  if (store.correct(props.record.id, correction)) {
    correctionOpen.value = false;
  }
  // 被阻断时不关闭面板、不清输入，阻断原因由 store 持久化展示
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", { hour12: false });
}
</script>

<template>
  <article class="record">
    <div class="record-head">
      <div>
        <p class="record-title">{{ record.station }} · {{ record.fuel }}</p>
        <p class="record-sub">生效日 {{ record.effectiveDate }}</p>
      </div>
      <span class="status" :class="{ 'status-corrected': record.status === '已更正' }">{{ record.status }}</span>
    </div>

    <div class="details">
      <span>零售升价：<strong>{{ current.retailPricePerLiter }} 元/升</strong></span>
      <span>批发吨价：<strong>{{ current.wholesalePricePerTon }} 元/吨</strong></span>
      <span>密度：<strong>{{ current.density.toFixed(3) }} kg/L</strong></span>
      <span>批发升价（换算）：<strong>{{ current.wholesalePricePerLiter.toFixed(4) }} 元/升</strong></span>
      <span :class="{ 'warn-text': lowMargin }">
        批零差：<strong>{{ current.margin.toFixed(4) }} 元/升</strong>
      </span>
      <span>当前版本：<strong>v{{ current.version }}</strong></span>
      <span>操作员：{{ current.operator }}</span>
      <span>复核人：{{ current.reviewer || "—" }}</span>
    </div>

    <p class="frozen-note">发布后价格与密度已冻结，更正须填写原因并生成新版本。</p>

    <div class="actions">
      <button type="button" @click="openCorrection">更正（生成新版本）</button>
      <button class="secondary" type="button" @click="showVersions = !showVersions">
        {{ showVersions ? "收起版本" : `版本记录（${record.versions.length}）` }}
      </button>
    </div>

    <ul v-if="showVersions" class="version-list">
      <li v-for="version in [...record.versions].reverse()" :key="version.version"
          class="version-item" :class="{ 'version-current': version.version === current.version }">
        <div class="version-head">
          <strong>v{{ version.version }}</strong>
          <span v-if="version.version === current.version" class="version-tag">当前版本</span>
          <span class="version-time">{{ formatTime(version.createdAt) }}</span>
        </div>
        <div class="version-body">
          <span>零售 {{ version.retailPricePerLiter }} 元/升</span>
          <span>批发 {{ version.wholesalePricePerTon }} 元/吨</span>
          <span>密度 {{ version.density.toFixed(3) }} kg/L</span>
          <span>批零差 {{ version.margin.toFixed(4) }} 元</span>
          <span>操作员 {{ version.operator }}{{ version.reviewer ? ` / 复核 ${version.reviewer}` : "" }}</span>
          <span class="version-reason">原因：{{ version.reason }}</span>
        </div>
      </li>
    </ul>

    <form v-if="correctionOpen" class="correction-form" @submit.prevent="submitCorrection">
      <h3>更正在役价格（v{{ current.version }} → v{{ current.version + 1 }}）</h3>
      <div class="form-grid">
        <label>
          零售升价（元/升）
          <input v-model="correction.retailPricePerLiter" type="number" step="0.01" min="0" placeholder="如 7.62" />
        </label>
        <label>
          批发吨价（元/吨）
          <input v-model="correction.wholesalePricePerTon" type="number" step="1" min="0" placeholder="如 9800" />
        </label>
        <label>
          密度（kg/L，{{ DENSITY_MIN }}–{{ DENSITY_MAX }}）
          <input v-model="correction.density" type="number" step="0.001" :min="DENSITY_MIN" :max="DENSITY_MAX" placeholder="如 0.725" />
        </label>
        <label>
          操作员
          <input v-model="correction.operator" placeholder="填写本次更正操作员" />
        </label>
        <label>
          复核人{{ correctionLowMargin ? "（批零差低于五角，必填）" : "（选填）" }}
          <input v-model="correction.reviewer" placeholder="不得与操作员为同一人" />
        </label>
        <label class="span-two">
          更正原因（必填）
          <textarea v-model="correction.reason" placeholder="说明价格或密度更正的依据，将随新版本存档" />
        </label>
      </div>

      <div v-if="correctionPreview" class="preview" :class="{ 'preview-warn': correctionLowMargin }">
        换算批发升价 {{ correctionPreview.perLiter.toFixed(4) }} 元/升，
        批零差 {{ correctionPreview.margin.toFixed(4) }} 元/升
        <template v-if="correctionLowMargin">（低于 {{ MIN_MARGIN_YUAN }} 元，须复核人确认）</template>
      </div>

      <ul v-if="blockReasons.length" class="error-box">
        <li v-for="(reason, index) in blockReasons" :key="index">{{ reason }}</li>
      </ul>

      <div class="actions">
        <button type="submit">提交更正</button>
        <button class="secondary" type="button" @click="correctionOpen = false">取消</button>
      </div>
    </form>
  </article>
</template>
