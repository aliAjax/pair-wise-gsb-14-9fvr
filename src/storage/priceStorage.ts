// 存储层：localStorage 持久化，负责记录、版本与最近一次阻断原因的读写，刷新后状态一致。
import {
  type PriceRecord,
  type PriceVersion,
  wholesalePerLiter,
  marginOf
} from "../domain/pricing";

export const STORAGE_KEY = "dfwlfront-9-pricing-console";

export interface PersistedState {
  records: PriceRecord[];
  lastBlockReasons: string[];
  lastBlockContext: string;
}

function buildVersion(
  version: number,
  retail: number,
  ton: number,
  density: number,
  reason: string,
  operator: string,
  reviewer: string,
  createdAt: string
): PriceVersion {
  return {
    version,
    retailPricePerLiter: retail,
    wholesalePricePerTon: ton,
    wholesalePricePerLiter: wholesalePerLiter(ton, density),
    density,
    margin: marginOf(retail, ton, density),
    reason,
    operator,
    reviewer,
    createdAt
  };
}

function seedRecords(): PriceRecord[] {
  return [
    {
      id: "seed-1",
      station: "城东加油站",
      fuel: "92号汽油",
      effectiveDate: "2026-09-23",
      status: "已更正",
      createdAt: "2026-09-20T08:30:00.000Z",
      versions: [
        buildVersion(1, 7.58, 9800, 0.725, "首次发布", "李调价", "", "2026-09-20T08:30:00.000Z"),
        buildVersion(2, 7.62, 9800, 0.725, "零售价录入错误，按挂牌文件更正", "李调价", "", "2026-09-21T02:10:00.000Z")
      ]
    },
    {
      id: "seed-2",
      station: "港区加油站",
      fuel: "柴油",
      effectiveDate: "2026-09-23",
      status: "生效中",
      createdAt: "2026-09-21T09:00:00.000Z",
      versions: [
        buildVersion(1, 7.18, 8100, 0.835, "批发走弱，批零差不足，经复核后发布", "赵值班", "王复核", "2026-09-21T09:00:00.000Z")
      ]
    },
    {
      id: "seed-3",
      station: "城西加油站",
      fuel: "95号汽油",
      effectiveDate: "2026-09-24",
      status: "生效中",
      createdAt: "2026-09-21T14:20:00.000Z",
      versions: [
        buildVersion(1, 8.16, 9650, 0.735, "正常调价", "李调价", "", "2026-09-21T14:20:00.000Z")
      ]
    }
  ];
}

export function loadState(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      if (Array.isArray(parsed.records)) {
        return {
          records: parsed.records as PriceRecord[],
          lastBlockReasons: Array.isArray(parsed.lastBlockReasons) ? parsed.lastBlockReasons : [],
          lastBlockContext: typeof parsed.lastBlockContext === "string" ? parsed.lastBlockContext : ""
        };
      }
    }
  } catch {
    // 存储损坏时回落到种子数据
  }
  return { records: seedRecords(), lastBlockReasons: [], lastBlockContext: "" };
}

export function saveState(state: PersistedState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 存储空间不可用时静默处理，本次会话内状态仍可用
  }
}
