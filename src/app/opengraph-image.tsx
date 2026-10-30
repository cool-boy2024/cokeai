import { ImageResponse } from "next/og";
import { PUBLIC_API_SALES_ENABLED } from "@/lib/public-features";

export const alt = PUBLIC_API_SALES_ENABLED
  ? "CokeAI, AI APIs and digital goods priced in RMB"
  : "CokeAI digital goods shop, manually reviewed and tracked by order";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          padding: 64,
          background: "#f7f6f3",
          color: "#161615",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            width: "100%",
            height: "100%",
            padding: 56,
            border: "1px solid #e6e3dc",
            borderRadius: 24,
            background: "#ffffff",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div
              style={{
                display: "flex",
                width: 56,
                height: 56,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 14,
                background: "#161615",
                color: "#ffffff",
                fontSize: 28,
                fontWeight: 700,
              }}
            >
              C
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                fontSize: 30,
                fontWeight: 600,
                letterSpacing: "-0.04em",
              }}
            >
              CokeAI
              <span style={{ color: "#1f6f5c" }}>.</span>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div
              style={{
                display: "flex",
                fontSize: 22,
                letterSpacing: "0.08em",
                color: "#1f6f5c",
              }}
            >
              {PUBLIC_API_SALES_ENABLED
                ? "AI API · DIGITAL GOODS"
                : "DIGITAL GOODS · HUMAN REVIEW"}
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                fontSize: 68,
                fontWeight: 600,
                letterSpacing: "-0.05em",
                lineHeight: 1.05,
              }}
            >
              {PUBLIC_API_SALES_ENABLED ? (
                <>
                  <span>One endpoint.</span>
                  <span style={{ color: "#666666" }}>Every model you need.</span>
                </>
              ) : (
                <>
                  <span>Accounts, codes,</span>
                  <span style={{ color: "#666666" }}>subscriptions.</span>
                </>
              )}
            </div>
            <div
              style={{
                display: "flex",
                fontSize: 26,
                color: "#6b6862",
              }}
            >
              {PUBLIC_API_SALES_ENABLED
                ? "OpenAI compatible · Pay as you go · Priced in RMB"
                : "Manual review · Order tracking · Priced in RMB"}
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              paddingTop: 24,
              borderTop: "1px solid #e6e3dc",
              fontSize: 20,
              color: "#6b6862",
            }}
          >
            <span>cokeai.cc.cd</span>
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span
                style={{
                  display: "flex",
                  width: 10,
                  height: 10,
                  borderRadius: 999,
                  background: "#1f6f5c",
                }}
              />
              {PUBLIC_API_SALES_ENABLED
                ? "Balance never expires"
                : "Order progress in your dashboard"}
            </span>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
