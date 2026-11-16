import { createHash } from "node:crypto";
import { query } from "@/lib/db";

/**
 * 工单图片存储。
 *
 * 客户要发收款码、报错截图，纯文字说不清。这里只接受真实图片，按 sha256
 * 去重存进 support_images，读取走带鉴权的路由（不是公开静态资源）。
 *
 * 有意限制得比较紧：
 * - 只认 PNG / JPEG / WebP，GIF 不收（动图容易夹带、也没必要）；
 * - 单张 ≤ 5MB，一条消息最多 3 张；
 * - 用文件头判断真实类型，不信 Content-Type —— 那个是客户端说了算的。
 */

const MAX_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES_PER_MESSAGE = 3;

type ImageKind = { mime: string; ext: string };

/** 用 magic bytes 判断，而不是看浏览器给的 MIME。 */
export function detectImageKind(bytes: Uint8Array): ImageKind | null {
  if (bytes.length < 12) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { mime: "image/png", ext: "png" };
  }

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: "image/jpeg", ext: "jpg" };
  }

  // WebP: "RIFF" .... "WEBP"
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { mime: "image/webp", ext: "webp" };
  }

  return null;
}

export class SupportImageError extends Error {}

/**
 * 校验并保存一张图，返回它的 hash。已经存在的图直接复用（内容寻址）。
 */
export async function saveSupportImage(
  bytes: Uint8Array,
  declaredName = "",
): Promise<string> {
  if (bytes.byteLength === 0) throw new SupportImageError("图片是空的");
  if (bytes.byteLength > MAX_BYTES) {
    throw new SupportImageError(
      `图片不能超过 ${Math.floor(MAX_BYTES / 1024 / 1024)}MB（当前 ${(bytes.byteLength / 1024 / 1024).toFixed(1)}MB）`,
    );
  }
  const kind = detectImageKind(bytes);
  if (!kind) {
    throw new SupportImageError(
      `不支持的图片格式${declaredName ? `（${declaredName}）` : ""}，请上传 PNG / JPG / WebP`,
    );
  }

  const hash = createHash("sha256").update(bytes).digest("hex");
  await query(
    `INSERT INTO support_images (hash, mime, ext, bytes, byte_size)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (hash) DO NOTHING`,
    [hash, kind.mime, kind.ext, Buffer.from(bytes), bytes.byteLength],
  );
  return hash;
}

/** 把若干图片挂到一条消息上，保持上传顺序。 */
export async function attachImagesToMessage(
  messageId: string,
  hashes: string[],
): Promise<void> {
  const unique = [...new Set(hashes)].slice(0, MAX_IMAGES_PER_MESSAGE);
  for (let i = 0; i < unique.length; i += 1) {
    await query(
      `INSERT INTO support_message_images (message_id, image_hash, position)
       VALUES ($1, $2, $3)
       ON CONFLICT (message_id, image_hash) DO NOTHING`,
      [messageId, unique[i], i],
    );
  }
}

/** 批量取消息对应的图片 hash，按消息分组。 */
export async function loadMessageImages(
  messageIds: string[],
): Promise<Map<string, string[]>> {
  const grouped = new Map<string, string[]>();
  if (messageIds.length === 0) return grouped;
  const rows = await query<{ message_id: string; image_hash: string }>(
    `SELECT message_id, image_hash
       FROM support_message_images
      WHERE message_id = ANY($1::uuid[])
      ORDER BY position ASC`,
    [messageIds],
  );
  for (const row of rows.rows) {
    const list = grouped.get(row.message_id) || [];
    list.push(row.image_hash);
    grouped.set(row.message_id, list);
  }
  return grouped;
}

export async function getSupportImage(
  hash: string,
): Promise<{ mime: string; bytes: Buffer } | null> {
  const result = await query<{ mime: string; bytes: Buffer }>(
    "SELECT mime, bytes FROM support_images WHERE hash = $1",
    [hash],
  );
  return result.rows[0] || null;
}
