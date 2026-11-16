/**
 * 订单进度日志的客户可见文案（纯数据，无数据库依赖）。
 *
 * 订单事件表同时存着运营内部信息：运营备注、采购单号、打回原因、成本快照。
 * 客户页只渲染这里列出的 event，文案也全部由我们重写，不读 note 字段。
 *
 * 想给客户看新事件：在 CUSTOMER_EVENT_COPY 里加一条，否则永远不会显示。
 */

export type CustomerEventCopy = {
  label: string;
  detail: string;
  tone?: "warn";
};

export const CUSTOMER_EVENT_COPY: Record<
  string,
  { label: string; detail: string; tone?: "warn" }
> = {
  created: { label: "订单已提交", detail: "订单已创建，等待你完成付款。" },
  paid: { label: "付款已确认", detail: "我们已收到款项，开始安排。" },
  procuring: { label: "正在处理", detail: "正在为你采购 / 准备交付内容。" },
  delivered: { label: "已交付", detail: "交付内容已生成，可在本页查看。" },
  revealed: { label: "已查看交付内容", detail: "你已查看过卡密 / 账号信息。" },
  payment_claim_rejected: {
    label: "付款信息需要补充",
    detail: "运营未能核实到账，请核对后重新提交付款信息，或联系客服。",
    tone: "warn",
  },
  refund_requested: { label: "已申请退款", detail: "退款由人工处理，进度可在本页查看。" },
  refunded: { label: "退款已完成", detail: "款项已按原渠道退回，到账时间以支付渠道为准。" },
  expired: { label: "订单已过期", detail: "超时未付款，订单已关闭。" },
  alipay_unreported: {
    label: "等待核对付款",
    detail: "已超过付款时限且未提交付款信息。如果你已经转账，请联系客服并提供订单号。",
    tone: "warn",
  },
  out_of_stock: {
    label: "货源临时缺货",
    detail: "正在补货。我们会尽快处理，也可以联系客服取消订单。",
    tone: "warn",
  },
};
