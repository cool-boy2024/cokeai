"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function ProcurementCopy({ text, label = "复制采购信息" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <button className="btn btn-light btn-sm" type="button" onClick={copy}>
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {copied ? "已复制" : label}
    </button>
  );
}
