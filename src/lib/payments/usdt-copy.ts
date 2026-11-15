/**
 * The deposit scanner credits only the amount that lands on chain, and the
 * quote has zero tolerance: a shortfall of 0.01 USDT leaves the order unpaid.
 * Withdrawals from an exchange deduct their fee before the transfer, so the
 * buyer must add that fee on top of the quoted amount. Rendered next to the
 * amount on the shop checkout and the dashboard recharge panel.
 */
export const USDT_FEE_NOTICE = {
  title: "交易所提现会扣手续费，请在转账金额上加上手续费",
  lines: [
    "从交易所提现 USDT 会收取手续费。输入提现数量时请加上这笔手续费，以你提交提现时交易所页面显示的手续费为准。",
    "例如应付 5 USDT：提现 5 USDT 时交易所扣除 0.01 USDT 手续费，实际到账只有 4.99 USDT，少于应付金额会导致订单无法自动完成。",
    "在币安、欧易、火币等交易所直接用微信、支付宝买 U 再提现也一样：请确认扣除手续费后的到账金额不少于应付金额。",
  ],
} as const;
