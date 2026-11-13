import { getUsdtNetworkSettings } from "./settings";
import { USDT_NETWORKS, normalizeEvmAddress, type UsdtNetwork } from "./networks";

/** keccak256("Transfer(address,address,uint256)") */
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export type EvmTransfer = {
  txid: string;
  block: number;
  from: string;
  to: string;
  /** Raw token units; divide by 10^decimals for USDT. */
  units: bigint;
  /** Unix seconds of the block that includes the transfer. */
  timestamp?: number;
};

type JsonRpcLog = {
  address?: string;
  topics?: string[];
  data?: string;
  blockNumber?: string;
  transactionHash?: string;
  logIndex?: string;
};

type JsonRpcResponse<T> = { result?: T; error?: { code?: number; message?: string } };

async function rpc<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
  let response: Response;
  try {
    response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error("链上节点暂时无法连接，请稍后重试");
  }
  if (!response.ok) throw new Error(`链上节点查询失败 (${response.status})`);
  const body = (await response.json()) as JsonRpcResponse<T>;
  if (body.error) throw new Error(`链上节点返回错误：${body.error.message || body.error.code}`);
  if (body.result === undefined) throw new Error("链上节点返回异常");
  return body.result;
}

function hexBlock(value: number): string {
  return `0x${value.toString(16)}`;
}

function parseBlock(value: string | undefined): number {
  const parsed = Number.parseInt(value || "", 16);
  if (!Number.isFinite(parsed)) throw new Error("链上区块号异常");
  return parsed;
}

export async function evmBlockNumber(network: UsdtNetwork): Promise<number> {
  const settings = await getUsdtNetworkSettings(network);
  const result = await rpc<string>(settings.rpcUrl, "eth_blockNumber", []);
  return parseBlock(result);
}

function addressTopic(address: string): string {
  const bare = normalizeEvmAddress(address).replace(/^0x/, "");
  if (!/^[0-9a-f]{40}$/.test(bare)) throw new Error("EVM 收款地址无效");
  return `0x${bare.padStart(64, "0")}`;
}

function sameAddress(a: string | undefined, b: string): boolean {
  return Boolean(a) && normalizeEvmAddress(a!) === normalizeEvmAddress(b);
}

/** Validate one eth_getLogs Transfer log before it can move an order. */
export function parseEvmTransferLog(
  log: JsonRpcLog,
  contract: string,
  recipient: string,
): EvmTransfer | null {
  if (!sameAddress(log.address, contract)) return null;
  const topics = log.topics || [];
  if (topics.length !== 3) return null;
  if (topics[0].toLowerCase() !== TRANSFER_TOPIC) return null;
  // topics[1] is the sender; topics[2] must be our deposit address.
  if (topics[2].toLowerCase() !== addressTopic(recipient)) return null;
  const data = (log.data || "").toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(data)) return null;
  const units = BigInt(data);
  if (units <= 0n) return null;
  const txid = (log.transactionHash || "").toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(txid)) return null;
  if (!log.blockNumber) return null;
  return {
    txid,
    block: parseBlock(log.blockNumber),
    from: `0x${topics[1].slice(-40)}`,
    to: recipient,
    units,
  };
}

/** Exact raw-unit -> USDT conversion without floating point. */
export function evmUnitsToUsdt(units: bigint, decimals: number): number {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error("代币精度异常");
  }
  const micros = (units * 1_000_000n) / 10n ** BigInt(decimals);
  if (micros > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("转账金额超出自动核账范围");
  return Number(micros) / 1_000_000;
}

/** Block timestamp in unix seconds. Used to detect transfers after the quote. */
async function blockTimestamp(network: UsdtNetwork, block: number): Promise<number | undefined> {
  try {
    const settings = await getUsdtNetworkSettings(network);
    const payload = await rpc<{ timestamp?: string }>(
      settings.rpcUrl,
      "eth_getBlockByNumber",
      [hexBlock(block), false],
    );
    const seconds = Number.parseInt(payload.timestamp || "", 16);
    return Number.isFinite(seconds) ? seconds * 1000 : undefined;
  } catch {
    return undefined;
  }
}

/**
 * USDT transfers into `address` on an EVM chain, filtered by the token
 * contract and the Transfer event recipient topic. Ranges are chunked so a
 * public RPC does not reject a long quote-grace window.
 */
export async function evmListTransfers(input: {
  network: UsdtNetwork;
  address: string;
  fromBlock?: number | null;
}): Promise<{ transfers: EvmTransfer[]; latestBlock: number }> {
  const meta = USDT_NETWORKS[input.network];
  if (meta.kind !== "evm") throw new Error("网络类型错误");
  const settings = await getUsdtNetworkSettings(input.network);
  const latestBlock = await evmBlockNumber(input.network);
  // A fresh quote records its creation block; fall back to a bounded window
  // for old rows that predate the column.
  const from = Math.max(
    0,
    Math.min(input.fromBlock ?? latestBlock - 200_000, latestBlock),
  );
  const chunkSize = 5_000;
  const seen = new Set<string>();
  const transfers: EvmTransfer[] = [];
  for (let start = from; start <= latestBlock; start += chunkSize) {
    const end = Math.min(start + chunkSize - 1, latestBlock);
    const logs = await rpc<JsonRpcLog[]>(settings.rpcUrl, "eth_getLogs", [
      {
        address: meta.contract,
        fromBlock: hexBlock(start),
        toBlock: hexBlock(end),
        topics: [TRANSFER_TOPIC, null, addressTopic(input.address)],
      },
    ]);
    if (!Array.isArray(logs)) throw new Error("链上节点返回异常");
    for (const log of logs) {
      const transfer = parseEvmTransferLog(log, meta.contract, input.address);
      if (!transfer) continue;
      const key = `${transfer.txid}:${log.logIndex || "0"}`;
      if (seen.has(key)) continue;
      seen.add(key);
      transfers.push(transfer);
    }
  }
  const latest = [...transfers].sort((a, b) => b.block - a.block)[0];
  if (latest) {
    const timestamp = await blockTimestamp(input.network, latest.block);
    if (timestamp) latest.timestamp = timestamp;
  }
  return { transfers, latestBlock };
}
