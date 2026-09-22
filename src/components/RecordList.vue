<script setup lang="ts">
/**
 * 已发布价格列表：
 *  - 发布后价格与密度冻结，仅展示不可改
 *  - 更正：必须填写原因 → 生成新版本，旧值保留在版本链中可展开查看
 *  - 复核规则与发布一致：批零差 < 0.5 元须复核人，操作员不得自审
 */
import { computed, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { FUELS, MARGIN_REVIEW_THRESHOLD, STATIONS } from "@/pricing/constants";
import { usePricingStore } from "@/pricing/store";
import type { CorrectionInput, PublishedRecord } from "@/pricing/types";

const store = usePricingStore();

const stationFilter = ref("");
const fuelFilter = ref("");

const filtered = computed(() =>
  store.latestRecords.filter(
    ({ record }) =>
      (!stationFilter.value || record.station === stationFilter.value) &&
      (!fuelFilter.value || record.fuel === fuelFilter.value)
  )
);

const expandedVersions = ref<Record<string, boolean>>({});
const correctingId = ref<string | null>(null);

const correction = reactive<CorrectionInput>({
  retailPrice: "",
  wholesaleTonPrice: "",
  density: "",
  reason: "",
  reviewer: ""
});

function toggleVersions(id: string) {
  expandedVersions.value[id] = !expandedVersions.value[id];
}

function startCorrect(record: PublishedRecord) {
  const v = store.currentVersionOf(record);
  correctingId.value = record.id;
  correction.retailPrice = String(v.retailPrice);
  correction.wholesaleTonPrice = String(v.wholesaleTonPrice);
  correction.density = String(v.density);
  correction.reason = "";
  correction.reviewer = "";
}

function cancelCorrect() {
  correctingId.value = null;
}

function submitCorrect(record: PublishedRecord) {
  const result = store.correct(record.id, { ...correction });
  if (result.ok) {
    ElMessage.success(result.message);
    correctingId.value = null;
  } else {
    ElMessage.error(result.message);
  }
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", { hour12: false });
}
</script>

<template>
  <section class="panel">
    <div class="panel-head">
      <div>
        <h2>已发布价格（冻结）</h2>
        <p class="panel-tip">价格与密度一经发布即冻结；更正须填写原因并生成新版本，旧值保留可查。</p>
      </div>
      <div class="filters">
        <select v-model="stationFilter">
          <option value="">全部站点</option>
          <option v-for="s in STATIONS" :key="s" :value="s">{{ s }}</option>
        </select>
        <select v-model="fuelFilter">
          <option value="">全部油品</option>
          <option v-for="f in FUELS" :key="f" :value="f">{{ f }}</option>
        </select>
      </div>
    </div>

    <div v-if="filtered.length === 0" class="empty">暂无已发布价格</div>

    <article v-for="{ record, version } in filtered" :key="record.id" class="record-card">
      <header class="record-card-head">
        <div>
          <strong class="record-name">{{ record.station }} · {{ record.fuel }}</strong>
          <span class="muted">生效日 {{ record.effectiveDate }}</span>
        </div>
        <span class="version-badge" :class="{ low: version.margin < MARGIN_REVIEW_THRESHOLD }">
          v{{ version.version }}
          <template v-if="version.margin < MARGIN_REVIEW_THRESHOLD"> · 已复核</template>
        </span>
      </header>

      <div class="price-grid">
        <div>
          <span>零售升价</span>
          <strong>{{ version.retailPrice.toFixed(2) }}</strong>
          <em>元/升</em>
        </div>
        <div>
          <span>批发吨价</span>
          <strong>{{ version.wholesaleTonPrice.toFixed(2) }}</strong>
          <em>元/吨</em>
        </div>
        <div>
          <span>密度（冻结）</span>
          <strong>{{ version.density.toFixed(3) }}</strong>
          <em>kg/L</em>
        </div>
        <div>
          <span>每升批发价</span>
          <strong>{{ version.wholesaleLiterPrice.toFixed(4) }}</strong>
          <em>元/升</em>
        </div>
        <div>
          <span>批零差</span>
          <strong :class="version.margin < MARGIN_REVIEW_THRESHOLD ? 'text-low' : ''">
            {{ version.margin.toFixed(4) }}
          </strong>
          <em>元/升</em>
        </div>
      </div>

      <div class="record-meta">
        <span>操作员：{{ version.operator || "—" }}</span>
        <span>复核人：{{ version.reviewer || "无需复核" }}</span>
        <span>发布：{{ formatTime(record.publishedAt) }}</span>
        <button type="button" class="link" @click="toggleVersions(record.id)">
          {{ expandedVersions[record.id] ? "收起版本链" : `查看版本链（${record.versions.length}）` }}
        </button>
      </div>

      <!-- 版本链：旧值全部保留，只读 -->
      <div v-if="expandedVersions[record.id]" class="version-chain">
        <div
          v-for="old in [...record.versions].reverse()"
          :key="old.version"
          class="version-row"
          :class="{ current: old.version === record.currentVersion }"
        >
          <div class="version-row-head">
            <strong>v{{ old.version }}</strong>
            <span v-if="old.version === record.currentVersion" class="tag-current">当前版本</span>
            <span v-else class="tag-frozen">已冻结旧值</span>
            <span class="muted">{{ formatTime(old.createdAt) }}</span>
          </div>
          <div class="version-values">
            <span>零售 {{ old.retailPrice.toFixed(2) }}</span>
            <span>吨价 {{ old.wholesaleTonPrice.toFixed(2) }}</span>
            <span>密度 {{ old.density.toFixed(3) }}</span>
            <span>批/升 {{ old.wholesaleLiterPrice.toFixed(4) }}</span>
            <span>差 {{ old.margin.toFixed(4) }}</span>
          </div>
          <p v-if="old.reason" class="correction-reason">更正原因：{{ old.reason }}</p>
          <p v-else class="muted">首次发布</p>
          <p class="muted small">操作员 {{ old.operator }} ｜ 复核人 {{ old.reviewer || "—" }}</p>
        </div>
      </div>

      <!-- 更正表单 -->
      <div v-if="correctingId === record.id" class="correct-box">
        <h4>更正价格（生成 v{{ record.currentVersion + 1 }}，站点/油品/生效日不可更改）</h4>
        <div class="correct-grid">
          <label>
            新零售升价（元/升）
            <input v-model="correction.retailPrice" type="number" step="0.01" />
          </label>
          <label>
            新批发吨价（元/吨）
            <input v-model="correction.wholesaleTonPrice" type="number" step="1" />
          </label>
          <label>
            新密度（kg/L）
            <input v-model="correction.density" type="number" step="0.001" />
          </label>
          <label class="wide">
            更正原因（必填，旧值将保留）
            <input v-model="correction.reason" type="text" placeholder="如：执行总部调价通知〔2026〕12号" />
          </label>
          <label class="wide">
            复核人（新批零差低于 0.50 元时必填，不得与操作员相同）
            <input v-model="correction.reviewer" type="text" />
          </label>
        </div>
        <div class="correct-actions">
          <button type="button" class="primary" @click="submitCorrect(record)">确认更正并生成新版本</button>
          <button type="button" class="secondary" @click="cancelCorrect">取消</button>
        </div>
      </div>

      <div v-else class="record-actions">
        <button type="button" class="secondary" @click="startCorrect(record)">更正（生成新版本）</button>
      </div>
    </article>
  </section>
</template>
