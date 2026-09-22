// 领域层：数据模型 + 批零换算 + 调价单校验，全部为纯函数，不依赖存储与界面。

export const MIN_MARGIN_YUAN = 0.5;
export const DENSITY_MIN = 0.6;
export const DENSITY_MAX = 1.2;

export const STATIONS = ["城东加油站", "城西加油站", "港区加油站", "高速服务区站"] as const;
export const FUELS = ["92号汽油", "95号汽油", "98号汽油", "柴油"] as const;

export type RecordStatus = "生效中" | "已更正";

/** 价格快照版本：发布为 v1，每次更正在同一记录上追加新版本，旧值永久保留。 */
export interface PriceVersion {
  version: number;
  retailPricePerLiter: number;
  wholesalePricePerTon: number;
  wholesalePricePerLiter: number;
  density: number;
  margin: number;
  reason: string;
  operator: string;
  reviewer: string;
  createdAt: string;
}

/** 发布后的定价记录：站点+油品+生效日唯一，价格与密度按版本冻结。 */
export interface PriceRecord {
  id: string;
  station: string;
  fuel: string;
  effectiveDate: string;
  status: RecordStatus;
  createdAt: string;
  versions: PriceVersion[];
}

/** 调价单原始输入（界面以字符串保存，校验失败时原样保留）。 */
export interface OrderInput {
  station: string;
  fuel: string;
  retailPricePerLiter: string;
  wholesalePricePerTon: string;
  density: string;
  effectiveDate: string;
  operator: string;
  reviewer: string;
}

/** 更正单原始输入（站点、油品、生效日随记录冻结，仅可更正价格与密度）。 */
export interface CorrectionInput {
  retailPricePerLiter: string;
  wholesalePricePerTon: string;
  density: string;
  operator: string;
  reviewer: string;
  reason: string;
}

export interface ParsedOrder {
  station: string;
  fuel: string;
  retailPricePerLiter: number;
  wholesalePricePerTon: number;
  wholesalePricePerLiter: number;
  density: number;
  margin: number;
  effectiveDate: string;
  operator: string;
  reviewer: string;
}

export interface ParsedCorrection {
  retailPricePerLiter: number;
  wholesalePricePerTon: number;
  wholesalePricePerLiter: number;
  density: number;
  margin: number;
  operator: string;
  reviewer: string;
  reason: string;
}

export type ValidationResult<T> = { value: T; errors: [] } | { value: null; errors: string[] };

export function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/** 批发吨价 + 密度(kg/L) 换算每升批发价：吨价 × 密度 ÷ 1000。 */
export function wholesalePerLiter(wholesalePricePerTon: number, density: number): number {
  return round4((wholesalePricePerTon * density) / 1000);
}

/** 批零差 = 零售升价 − 换算后的批发升价。 */
export function marginOf(retailPricePerLiter: number, wholesalePricePerTon: number, density: number): number {
  return round4(retailPricePerLiter - wholesalePerLiter(wholesalePricePerTon, density));
}

export function needsReview(margin: number): boolean {
  return margin < MIN_MARGIN_YUAN;
}

function finitePositive(raw: string): number | null {
  if (raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function densityInRange(raw: string): number | null {
  if (raw.trim() === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return value >= DENSITY_MIN && value <= DENSITY_MAX ? value : null;
}

interface ParsedNumbers {
  retail: number;
  ton: number;
  density: number;
  perLiter: number;
  margin: number;
}

function parseNumbers(input: {
  retailPricePerLiter: string;
  wholesalePricePerTon: string;
  density: string;
}): { numbers: ParsedNumbers | null; errors: string[] } {
  const errors: string[] = [];
  const retail = finitePositive(input.retailPricePerLiter);
  if (retail === null) errors.push("零售升价须为大于 0 的数字");

  const ton = finitePositive(input.wholesalePricePerTon);
  if (ton === null) errors.push("批发吨价须为大于 0 的数字");

  const density = densityInRange(input.density);
  if (density === null) errors.push(`密度须为 ${DENSITY_MIN}–${DENSITY_MAX} kg/L 之间的数字`);

  if (errors.length > 0 || retail === null || ton === null || density === null) {
    return { numbers: null, errors };
  }

  const perLiter = wholesalePerLiter(ton, density);
  const margin = round4(retail - perLiter);
  return { numbers: { retail, ton, density, perLiter, margin }, errors };
}

function checkReviewRule(margin: number, operator: string, reviewer: string, errors: string[]): void {
  if (!needsReview(margin)) return;
  if (!reviewer) {
    errors.push(
      `批零差仅 ${margin.toFixed(4)} 元，低于 ${MIN_MARGIN_YUAN.toFixed(2)} 元，须由复核人确认后发布`
    );
    return;
  }
  if (reviewer === operator) {
    errors.push("操作员不得自审：复核人必须与操作员为不同的人");
  }
}

/**
 * 校验调价单：任一数据无效即返回全部阻断原因（整批拒绝）。
 * existing 用于拦截「同站同油品同日重复发布」。
 */
export function validateOrder(
  input: OrderInput,
  existing: Array<Pick<PriceRecord, "station" | "fuel" | "effectiveDate">>
): ValidationResult<ParsedOrder> {
  const errors: string[] = [];
  const station = input.station.trim();
  const fuel = input.fuel.trim();
  const operator = input.operator.trim();
  const reviewer = input.reviewer.trim();

  if (!station) errors.push("站点不能为空");
  if (!fuel) errors.push("油品不能为空");
  if (!input.effectiveDate) errors.push("生效日不能为空");
  if (!operator) errors.push("操作员不能为空");

  const { numbers, errors: numberErrors } = parseNumbers(input);
  errors.push(...numberErrors);
  if (numbers) checkReviewRule(numbers.margin, operator, reviewer, errors);

  if (station && fuel && input.effectiveDate) {
    const duplicated = existing.some(
      (record) =>
        record.station === station &&
        record.fuel === fuel &&
        record.effectiveDate === input.effectiveDate
    );
    if (duplicated) {
      errors.push(`${station} 的 ${fuel} 在 ${input.effectiveDate} 已发布，同站同油品同日不能重复发布`);
    }
  }

  if (errors.length > 0 || !numbers) {
    return { value: null, errors };
  }

  return {
    value: {
      station,
      fuel,
      retailPricePerLiter: numbers.retail,
      wholesalePricePerTon: numbers.ton,
      wholesalePricePerLiter: numbers.perLiter,
      density: numbers.density,
      margin: numbers.margin,
      effectiveDate: input.effectiveDate,
      operator,
      reviewer
    },
    errors: []
  };
}

/** 校验更正单：价格与密度规则同调价单，且必须填写更正原因。 */
export function validateCorrection(input: CorrectionInput): ValidationResult<ParsedCorrection> {
  const errors: string[] = [];
  const operator = input.operator.trim();
  const reviewer = input.reviewer.trim();
  const reason = input.reason.trim();

  if (!operator) errors.push("操作员不能为空");
  if (!reason) errors.push("更正必须填写原因");

  const { numbers, errors: numberErrors } = parseNumbers(input);
  errors.push(...numberErrors);
  if (numbers) checkReviewRule(numbers.margin, operator, reviewer, errors);

  if (errors.length > 0 || !numbers) {
    return { value: null, errors };
  }

  return {
    value: {
      retailPricePerLiter: numbers.retail,
      wholesalePricePerTon: numbers.ton,
      wholesalePricePerLiter: numbers.perLiter,
      density: numbers.density,
      margin: numbers.margin,
      operator,
      reviewer,
      reason
    },
    errors: []
  };
}

export function latestVersion(record: PriceRecord): PriceVersion {
  return record.versions[record.versions.length - 1];
}

export function emptyOrder(): OrderInput {
  return {
    station: "",
    fuel: "",
    retailPricePerLiter: "",
    wholesalePricePerTon: "",
    density: "",
    effectiveDate: "",
    operator: "",
    reviewer: ""
  };
}
