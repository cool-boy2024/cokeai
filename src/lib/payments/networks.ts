import { keccak_256 } from "@noble/hashes/sha3.js";
import { config } from "@/lib/config";

/**
 * USDT networks the shop can quote. TRON keeps the existing TronGrid scanner;
 * BSC and Polygon share one EVM scanner and the BIP44 path m/44'/60'.
 */
export type UsdtNetwork = "trc20" | "bsc" | "polygon";
export type UsdtProvider = "usdt_trc20" | "usdt_bsc" | "usdt_polygon";

export type UsdtNetworkMeta = {
  id: UsdtNetwork;
  provider: UsdtProvider;
  /** Customer-facing name, e.g. "USDT · BSC". */
  label: string;
  /** Short chain tag used in pills and order rows. */
  chainLabel: string;
  kind: "tron" | "evm";
  /** Token decimals on this chain. BSC USDT is 18, not 6. */
  decimals: number;
  contract: string;
  rpcUrl: string;
  requiredConfirmations: number;
  /** The warning we show before the customer scans the address. */
  transferHint: string;
};

export const USDT_NETWORKS: Record<UsdtNetwork, UsdtNetworkMeta> = {
  trc20: {
    id: "trc20",
    provider: "usdt_trc20",
    label: "USDT · TRC20",
    chainLabel: "TRC20",
    kind: "tron",
    decimals: 6,
    contract: config.usdtContract.trim(),
    rpcUrl: config.usdtTronGridUrl,
    requiredConfirmations: config.usdtConfirmations,
    transferHint: "请使用 TRC20 网络转账，其他网络无法到账。",
  },
  bsc: {
    id: "bsc",
    provider: "usdt_bsc",
    label: "USDT · BSC",
    chainLabel: "BEP20",
    kind: "evm",
    decimals: 18,
    contract: config.usdtBscContract.trim(),
    rpcUrl: config.usdtBscRpcUrl,
    requiredConfirmations: config.usdtEvmConfirmations,
    transferHint: "请使用 BNB Smart Chain（BEP20）网络转账，其他网络无法到账。",
  },
  polygon: {
    id: "polygon",
    provider: "usdt_polygon",
    label: "USDT · Polygon",
    chainLabel: "Polygon",
    kind: "evm",
    decimals: 6,
    contract: config.usdtPolygonContract.trim(),
    rpcUrl: config.usdtPolygonRpcUrl,
    requiredConfirmations: config.usdtEvmConfirmations,
    transferHint: "请使用 Polygon（PoS）网络转账，其他网络无法到账。",
  },
};

export const USDT_NETWORK_IDS: UsdtNetwork[] = ["trc20", "bsc", "polygon"];

export function isUsdtNetwork(value: unknown): value is UsdtNetwork {
  return value === "trc20" || value === "bsc" || value === "polygon";
}

export function usdtNetworkMeta(network: UsdtNetwork): UsdtNetworkMeta {
  return USDT_NETWORKS[network];
}

export function networkForProvider(provider: string): UsdtNetwork | null {
  if (provider === "usdt_trc20") return "trc20";
  if (provider === "usdt_bsc") return "bsc";
  if (provider === "usdt_polygon") return "polygon";
  return null;
}

export function providerForNetwork(network: UsdtNetwork): UsdtProvider {
  return USDT_NETWORKS[network].provider;
}

/** Any `usdt_*` provider is chain-paid and follows the deposit lifecycle. */
export function isUsdtProvider(provider: string): boolean {
  return networkForProvider(provider) !== null;
}

/** Normalize an EVM address for storage: lowercase hex without spaces. */
export function normalizeEvmAddress(address: string): string {
  return address.trim().toLowerCase();
}

/**
 * EIP-55 mixed-case checksum. Wallets display this form; storing it keeps
 * copy/paste comparisons visually identical.
 */
export function toChecksumEvmAddress(address: string): string {
  const lower = normalizeEvmAddress(address).replace(/^0x/, "");
  if (!/^[0-9a-f]{40}$/.test(lower)) throw new Error("EVM 地址无效");
  const hash = keccakHex(lower);
  let out = "0x";
  for (let i = 0; i < lower.length; i++) {
    out += parseInt(hash[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i];
  }
  return out;
}

function keccakHex(text: string): string {
  return Buffer.from(keccak_256(new TextEncoder().encode(text))).toString("hex");
}
