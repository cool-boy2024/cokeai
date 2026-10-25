const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const fullDateFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const shortDateFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  month: "2-digit",
  day: "2-digit",
});

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  return dateTimeFormatter.format(new Date(value));
}

export function formatFullDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  return fullDateFormatter.format(new Date(value));
}

export function formatShortDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  return shortDateFormatter.format(new Date(value));
}

export function formatNumber(value: number | string): string {
  return Number(value || 0).toLocaleString("zh-CN");
}

export function compactNumber(value: number | string): string {
  const n = Number(value || 0);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function daysLeft(value: string | null): number | null {
  if (!value) return null;
  const diff = new Date(value).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / 86_400_000));
}

export function usageStatusLabel(status: string): { label: string; className: string } {
  switch (status) {
    case "succeeded":
      return { label: "成功", className: "badge-green" };
    case "failed":
      return { label: "失败", className: "badge-red" };
    default:
      return { label: "处理中", className: "badge-yellow" };
  }
}

export function orderStatusLabel(status: string): { label: string; className: string } {
  switch (status) {
    case "paid":
      return { label: "已支付", className: "badge-green" };
    case "cancelled":
      return { label: "已取消", className: "badge" };
    case "refunded":
      return { label: "已退款", className: "badge-yellow" };
    default:
      return { label: "待支付", className: "badge-yellow" };
  }
}
