import Link from "next/link";

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="logo" aria-label="CokeAI 首页">
      <span className="logo-mark">C</span>
      <span>
        CokeAI<span className="logo-dot">.</span>
      </span>
    </Link>
  );
}
