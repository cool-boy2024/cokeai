import Link from "next/link";
import Image from "next/image";

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="logo" aria-label="CokeAI 首页">
      <Image
        src="/icon.svg?v=orange-blue-1"
        className="logo-mark"
        width={28}
        height={28}
        alt=""
        aria-hidden="true"
        unoptimized
      />
      <span>
        CokeAI<span className="logo-dot">.</span>
      </span>
    </Link>
  );
}
