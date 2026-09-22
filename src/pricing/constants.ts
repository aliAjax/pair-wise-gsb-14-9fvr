/**
 * 批零联动定价台 —— 业务常量
 * 站点、油品选项、取值范围、密度区间、批零差复核阈值。
 */

export const STATIONS = ["城东加油站", "城西加油站", "城南加油站", "城北加油站"] as const;

export const FUELS = ["92号汽油", "95号汽油", "98号汽油", "柴油"] as const;

/** 批零差复核阈值（元/升）：低于该值须复核人确认 */
export const MARGIN_REVIEW_THRESHOLD = 0.5;

/** 零售升价合理区间（元/升） */
export const RETAIL_PRICE_LIMIT = { min: 0.01, max: 100 } as const;

/** 批发吨价合理区间（元/吨） */
export const TON_PRICE_LIMIT = { min: 0.01, max: 1_000_000 } as const;

/** 通用密度兜底区间（kg/L），未按油品配置时使用 */
export const FALLBACK_DENSITY_RANGE: readonly [number, number] = [0.5, 1.2];

/**
 * 各油品密度参考区间（kg/L，20℃）：
 * 汽油约 0.700~0.780，柴油约 0.810~0.870。
 */
export const DENSITY_RANGE_BY_FUEL: Record<string, readonly [number, number]> = {
  "92号汽油": [0.7, 0.78],
  "95号汽油": [0.7, 0.78],
  "98号汽油": [0.7, 0.78],
  柴油: [0.81, 0.87]
};

/** 发布唯一键：同站、同油品、同生效日不可重复发布 */
export function priceKey(station: string, fuel: string, effectiveDate: string): string {
  return `${station}__${fuel}__${effectiveDate}`;
}
