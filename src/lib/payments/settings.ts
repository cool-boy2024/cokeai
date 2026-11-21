import { config } from "@/lib/config";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { query, withTransaction } from "@/lib/db";
import { deriveUsdtAddress, validateEvmXpub, validateTronXpub } from "./derive";
import { USDT_NETWORKS, type UsdtNetwork } from "./networks";

type Channel = "alipay_manual" | "usdt_trc20" | "usdt_bsc" | "usdt_polygon";
type StoredSettings = { enabled: boolean; payload_encrypted: string };
export type ManualAlipaySettings = { enabled: boolean; payee: string; qrDataUrl: string };

export type UsdtNetworkSettings = {
  network: UsdtNetwork;
  enabled: boolean;
  xpub: string;
  apiKey: string;
  rpcUrl: string;
  contract: string;
  decimals: number;
  kind: "tron" | "evm";
  requiredConfirmations: number;
};

const CHANNEL_FOR_NETWORK: Record<UsdtNetwork, Channel> = {
  trc20: "usdt_trc20",
  bsc: "usdt_bsc",
  polygon: "usdt_polygon",
};

async function readSettings(channel: Channel) {
  const result = await query<StoredSettings>(
    "SELECT enabled, payload_encrypted FROM payment_settings WHERE channel = $1", [channel],
  );
  const row = result.rows[0];
  if (!row) return null;
  // A rotated APP_ENCRYPTION_KEY, or a dump restored onto another machine,
  // cannot open the ciphertext. Treat that row as absent so product pages,
  // checkout, and the payments screen fall back to env instead of 500.
  try {
    return { enabled: row.enabled, data: JSON.parse(decryptSecret(row.payload_encrypted)) as Record<string, string> };
  } catch (error) {
    console.error(`[payments] ${channel} settings unreadable, using env defaults`, error);
    return null;
  }
}

export async function getManualAlipaySettings(): Promise<ManualAlipaySettings> {
  const saved = await readSettings("alipay_manual");
  return { enabled: saved?.enabled ?? false, payee: saved?.data.payee || "", qrDataUrl: saved?.data.qrDataUrl || "" };
}

function envDefaults(network: UsdtNetwork): UsdtNetworkSettings {
  const meta = USDT_NETWORKS[network];
  if (network === "trc20") {
    return {
      network,
      enabled: config.usdtEnabled,
      xpub: config.usdtXpub,
      apiKey: config.usdtTronGridApiKey,
      rpcUrl: config.usdtTronGridUrl,
      contract: config.usdtContract,
      decimals: meta.decimals,
      kind: meta.kind,
      requiredConfirmations: meta.requiredConfirmations,
    };
  }
  if (network === "bsc") {
    return {
      network,
      enabled: config.usdtBscEnabled,
      xpub: config.usdtBscXpub,
      apiKey: "",
      rpcUrl: config.usdtBscRpcUrl,
      contract: config.usdtBscContract,
      decimals: meta.decimals,
      kind: meta.kind,
      requiredConfirmations: meta.requiredConfirmations,
    };
  }
  return {
    network,
    enabled: config.usdtPolygonEnabled,
    xpub: config.usdtPolygonXpub,
    apiKey: "",
    rpcUrl: config.usdtPolygonRpcUrl,
    contract: config.usdtPolygonContract,
    decimals: meta.decimals,
    kind: meta.kind,
    requiredConfirmations: meta.requiredConfirmations,
  };
}

/**
 * Per-network payment settings. A saved row wins over env for enable state,
 * xpub and (TRON only) the TronGrid key; RPC URLs stay in env so an operator
 * can move to a private endpoint without a database edit.
 */
export async function getUsdtNetworkSettings(network: UsdtNetwork): Promise<UsdtNetworkSettings> {
  const defaults = envDefaults(network);
  const saved = await readSettings(CHANNEL_FOR_NETWORK[network]);
  if (!saved) return defaults;
  return {
    ...defaults,
    enabled: saved.enabled,
    xpub: saved.data.xpub || "",
    apiKey: saved.data.apiKey || "",
  };
}

/** Legacy TRON-shaped view kept for the TronGrid client. */
export async function getUsdtSettings(): Promise<typeof config> {
  const saved = await readSettings("usdt_trc20");
  if (!saved) return config;
  return { ...config, usdtEnabled: saved.enabled, usdtXpub: saved.data.xpub || "", usdtTronGridApiKey: saved.data.apiKey || "" };
}

export function validateNetworkXpub(network: UsdtNetwork, xpub: string): void {
  if (network === "trc20") validateTronXpub(xpub);
  else validateEvmXpub(xpub);
}

/** Whether this network is both enabled and able to derive an address. */
export async function isUsdtNetworkConfigured(network: UsdtNetwork): Promise<boolean> {
  const settings = await getUsdtNetworkSettings(network);
  if (!settings.enabled || !settings.xpub) return false;
  try {
    validateNetworkXpub(network, settings.xpub);
    deriveUsdtAddress(network, 0, settings.xpub);
    return true;
  } catch {
    return false;
  }
}

/** Every network the checkout may offer, in display order. */
export async function configuredUsdtNetworks(): Promise<UsdtNetwork[]> {
  const ids: UsdtNetwork[] = ["trc20", "bsc", "polygon"];
  const flags = await Promise.all(ids.map((id) => isUsdtNetworkConfigured(id)));
  return ids.filter((_, index) => flags[index]);
}

/** With a network: that chain is ready. Without: at least one chain is ready. */
export async function isUsdtConfigured(network?: UsdtNetwork): Promise<boolean> {
  if (network) return isUsdtNetworkConfigured(network);
  return (await configuredUsdtNetworks()).length > 0;
}

export async function savePaymentSettings(channel: Channel, enabled: boolean, data: Record<string, string>, adminId: string) {
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO payment_settings (channel, enabled, payload_encrypted, updated_by)
       VALUES ($1,$2,$3,$4) ON CONFLICT (channel) DO UPDATE
       SET enabled = EXCLUDED.enabled, payload_encrypted = EXCLUDED.payload_encrypted,
           updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [channel, enabled, encryptSecret(JSON.stringify(data)), adminId],
    );
    await client.query("INSERT INTO payment_settings_audit (channel, enabled, admin_id) VALUES ($1,$2,$3)", [channel, enabled, adminId]);
  });
}

export function settingsChannelForNetwork(network: UsdtNetwork): Channel {
  return CHANNEL_FOR_NETWORK[network];
}
