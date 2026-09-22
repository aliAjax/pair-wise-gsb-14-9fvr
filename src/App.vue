<script setup lang="ts">
/**
 * 批零联动定价台
 * 分层：src/pricing 下 types(数据) / constants+conversion(换算与校验) /
 *      storage(存储) / store(编排)；本文件与 components 只负责界面。
 */
import { computed } from "vue";
import { MARGIN_REVIEW_THRESHOLD } from "@/pricing/constants";
import { usePricingStore } from "@/pricing/store";
import AdjustmentSheet from "@/components/AdjustmentSheet.vue";
import RecordList from "@/components/RecordList.vue";

const store = usePricingStore();

const metrics = computed(() => [
  { label: "待发布行（调价单）", value: store.drafts.length },
  { label: "已发布价格", value: store.records.length },
  {
    label: `批零差低于${MARGIN_REVIEW_THRESHOLD}元`,
    value: store.records.filter(
      (r) => store.currentVersionOf(r).margin < MARGIN_REVIEW_THRESHOLD
    ).length
  },
  { label: "整批阻断次数", value: store.blockEvents.length }
]);

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", { hour12: false });
}

const blockEventsDesc = computed(() => [...store.blockEvents].reverse().slice(0, 8));
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">石油行业 · 批零联动</p>
          <h1>油品批零联动定价台</h1>
          <p class="subtitle">
            调价单整批录入站点、油品、零售升价、批发吨价、密度与生效日；吨价按密度换算每升批发价，
            批零差低于五角须他人复核。同站同油品同日不可重复发布，任一数据无效整批拒绝并保留输入；
            发布后价格与密度冻结，更正须写原因生成新版本。
          </p>
        </div>
        <div class="stack">
          <span class="tag">Vue3</span>
          <span class="tag">TypeScript</span>
          <span class="tag">Pinia</span>
          <span class="tag">Element Plus</span>
          <span class="tag">localStorage</span>
        </div>
      </header>

      <section class="operator-bar panel">
        <label class="operator-field">
          当前操作员
          <input
            :value="store.operator"
            type="text"
            placeholder="请输入操作员姓名（发布与更正必填）"
            @input="store.setOperator(($event.target as HTMLInputElement).value)"
          />
        </label>
        <p class="operator-rule">
          规则：批零差 &lt; 0.50 元/升时必须由<b>复核人</b>确认，且复核人不得与操作员相同（操作员不得自审）。
        </p>
      </section>

      <section class="metrics">
        <article v-for="m in metrics" :key="m.label" class="metric">
          <span>{{ m.label }}</span>
          <strong>{{ m.value }}</strong>
        </article>
      </section>

      <div class="workspace-stack">
        <AdjustmentSheet />

        <section v-if="blockEventsDesc.length > 0" class="panel block-log">
          <h2>整批阻断记录</h2>
          <p class="panel-tip">每次整批拒绝的逐行阻断原因都会留痕，刷新页面后保持一致。</p>
          <div v-for="event in blockEventsDesc" :key="event.id" class="block-event">
            <div class="block-event-head">
              <strong>{{ formatTime(event.at) }}</strong>
              <span>操作员：{{ event.operator || "（未填写）" }}</span>
              <span>{{ event.rowCount }} 行</span>
            </div>
            <ul v-if="event.globalReasons.length > 0" class="reasons blocked">
              <li v-for="reason in event.globalReasons" :key="reason">⛔ {{ reason }}</li>
            </ul>
            <ul class="reasons blocked">
              <template v-for="(row, i) in event.rows" :key="row.rowId">
                <li v-for="reason in row.reasons" :key="`${row.rowId}-${reason}`">
                  ⛔ 第 {{ i + 1 }} 行：{{ reason }}
                </li>
              </template>
            </ul>
          </div>
        </section>

        <RecordList />
      </div>
    </div>
  </main>
</template>
