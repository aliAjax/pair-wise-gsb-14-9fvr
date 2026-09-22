/**
 * 批零联动定价台 —— 存储层
 * 只负责 PricingState 的序列化/反序列化与 localStorage 读写，
 * 不含任何业务校验。后续切换为后端接口时只需替换本文件。
 */

import type { PricingState } from "./types";

export const STORAGE_KEY = "dfwlfront-9-pricing-v1";
export const SCHEMA_VERSION = 1;

/** 首次进入时的演示数据（已发布、冻结，含一个被更正过的记录以展示版本链） */
function seed(): PricingState {
  const publishedAt = new Date(Date.now() - 3 * 86400000).toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    operator: "",
    drafts: [],
    records: [
      {
        id: "seed-1",
        station: "城东加油站",
        fuel: "92号汽油",
        effectiveDate: "2026-09-20",
        currentVersion: 2,
        publishedAt,
        versions: [
          {
            version: 1,
            retailPrice: 7.62,
            wholesaleTonPrice: 8450,
            density: 0.74,
            wholesaleLiterPrice: 6.253,
            margin: 1.367,
            reason: "",
            operator: "张运营",
            reviewer: "",
            createdAt: publishedAt
          },
          {
            version: 2,
            retailPrice: 7.58,
            wholesaleTonPrice: 8380,
            density: 0.74,
            wholesaleLiterPrice: 6.2012,
            margin: 1.3788,
            reason: "批发价随挂牌价下调，统一片区口径",
            operator: "张运营",
            reviewer: "李复核",
            createdAt: new Date(Date.now() - 86400000).toISOString()
          }
        ]
      },
      {
        id: "seed-2",
        station: "城西加油站",
        fuel: "柴油",
        effectiveDate: "2026-09-20",
        currentVersion: 1,
        publishedAt,
        versions: [
          {
            version: 1,
            retailPrice: 7.18,
            wholesaleTonPrice: 8600,
            density: 0.84,
            wholesaleLiterPrice: 7.224,
            margin: -0.044,
            reason: "",
            operator: "王站长",
            reviewer: "李复核",
            createdAt: publishedAt
          }
        ]
      }
    ],
    blockEvents: []
  };
}

export function loadState(): PricingState {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return seed();
  try {
    const parsed = JSON.parse(raw) as Partial<PricingState>;
    // 基础结构校验，损坏数据回退到初始状态而不是崩溃
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !Array.isArray(parsed.records) ||
      !Array.isArray(parsed.drafts) ||
      !Array.isArray(parsed.blockEvents)
    ) {
      return seed();
    }
    return {
      schemaVersion: SCHEMA_VERSION,
      operator: typeof parsed.operator === "string" ? parsed.operator : "",
      drafts: parsed.drafts as PricingState["drafts"],
      records: parsed.records as PricingState["records"],
      blockEvents: parsed.blockEvents as PricingState["blockEvents"]
    };
  } catch {
    return seed();
  }
}

export function saveState(state: PricingState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
