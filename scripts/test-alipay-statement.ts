import {
  decodeStatement,
  parseAlipayStatement,
  splitCsvLine,
} from "../src/lib/shop/alipay-statement";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERT: ${message}`);
}

const ORDER_NO = "CK20261116A1B2C3D4";

const SAMPLE = [
  "支付宝交易明细查询",
  "账号：cokeai@example.com",
  "起始时间：2026-11-01 00:00:00",
  "终止时间：2026-11-30 23:59:59",
  "",
  "交易时间,交易分类,交易对方,对方账号,商品说明,收/支,金额,收/付款方式,交易状态,交易订单号,商家订单号,备注",
  `2026-11-16 10:23:45,转账,张*,zhang***@example.com,转账,收入,30.15,余额,交易成功,2026111622001456781234567890,,订单号 ${ORDER_NO}`,
  '2026-11-16 11:02:10,转账,李*,"li***@example.com",转账,收入,90.00,余额,交易成功,2026111622001456781234567891,,"买两个, 谢谢"',
  '2026-11-16 12:00:00,转账,王*,wang***@example.com,转账,支出,15.00,余额,交易成功,2026111622001456781234567892,,',
  '2026-11-16 13:00:00,转账,赵*,zhao***@example.com,转账,收入,20.00,余额,交易关闭,2026111622001456781234567893,,',
  "----------",
  "共 4 笔",
].join("\n");

function main() {
  // 1. 表头前有说明行也能找到表头，并且只保留「收入 + 交易成功」。
  const parsed = parseAlipayStatement(SAMPLE);
  assert(parsed.rows.length === 2, `应解析出 2 条收入，实际 ${parsed.rows.length}`);
  assert(parsed.skipped === 2, `应跳过 2 条（支出 + 交易关闭），实际 ${parsed.skipped}`);

  // 2. 备注里的订单号被识别出来，并转成大写。
  const withOrder = parsed.rows[0];
  assert(withOrder.orderNo === ORDER_NO, `订单号识别失败：${withOrder.orderNo}`);
  assert(withOrder.amountMicros === 30_150_000, `金额解析失败：${withOrder.amountMicros}`);
  assert(
    withOrder.occurredAt === new Date("2026-11-16T10:23:45+08:00").toISOString(),
    `时间解析失败：${withOrder.occurredAt}`,
  );
  assert(withOrder.tradeNo === "2026111622001456781234567890", "交易号解析失败");

  // 3. 备注里带逗号（引号包裹）不会把列错位。
  const quoted = parsed.rows[1];
  assert(quoted.remark === "买两个, 谢谢", `带逗号的备注解析失败：${quoted.remark}`);
  assert(quoted.orderNo === null, "不该从这条里识别出订单号");
  assert(quoted.amountMicros === 90_000_000, `金额解析失败：${quoted.amountMicros}`);

  // 4. CSV 切分本身。
  assert(
    splitCsvLine('a,"b,c",d', ",").join("|") === "a|b,c|d",
    "CSV 引号切分失败",
  );
  assert(
    splitCsvLine('a,"b""c",d', ",").join("|") === 'a|b"c|d',
    "CSV 转义引号失败",
  );

  // 5. 不是账单的文件要给出可读的提示，而不是静默返回空。
  const bogus = parseAlipayStatement("hello,world\n1,2");
  assert(bogus.rows.length === 0, "非账单文件不该产生记录");
  assert(
    bogus.warnings.length > 0 && bogus.warnings[0].includes("表头"),
    "非账单文件应提示找不到表头",
  );

  // 6. 编码：UTF-8 BOM 与 GB18030 都要能解。
  const utf8 = new TextEncoder().encode(`﻿${SAMPLE}`);
  assert(decodeStatement(utf8).startsWith("支付宝交易明细查询"), "UTF-8 BOM 解码失败");

  // 「转账」两个字用 GB18030 编码（D7 AA D5 CB），不是合法 UTF-8。
  const gbkBytes = Uint8Array.from([
    0xd7, 0xaa, 0xd5, 0xcb,
    0x0a,
    0x31, 0x2c, 0x32,
  ]);
  assert(decodeStatement(gbkBytes).split("\n")[0] === "转账", "GB18030 解码失败");

  console.log(
    JSON.stringify(
      {
        ok: true,
        rows: parsed.rows.length,
        skipped: parsed.skipped,
        orderNo: parsed.rows[0].orderNo,
      },
      null,
      2,
    ),
  );
}

main();
