/**
 * 批零联动定价台 —— 数据模型
 * 该文件只定义数据结构，不包含任何换算、存储或界面逻辑。
 */

/** 调价单草稿（整批中的一行，按用户原始输入以字符串保留，拒绝发布时不丢失） */
export interface PriceDraft {
  id: string;
  /** 站点 */
  station: string;
  /** 油品 */
  fuel: string;
  /** 零售升价（元/升），原始输入 */
  retailPrice: string;
  /** 批发吨价（元/吨），原始输入 */
  wholesaleTonPrice: string;
  /** 密度（kg/L），原始输入 */
  density: string;
  /** 生效日（YYYY-MM-DD） */
  effectiveDate: string;
  /** 复核人：批零差低于阈值时必须填写，且不得与操作员相同 */
  reviewer: string;
  /** 最近一次发布被阻断时，该行对应的阻断原因（持久化，刷新后保持一致） */
  blockReasons: string[];
}

/** 一次调价确定下来的价格数据（含换算结果） */
export interface PriceValues {
  /** 零售升价（元/升） */
  retailPrice: number;
  /** 批发吨价（元/吨） */
  wholesaleTonPrice: number;
  /** 密度（kg/L） */
  density: number;
  /** 由吨价×密度换算得到的每升批发价（元/升） */
  wholesaleLiterPrice: number;
  /** 批零差（元/升）= 零售升价 − 每升批发价 */
  margin: number;
}

/**
 * 冻结的价格版本。
 * 发布成功生成 v1；此后只能通过“更正”追加新版本，旧版本不可修改。
 */
export interface PriceVersion extends PriceValues {
  version: number;
  /** 更正原因（v1 首次发布时为空） */
  reason: string;
  /** 操作员 */
  operator: string;
  /** 复核人（批零差低于阈值时必填） */
  reviewer: string;
  /** 版本创建时间（ISO） */
  createdAt: string;
}

/** 已发布价格：同站、同油品、同生效日全局唯一 */
export interface PublishedRecord {
  id: string;
  station: string;
  fuel: string;
  effectiveDate: string;
  /** 当前生效版本号 */
  currentVersion: number;
  /** 全部版本，按 version 升序，旧值永久保留 */
  versions: PriceVersion[];
  /** 首次发布时间（ISO） */
  publishedAt: string;
}

/** 一次整批发布被阻断的事件（含逐行阻断原因，持久化） */
export interface BlockEvent {
  id: string;
  /** 阻断时间（ISO） */
  at: string;
  /** 当时的操作员 */
  operator: string;
  /** 整单行数 */
  rowCount: number;
  /** 整单级别的阻断原因（如未填操作员） */
  globalReasons: string[];
  /** 逐行阻断原因 */
  rows: { rowId: string; reasons: string[] }[];
}

/** localStorage 持久化的完整状态 */
export interface PricingState {
  schemaVersion: number;
  /** 当前操作员 */
  operator: string;
  /** 调价单草稿（未发布的整批输入） */
  drafts: PriceDraft[];
  /** 已发布价格（含全部历史版本） */
  records: PublishedRecord[];
  /** 阻断事件历史 */
  blockEvents: BlockEvent[];
}

/** 更正表单输入 */
export interface CorrectionInput {
  retailPrice: string;
  wholesaleTonPrice: string;
  density: string;
  reason: string;
  reviewer: string;
}
