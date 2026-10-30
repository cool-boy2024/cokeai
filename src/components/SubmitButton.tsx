"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton({
  children,
  pendingText = "处理中…",
  className = "btn btn-primary btn-block",
  disabled = false,
}: {
  children: React.ReactNode;
  pendingText?: string;
  className?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button className={className} type="submit" disabled={pending || disabled}>
      {pending ? pendingText : children}
    </button>
  );
}
