export function parseYuanMicros(value: string): bigint {
  if (!/^(0|[1-9]\d{0,8})(\.\d{1,2})?$/.test(value)) throw new Error("金额须为正数，最多两位小数");
  const [whole, fraction = ""] = value.split(".");
  const amount = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(2, "0")) * 10_000n;
  if (amount <= 0n) throw new Error("金额须大于 0");
  return amount;
}

export function validOrderId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function receiptReference(value: string): string {
  const ref = value.trim();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(ref)) throw new Error("请填写账单中的完整交易号（8–80 位字母、数字、下划线或连字符）");
  return ref;
}

export function qrImageDataUrl(bytes: Buffer): string {
  if (!bytes.length || bytes.length > 450_000) throw new Error("收款码图片须小于 450 KB");
  const png = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!png && !jpg) throw new Error("请上传 PNG 或 JPG 收款码图片");
  return `data:image/${png ? "png" : "jpeg"};base64,${bytes.toString("base64")}`;
}
