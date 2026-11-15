/**
 * Pure-function tests for the security status rule.
 * No database and no Redis: the fixtures mirror activity observed on
 * production on 2026-11-15, where a single Google Cloud scanner hit 70
 * blocked paths in 15 minutes and was reported as an "attack".
 */
import {
  SECURITY_STATUS_LABELS,
  attackReasons,
  getSecurityStatus,
  securityStatusRules,
  type SecurityWindowCounts,
} from "../src/lib/security";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERT: ${message}`);
}

function counts(
  input: Partial<SecurityWindowCounts> & {
    probe5m?: number;
    probe15m?: number;
    auth15m?: number;
    rate15m?: number;
  },
): SecurityWindowCounts {
  const {
    probe5m = 0,
    probe15m = 0,
    auth15m = 0,
    rate15m = 0,
    count5mByType: extra5m,
    count15mByType: extra15m,
    ...rest
  } = input;
  const count5mByType: Record<string, number> = { ...(extra5m || {}) };
  if (probe5m > 0) count5mByType.probe = probe5m;
  const count15mByType: Record<string, number> = { ...(extra15m || {}) };
  if (probe15m > 0) count15mByType.probe = probe15m;
  if (auth15m > 0) count15mByType.auth = auth15m;
  if (rate15m > 0) count15mByType.rate_limit = rate15m;
  return {
    count5m: 0,
    count15m: 0,
    count1h: 0,
    count5mByType,
    count15mByType,
    uniqueIps5m: 0,
    uniqueIps15m: 0,
    ...rest,
  };
}

// --- The incident: one scanner, 70 blocked probes --------------------------

const loneScanner = counts({
  count5m: 70,
  count15m: 70,
  count1h: 70,
  probe5m: 70,
  probe15m: 70,
  uniqueIps5m: 1,
  uniqueIps15m: 1,
});
assert(attackReasons(loneScanner).length === 0, "lone scanner is not an attack");
assert(
  getSecurityStatus("normal", loneScanner) === "scan",
  "lone scanner shows the neutral scan state",
);
assert(SECURITY_STATUS_LABELS.scan === "扫描探测", "scan label is neutral");

// A modest scan below the scan threshold is only "watch".
const quietScan = counts({
  count5m: 5,
  count15m: 20,
  count1h: 20,
  probe5m: 5,
  probe15m: 20,
  uniqueIps5m: 1,
  uniqueIps15m: 1,
});
assert(getSecurityStatus("normal", quietScan) === "watch", "small scan is watch");

// --- Distributed probing --------------------------------------------------

const distributed = counts({
  count5m: 60,
  count15m: 60,
  count1h: 60,
  probe5m: 60,
  probe15m: 60,
  uniqueIps5m: securityStatusRules.distributed5mIps,
  uniqueIps15m: 6,
});
assert(attackReasons(distributed).length > 0, "many sources at once is an attack");
assert(getSecurityStatus("normal", distributed) === "attack", "distributed is attack");

const distributedSustained = counts({
  count5m: 30,
  count15m: 120,
  count1h: 120,
  probe5m: 30,
  probe15m: 120,
  uniqueIps5m: 2,
  uniqueIps15m: securityStatusRules.distributed15mIps,
});
assert(
  attackReasons(distributedSustained).length > 0,
  "ten sources over 15 minutes is an attack",
);

// --- Business-endpoint abuse ----------------------------------------------

const bruteForce = counts({
  count5m: 40,
  count15m: 40,
  count1h: 40,
  auth15m: securityStatusRules.attackAbuse15m,
  uniqueIps5m: 1,
  uniqueIps15m: 1,
});
assert(attackReasons(bruteForce).length > 0, "login abuse is an attack");
assert(getSecurityStatus("normal", bruteForce) === "attack", "auth abuse is attack");

// Our own read-only supplier audit trips the shop-page rate limit; that is
// normal traffic, not an attack.
const auditTraffic = counts({
  count5m: 30,
  count15m: 93,
  count1h: 93,
  rate15m: 93,
  uniqueIps5m: 1,
  uniqueIps15m: 1,
});
assert(attackReasons(auditTraffic).length === 0, "audit rate limits are not an attack");
assert(getSecurityStatus("normal", auditTraffic) === "watch", "audit traffic is watch");

// --- Probe flood -----------------------------------------------------------

const flood = counts({
  count5m: securityStatusRules.attackProbe5m,
  count15m: securityStatusRules.attackProbe15m,
  count1h: securityStatusRules.attackProbe15m,
  probe5m: securityStatusRules.attackProbe5m,
  probe15m: securityStatusRules.attackProbe15m,
  uniqueIps5m: 1,
  uniqueIps15m: 1,
});
assert(attackReasons(flood).length > 0, "sustained probe flood is an attack");

// --- Normal and emergency --------------------------------------------------

assert(
  getSecurityStatus(
    "normal",
    counts({ count5m: 2, count15m: 4, count1h: 6, uniqueIps5m: 1, uniqueIps15m: 1 }),
  ) === "normal",
  "quiet traffic is normal",
);
assert(
  getSecurityStatus("emergency", counts({})) === "emergency",
  "emergency wins over everything",
);
assert(
  getSecurityStatus("emergency", loneScanner) === "emergency",
  "emergency wins over scan",
);

// A scanner plus a little unrelated noise is still scan, not watch.
const noisyScan = counts({
  count5m: 45,
  count15m: 72,
  count1h: 72,
  probe5m: 45,
  probe15m: 70,
  count15mByType: { rate_limit: 2 },
  uniqueIps5m: 1,
  uniqueIps15m: 2,
});
assert(attackReasons(noisyScan).length === 0, "scan with two rate limits is not an attack");
assert(getSecurityStatus("normal", noisyScan) === "scan", "scan survives minor noise");

console.log("test-security-status: ok");
