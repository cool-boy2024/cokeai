"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { adminSaveShopVariantsAction } from "@/app/actions/admin-shop";

export type AdminVariantRow = {
  id: string;
  label: string;
  badge: string;
  price_micros: number;
  warranty_type: string;
  warranty_days: number;
  warranty_note: string;
  availability: string;
  preorder: boolean;
  sort_order: number;
};

type DraftRow = {
  id: string;
  label: string;
  badge: string;
  price: string;
  warrantyType: string;
  warrantyDays: string;
  warrantyNote: string;
  availability: string;
  preorder: boolean;
};

function toDraft(row: AdminVariantRow): DraftRow {
  return {
    id: row.id,
    label: row.label,
    badge: row.badge,
    price: (row.price_micros / 1_000_000).toFixed(2),
    warrantyType: row.warranty_type,
    warrantyDays: String(row.warranty_days),
    warrantyNote: row.warranty_note,
    availability: row.availability,
    preorder: row.preorder,
  };
}

function emptyRow(): DraftRow {
  return {
    id: "",
    label: "",
    badge: "",
    price: "",
    warrantyType: "first_login",
    warrantyDays: "0",
    warrantyNote: "",
    availability: "in_stock",
    preorder: false,
  };
}

/**
 * Operator editor for the product's selectable options ("宝贝类型"). Saves
 * the whole list in one submit; empty rows are dropped client-side and the
 * server action deactivates options that are no longer present.
 */
export function VariantEditor({
  productId,
  initialVariants,
}: {
  productId: string;
  initialVariants: AdminVariantRow[];
}) {
  const [rows, setRows] = useState<DraftRow[]>(initialVariants.map(toDraft));

  const update = (index: number, patch: Partial<DraftRow>) => {
    setRows((current) =>
      current.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  };

  const payload = JSON.stringify(
    rows
      .filter((row) => row.label.trim())
      .map((row, index) => ({
        id: row.id || undefined,
        label: row.label.trim(),
        badge: row.badge.trim(),
        price: Number(row.price || 0),
        warrantyType: row.warrantyType,
        warrantyDays: Number(row.warrantyDays || 0),
        warrantyNote: row.warrantyNote.trim(),
        availability: row.availability,
        preorder: row.preorder,
        sortOrder: index,
      })),
  );

  return (
    <form action={adminSaveShopVariantsAction} className="shop-admin-form">
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="variants" value={payload} />

      <p className="shop-muted">
        买家在商品页点击切换档位，价格、质保和可售状态随之变化；不需要为每个档位单独建商品。
        留空则商品按单一价格销售。删除的档位会被停用，已下单的订单记录不受影响。
      </p>

      {rows.length === 0 ? (
        <div className="empty">还没有档位。点击下方「添加档位」。</div>
      ) : (
        <div className="shop-variant-editor">
          {rows.map((row, index) => (
            <div className="shop-variant-editor-row" key={row.id || `new-${index}`}>
              <div className="shop-variant-editor-head">
                <span>档位 {index + 1}</span>
                <button
                  className="btn btn-light btn-sm"
                  type="button"
                  onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
                >
                  <Trash2 size={14} /> 删除
                </button>
              </div>
              <div className="shop-form-grid">
                <label className="shop-field">
                  <span>名称</span>
                  <input
                    value={row.label}
                    onChange={(event) => update(index, { label: event.target.value })}
                    placeholder="如：1 个月 / 3 个月 / 独享"
                    maxLength={80}
                  />
                </label>
                <label className="shop-field">
                  <span>售价（元）</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={row.price}
                    onChange={(event) => update(index, { price: event.target.value })}
                    placeholder="0.00"
                  />
                </label>
                <label className="shop-field">
                  <span>角标（可选）</span>
                  <input
                    value={row.badge}
                    onChange={(event) => update(index, { badge: event.target.value })}
                    placeholder="如：热销 / 推荐"
                    maxLength={40}
                  />
                </label>
                <label className="shop-field">
                  <span>库存状态</span>
                  <select
                    value={row.availability}
                    onChange={(event) =>
                      update(index, { availability: event.target.value })
                    }
                  >
                    <option value="in_stock">有货</option>
                    <option value="low_stock">库存紧张</option>
                    <option value="out_of_stock">缺货</option>
                    <option value="paused">暂停销售</option>
                  </select>
                </label>
                <label className="shop-field">
                  <span>质保类型</span>
                  <select
                    value={row.warrantyType}
                    onChange={(event) =>
                      update(index, { warrantyType: event.target.value })
                    }
                  >
                    <option value="first_login">首登质保</option>
                    <option value="days">按天质保</option>
                    <option value="none">无质保</option>
                  </select>
                </label>
                <label className="shop-field">
                  <span>质保天数</span>
                  <input
                    type="number"
                    min="0"
                    value={row.warrantyDays}
                    onChange={(event) =>
                      update(index, { warrantyDays: event.target.value })
                    }
                  />
                </label>
                <label className="shop-field">
                  <span>质保说明（可选）</span>
                  <input
                    value={row.warrantyNote}
                    onChange={(event) =>
                      update(index, { warrantyNote: event.target.value })
                    }
                    maxLength={300}
                  />
                </label>
                <label className="shop-compliance">
                  <input
                    type="checkbox"
                    checked={row.preorder}
                    onChange={(event) =>
                      update(index, { preorder: event.target.checked })
                    }
                  />
                  <span>按预定单销售（该档位）</span>
                </label>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="shop-form-actions">
        <button
          className="btn btn-light"
          type="button"
          onClick={() => setRows((current) => [...current, emptyRow()])}
        >
          <Plus size={14} /> 添加档位
        </button>
        <button className="btn btn-primary" type="submit">
          保存档位
        </button>
      </div>
    </form>
  );
}
