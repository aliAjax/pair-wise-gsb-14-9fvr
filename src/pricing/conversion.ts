/**
 * 批零联动定价台 —— 换算与校验（纯函数，无存储、无界面依赖）
 *
 * 换算规则：
 *   批发吨价（元/吨）× 密度（kg/L）÷ 1000 = 每升批发价（元/升）
 *   批零差（元/升）= 零售升价 − 每升批发价
 */

import {
  DENSITY_RANGE_BY_FUEL,
  FALLBACK_DENSITY_RANGE,
  MARGIN_REVIEW_THRESHOLD,
  RETAIL_PRICE_LIMIT,
  TON_PRICE_LIMIT
} from "./constants";
import type { PriceValues } from "./types";

/** 数字解析结果：输入无效时给出原因，不静默转 0 */
export interface NumberFieldResult {
  ok: boolean;
  value: number;
  reason?: string;
}

/** 解析为有限数字（拒绝空串、非数字、NaN、Infinity） */
export function parseNumber(raw: string, label: string): NumberFieldResult {
  const text = raw.trim();
  if (text === "") return { ok: false, value: NaN, reason: `${label}不能为空` };
  const value = Number(text);
  if (!Number.isFinite(value)) return { ok: false, value: NaN, reason: `${label}必须是数字` };
  return { ok: true, value };
}

/** 校验日期为合法的 YYYY-MM-DD（防止 2026-02-31 之类） */
export function parseDate(raw: string, label: string): { ok: boolean; reason?: string } {
  const text = raw.trim();
  if (text === "") return { ok: false, reason: `${label}不能为空` };
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return { ok: false, reason: `${label}必须为 YYYY-MM-DD 格式` };
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  const valid =
    date.getFullYear() === Number(y) &&
    date.getMonth() === Number(m) - 1 &&
    date.getDate() === Number(d);
  return valid ? { ok: true } : { ok: false, reason: `${label}不是有效日期` };
}

function inRange(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}

/** 吨价换算每升批发价（元/升） */
export function tonToLiter(wholesaleTonPrice: number, density: number): number {
  return round4((wholesaleTonPrice * density) / 1000);
}

/** 保留 4 位小数后转为 Number，避免浮点尾差 */
export function round4(value: number): number {
  return Number(value.toFixed(4));
}

/** 保留 2 位小数（金额展示/存储统一口径） */
export function round2(value: number): number {
  return Number(value.toFixed(2));
}

/** 取油品密度参考区间 */
export function densityRangeOf(fuel: string): readonly [number, number] {
  return DENSITY_RANGE_BY_FUEL[fuel] ?? FALLBACK_DENSITY_RANGE;
}

/** 单行解析后的数值 */
export interface ParsedRow {
  station: string;
  fuel: string;
  effectiveDate: string;
  retailPrice: number;
  wholesaleTonPrice: number;
  density: number;
  wholesaleLiterPrice: number;
  margin: number;
}

/**
 * 解析并校验单行原始输入。
 * 返回 values（任一关键字段无效时为 null）与 reasons（全部阻断原因，逐字段收集）。
 */
export function validateRow(input: {
  station: string;
  fuel: string;
  retailPrice: string;
  wholesaleTonPrice: string;
  density: string;
  effectiveDate: string;
}): { values: ParsedRow | null; reasons: string[] } {
  const reasons: string[] = [];

  if (!input.station.trim()) reasons.push("站点未选择");
  if (!input.fuel.trim()) reasons.push("油品未选择");

  const retail = parseNumber(input.retailPrice, "零售升价");
  if (!retail.ok) {
    reasons.push(retail.reason!);
  } else if (!inRange(retail.value, RETAIL_PRICE_LIMIT.min, RETAIL_PRICE_LIMIT.max)) {
    reasons.push(`零售升价须在 ${RETAIL_PRICE_LIMIT.min}~${RETAIL_PRICE_LIMIT.max} 元/升之间`);
  }
  if (retail.ok && retail.value <= 0) reasons.push("零售升价必须大于 0");

  const ton = parseNumber(input.wholesaleTonPrice, "批发吨价");
  if (!ton.ok) {
    reasons.push(ton.reason!);
  } else if (!inRange(ton.value, TON_PRICE_LIMIT.min, TON_PRICE_LIMIT.max)) {
    reasons.push(`批发吨价须在 ${TON_PRICE_LIMIT.min}~${TON_PRICE_LIMIT.max} 元/吨之间`);
  }

  const density = parseNumber(input.density, "密度");
  if (!density.ok) {
    reasons.push(density.reason!);
  } else {
    const [dmin, dmax] = densityRangeOf(input.fuel);
    if (!inRange(density.value, dmin, dmax)) {
      reasons.push(
        input.fuel
          ? `${input.fuel}密度须在 ${dmin}~${dmax} kg/L 之间`
          : `密度须在 ${dmin}~${dmax} kg/L 之间`
      );
    }
  }

  const date = parseDate(input.effectiveDate, "生效日");
  if (!date.ok) reasons.push(date.reason!);

  if (reasons.length > 0) return { values: null, reasons };

  const wholesaleLiterPrice = tonToLiter(ton.value, density.value);
  const margin = round4(retail.value - wholesaleLiterPrice);

  return {
    values: {
      station: input.station.trim(),
      fuel: input.fuel.trim(),
      effectiveDate: input.effectiveDate.trim(),
      retailPrice: round2(retail.value),
      wholesaleTonPrice: round2(ton.value),
      density: density.value,
      wholesaleLiterPrice,
      margin
    },
    reasons
  };
}

/** 复核校验：批零差低于五角须复核人，且操作员不得自审 */
export function validateReview(
  values: { margin: number },
  reviewer: string,
  operator: string
): string[] {
  const reasons: string[] = [];
  if (values.margin < MARGIN_REVIEW_THRESHOLD) {
    if (!reviewer.trim()) {
      reasons.push(`批零差 ${values.margin.toFixed(4)} 元/升低于 0.50 元，须由复核人确认`);
    } else if (reviewer.trim() === operator.trim()) {
      reasons.push("操作员不得自审，复核人必须与操作员不同");
    }
  }
  return reasons;
}

/** 更正时的数值校验（站点/油品/生效日不可变，仅校验价格与密度） */
export function validateCorrectionValues(input: {
  retailPrice: string;
  wholesaleTonPrice: string;
  density: string;
  fuel: string;
}): { values: PriceValues | null; reasons: string[] } {
  const result = validateRow({
    station: "占位站点",
    fuel: input.fuel,
    retailPrice: input.retailPrice,
    wholesaleTonPrice: input.wholesaleTonPrice,
    density: input.density,
    effectiveDate: "2026-01-01"
  });
  if (!result.values) return { values: null, reasons: result.reasons };
  const v = result.values;
  return {
    values: {
      retailPrice: v.retailPrice,
      wholesaleTonPrice: v.wholesaleTonPrice,
      density: v.density,
      wholesaleLiterPrice: v.wholesaleLiterPrice,
      margin: v.margin
    },
    reasons: result.reasons
  };
}
