#!/usr/bin/env python3
"""Scrape public supplier catalogue data for the CokeAI shop.

Data source: aibijia.org, a public price-comparison site. It publishes
`/live-data/products.json` and `/live-data/meta.json` for anyone to read and
allows crawling of everything except `/api/` (see robots.txt).

This tool only touches public, unauthenticated pages. It deliberately does not:

* log in to a supplier account;
* solve or farm CAPTCHAs (Alibaba ESA, Cloudflare Turnstile, ...);
* read supplier order/detail pages that are gated behind those checks;
* place orders.

Those gates are why procurement stays human-confirmed. What we can automate is
the part that matters for pricing and stock: a full, hourly catalogue diff.

Usage:
    python scraper.py                 # feed + html cross-check
    python scraper.py --mode feed     # only the JSON feed
    python scraper.py --out /tmp/x    # custom output root

Output (per run):
    <root>/<timestamp>/meta.raw.json
    <root>/<timestamp>/products.raw.json
    <root>/<timestamp>/offers.jsonl
    <root>/<timestamp>/summary.json
    <root>/<timestamp>/candidates.json
    <root>/<timestamp>/html-check.json     (html mode)
    <root>/latest -> <timestamp>
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from scrapling.fetchers import Fetcher

FEED_PRODUCTS = "https://aibijia.org/live-data/products.json"
FEED_META = "https://aibijia.org/live-data/meta.json"
HOME = "https://aibijia.org/"
SOURCE_NAME = "aibijia"

STATUS_MAP = {
    "in_stock": "in_stock",
    "low_stock": "low_stock",
    "out_of_stock": "out_of_stock",
}

RISK_PATTERNS: dict[str, str] = {
    "account_sale": r"成品号|成品|账号|帐号|独享|老号|新号|白号|黑号|带号",
    "shared": r"共享|车队|拼车|家庭组|合租|团购",
    "topup": r"代充|充值|续费|代付|订阅代开",
    "giftcard": r"礼品卡|兑换码|卡密|CDK|cdkey|激活码",
    "temp_warranty": r"质保\s*\d+\s*(小时|h|H|天)|随取随用|短期|小时卡",
    "offsite_contact": r"QQ|qq|微信|加群|客服",
    "absolute_claim": r"永久|无限|官方保证|永不|100%",
    "reverse_proxy": r"反代|反重力|接码|接口|api|API key",
}

CATEGORY_RULES: list[tuple[str, str]] = [
    ("giftcard", r"礼品卡|兑换码|卡密|CDK|cdkey|激活码"),
    ("topup", r"代充|充值|续费|代付"),
    ("account", r"成品号|账号|帐号|独享|老号|新号|白号|黑号|带号"),
    ("subscription", r"会员|订阅|Plus|plus|Pro|pro|Team|Business|Ultra|年卡|月卡"),
]


def log(message: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {message}", file=sys.stderr)


def fetch(url: str, *, retries: int = 3, timeout: int = 30) -> Any:
    """GET a public URL with TLS impersonation and bounded retries."""
    last: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            page = Fetcher.get(
                url,
                impersonate="chrome",
                stealthy_headers=True,
                timeout=timeout,
                follow_redirects="safe",
            )
            if page.status != 200:
                raise RuntimeError(f"HTTP {page.status} for {url}")
            return page
        except Exception as exc:  # noqa: BLE001 - retry anything transient
            last = exc
            log(f"fetch {url} attempt {attempt}/{retries} failed: {exc}")
            if attempt < retries:
                time.sleep(1.5 * attempt)
    raise RuntimeError(f"could not fetch {url}: {last}")


def sha256_hex(data: bytes | str) -> str:
    if isinstance(data, str):
        data = data.encode("utf-8")
    return hashlib.sha256(data).hexdigest()


def offer_key(url: str, title: str) -> str:
    """Stable per-offer key.

    One supplier URL can list several distinct offers (different titles and
    prices), so keying on the URL alone silently drops rows. Key on
    url + title instead; price is excluded so a price change keeps the key.
    """
    return sha256_hex(f"{url.strip()}\x1f{title.strip()}")


def detect_flags(title: str) -> list[str]:
    return [name for name, pattern in RISK_PATTERNS.items() if re.search(pattern, title)]


def infer_category(title: str) -> str:
    for category, pattern in CATEGORY_RULES:
        if re.search(pattern, title):
            return category
    return "other"


def clean_title(title: str) -> str:
    text = re.sub(r"[\U0001F300-\U0001FAFF☀-➿]", " ", title)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:120]


def curation_score(title: str, flags: list[str], price: float) -> int:
    """Heuristic only: high score means easier to rewrite for a clean storefront."""
    score = 100
    penalties = {
        "shared": 30,
        "account_sale": 20,
        "temp_warranty": 18,
        "absolute_claim": 22,
        "reverse_proxy": 15,
        "offsite_contact": 8,
        "topup": 4,
        "giftcard": 0,
    }
    for flag in flags:
        score -= penalties.get(flag, 5)
    if price <= 0:
        score -= 50
    if len(title) > 70:
        score -= 6
    return max(0, score)


def normalize_offers(products: list[dict[str, Any]]) -> list[dict[str, Any]]:
    offers: list[dict[str, Any]] = []
    for product in products:
        slug = str(product.get("slug") or "").strip()
        product_name = str(product.get("name") or slug).strip()
        for raw in product.get("offers") or []:
            title = str(raw.get("source_title") or "").strip()
            url = str(raw.get("url") or "").strip()
            price = float(raw.get("price") or 0)
            status_raw = str(raw.get("status") or "").strip()
            flags = detect_flags(title)
            offers.append(
                {
                    "external_key": offer_key(url, title),
                    "supplier": SOURCE_NAME,
                    "product_slug": slug,
                    "product_name": product_name,
                    "store": str(raw.get("source_store_name") or "").strip(),
                    "platform": str(raw.get("platform_name") or "").strip(),
                    "source_title": title,
                    "clean_title": clean_title(title),
                    "category": infer_category(title),
                    "flags": flags,
                    "curation_score": curation_score(title, flags, price),
                    "price": round(price, 6),
                    "price_micros": int(round(price * 1_000_000)),
                    "currency": str(raw.get("currency") or "CNY").strip().upper(),
                    "availability": STATUS_MAP.get(status_raw, "out_of_stock"),
                    "url": url,
                    "url_host": re.sub(r"^www\.", "", url.split("/")[2]) if "://" in url else "",
                }
            )
    return offers


def percentile(values: list[float], pct: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    position = (len(ordered) - 1) * pct
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    weight = position - lower
    return round(ordered[lower] * (1 - weight) + ordered[upper] * weight, 2)


def build_summary(
    *,
    meta: dict[str, Any],
    offers: list[dict[str, Any]],
    products_bytes: bytes,
    meta_bytes: bytes,
) -> dict[str, Any]:
    by_product: dict[str, dict[str, Any]] = {}
    for slug in dict.fromkeys(o["product_slug"] for o in offers):
        rows = [o for o in offers if o["product_slug"] == slug]
        available = [o for o in rows if o["availability"] != "out_of_stock"]
        prices = [o["price"] for o in available if o["price"] > 0]
        by_product[slug] = {
            "offers": len(rows),
            "available": len(available),
            "status": dict(Counter(o["availability"] for o in rows)),
            "stores": len({o["store"] for o in rows if o["store"]}),
            "price_min": min(prices) if prices else None,
            "price_p25": percentile(prices, 0.25),
            "price_median": percentile(prices, 0.5),
            "price_p75": percentile(prices, 0.75),
            "price_max": max(prices) if prices else None,
        }

    key_counts = Counter(o["external_key"] for o in offers)
    duplicates = [key for key, count in key_counts.items() if count > 1]
    bad_rows = [
        {
            "external_key": o["external_key"],
            "url": o["url"],
            "title": o["source_title"],
            "reasons": [
                reason
                for reason, failed in (
                    ("missing_title", not o["source_title"]),
                    ("missing_url", not o["url"].startswith("http")),
                    ("non_positive_price", o["price"] <= 0),
                    ("non_cny", o["currency"] != "CNY"),
                )
                if failed
            ],
        }
        for o in offers
        if (
            not o["source_title"]
            or not o["url"].startswith("http")
            or o["price"] <= 0
            or o["currency"] != "CNY"
        )
    ]

    computed_hash = sha256_hex(products_bytes)
    declared_hash = str(meta.get("products_sha256") or "")
    offer_count = meta.get("offer_count")

    return {
        "source": SOURCE_NAME,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "feed_generated_at": meta.get("generated_at"),
        "feed_products_sha256": declared_hash,
        "computed_products_sha256": computed_hash,
        "hash_match": computed_hash == declared_hash,
        "meta_offer_count": offer_count,
        "offers_seen": len(offers),
        "offer_count_match": offer_count in (None, len(offers)),
        "meta_bytes": len(meta_bytes),
        "products_bytes": len(products_bytes),
        "products": by_product,
        "total": {
            "offers": len(offers),
            "available": sum(1 for o in offers if o["availability"] != "out_of_stock"),
            "status": dict(Counter(o["availability"] for o in offers)),
            "stores": dict(Counter(o["store"] for o in offers if o["store"]).most_common()),
            "hosts": dict(Counter(o["url_host"] for o in offers if o["url_host"]).most_common()),
            "categories": dict(Counter(o["category"] for o in offers)),
        },
        "quality": {
            "duplicate_keys": len(duplicates),
            "bad_rows": bad_rows,
            "rows_with_flags": sum(1 for o in offers if o["flags"]),
        },
    }


def build_candidates(offers: list[dict[str, Any]], limit_per_product: int = 8) -> dict[str, Any]:
    """Internal shortlist for an operator. Never expose this to customers."""
    available = [o for o in offers if o["availability"] != "out_of_stock"]
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for offer in available:
        grouped[offer["product_slug"]].append(offer)

    result: dict[str, Any] = {}
    for slug, rows in grouped.items():
        ranked = sorted(
            rows,
            key=lambda o: (
                -o["curation_score"],
                len(o["flags"]),
                o["price"],
            ),
        )
        result[slug] = [
            {
                "external_key": o["external_key"],
                "store": o["store"],
                "title": o["source_title"],
                "category": o["category"],
                "flags": o["flags"],
                "curation_score": o["curation_score"],
                "price": o["price"],
                "availability": o["availability"],
                "url": o["url"],
            }
            for o in ranked[:limit_per_product]
        ]
    return result


def html_check(offers: list[dict[str, Any]], out_dir: Path) -> dict[str, Any]:
    """Cross-check the public JSON feed against the rendered catalogue page.

    Also exercises Scrapling's adaptive selectors: the first run saves element
    fingerprints, later runs relocate them if the page markup shifts.
    """
    adaptive_dir = out_dir.parent / ".adaptive"
    adaptive_dir.mkdir(parents=True, exist_ok=True)
    page = Fetcher.get(
        HOME,
        impersonate="chrome",
        stealthy_headers=True,
        timeout=30,
        selector_config={
            "adaptive": True,
            "storage_args": {"storage_file": str(adaptive_dir / "aibijia.db")},
        },
    )

    cards = page.css(".product-card", auto_save=True)
    html_rows: list[dict[str, Any]] = []
    try:
        for card in cards:
            slug = (card.attrib.get("id") or "").strip()
            summary = (card.css(".product-summary::text").get() or "").strip()
            for offer in card.css(".offer"):
                # Risk-flagged rows wrap the real <a> inside a nested container,
                # so the outer element has no href. Fall back to the anchor.
                href = (offer.attrib.get("href") or "").strip()
                if not href:
                    anchors = offer.css("a[href]")
                    href = (anchors[0].attrib.get("href") or "").strip() if anchors else ""
                title = (offer.css(".offer-title::text").get() or "").strip()
                store = (offer.css(".offer-store-name-source::text").get() or "").strip()
                platform = (offer.css(".offer-store-name-platform::text").get() or "").strip()
                price_text = (offer.css(".platform-price::text").get() or "").strip()
                match = re.search(r"([\d.]+)", price_text)
                html_rows.append(
                    {
                        "external_key": offer_key(href, title),
                        "product_slug": slug,
                        "product_summary": summary,
                        "store": store,
                        "platform": platform,
                        "title": title,
                        "price": float(match.group(1)) if match else None,
                        "url": href,
                        "risk_flagged": bool(offer.css(".offer-risk-trigger")),
                    }
                )
    except Exception as exc:  # noqa: BLE001 - the check must not fail the run
        return {"ok": False, "error": str(exc), "cards": len(cards)}

    feed_keys = {o["external_key"] for o in offers}
    html_keys = {r["external_key"] for r in html_rows}
    missing_in_html = sorted(feed_keys - html_keys)
    missing_in_feed = sorted(html_keys - feed_keys)

    result = {
        "ok": len(html_rows) == len(offers) and not missing_in_html and not missing_in_feed,
        "cards": len(cards),
        "html_offers": len(html_rows),
        "feed_offers": len(offers),
        "missing_in_html": len(missing_in_html),
        "missing_in_feed": len(missing_in_feed),
        "missing_in_html_samples": missing_in_html[:5],
        "missing_in_feed_samples": missing_in_feed[:5],
    }
    (out_dir / "html-offers.json").write_text(
        json.dumps(html_rows, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return result


def write_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def write_jsonl(path: Path, rows: Iterable[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def update_latest(link: Path, target: Path) -> None:
    try:
        if link.is_symlink() or link.exists():
            link.unlink()
        link.symlink_to(target.name, target_is_directory=True)
    except OSError as exc:
        log(f"could not update {link}: {exc}")


def main() -> int:
    default_out = Path(__file__).resolve().parents[2] / ".local-data" / "supplier" / SOURCE_NAME
    parser = argparse.ArgumentParser(description="Scrape public aibijia supplier data")
    parser.add_argument("--mode", choices=("feed", "html", "all"), default="all")
    parser.add_argument("--out", type=Path, default=default_out)
    args = parser.parse_args()

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out_dir = args.out / stamp
    out_dir.mkdir(parents=True, exist_ok=True)

    log(f"fetching meta {FEED_META}")
    meta_page = fetch(FEED_META)
    meta_bytes = meta_page.body
    meta = json.loads(meta_bytes)
    write_json(out_dir / "meta.raw.json", meta)

    log(f"fetching products {FEED_PRODUCTS}")
    products_page = fetch(FEED_PRODUCTS)
    products_bytes = products_page.body
    feed = json.loads(products_bytes)
    write_json(out_dir / "products.raw.json", feed)

    products = feed.get("products") or []
    if not isinstance(products, list) or not products:
        raise RuntimeError("feed has no products array")

    offers = normalize_offers(products)
    write_jsonl(out_dir / "offers.jsonl", offers)

    summary = build_summary(
        meta=meta,
        offers=offers,
        products_bytes=products_bytes,
        meta_bytes=meta_bytes,
    )
    write_json(out_dir / "summary.json", summary)
    write_json(out_dir / "candidates.json", build_candidates(offers))

    if args.mode in ("html", "all"):
        log("cross-checking rendered catalogue page")
        try:
            check = html_check(offers, out_dir)
        except Exception as exc:  # noqa: BLE001
            check = {"ok": False, "error": str(exc)}
        write_json(out_dir / "html-check.json", check)
    else:
        check = {"ok": None, "skipped": True}

    update_latest(args.out / "latest", out_dir)

    result = {
        "out": str(out_dir),
        "offers": len(offers),
        "available": summary["total"]["available"],
        "hash_match": summary["hash_match"],
        "offer_count_match": summary["offer_count_match"],
        "html_check": check.get("ok"),
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))

    if not summary["hash_match"] or not summary["offer_count_match"]:
        log("feed integrity check failed")
        return 2
    if check.get("ok") is False:
        log("html/feed mismatch (feed is still usable)")
        return 3
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(130)
