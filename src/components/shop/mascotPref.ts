"use client";

export const MASCOT_ENABLED_KEY = "cokeai:mascot-enabled";
export const MASCOT_PREF_EVENT = "cokeai:mascot-pref";

/** 缺省开。只有明确写成 "0" 才关。隐私模式读失败时保持开启。 */
export function readMascotEnabled(): boolean {
  try {
    return window.localStorage.getItem(MASCOT_ENABLED_KEY) !== "0";
  } catch {
    return true;
  }
}

export function writeMascotEnabled(on: boolean): void {
  try {
    window.localStorage.setItem(MASCOT_ENABLED_KEY, on ? "1" : "0");
  } catch {
    // 写不进去就保持当前内存状态，不抛给页面。
  }
  window.dispatchEvent(new CustomEvent(MASCOT_PREF_EVENT, { detail: on }));
}
