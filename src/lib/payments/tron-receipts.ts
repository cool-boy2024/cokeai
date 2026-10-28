import bs58check from "bs58check";

const TRANSFER_TOPIC = "ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
export type SolidReceipt = {
  id?: string; blockNumber?: number; blockTimeStamp?: number;
  receipt?: { result?: string }; result?: string;
  log?: Array<{ address?: string; topics?: string[]; data?: string }>;
};
export type VerifiedTransfer = {
  transaction_id: string; log_index: number; block: number; block_timestamp: number;
  from: string; to: string; type: string; value: string;
  token_info: { address: string; decimals: number; symbol: string; name: string };
};
function tronHex(address: string) {
  const decoded = bs58check.decode(address);
  if (decoded.length !== 21 || decoded[0] !== 0x41) throw new Error("TRON 地址无效");
  return Buffer.from(decoded).subarray(1).toString("hex");
}

// Only solidity receipts are accepted by the caller. Parse actual USDT logs,
// never infer deposits from balances or from the token name/symbol.
export function verifiedTransfers(receipt: SolidReceipt, txid: string, recipient: string, contract: string): VerifiedTransfer[] {
  if (!/^[a-f0-9]{64}$/i.test(txid) || receipt.id !== txid || receipt.receipt?.result !== "SUCCESS" || (receipt.result && receipt.result !== "SUCCESS")) return [];
  if (!Number.isSafeInteger(receipt.blockNumber) || receipt.blockNumber! <= 0 || !Number.isSafeInteger(receipt.blockTimeStamp) || receipt.blockTimeStamp! <= 0) return [];
  const contractHex = tronHex(contract);
  const toHex = tronHex(recipient);
  return (receipt.log || []).flatMap((log, i) => {
    const topics = log.topics || [];
    if (log.address?.toLowerCase() !== contractHex || topics.length !== 3 || topics[0]?.toLowerCase() !== TRANSFER_TOPIC) return [];
    if (!topics.slice(1).every(t => /^0{24}[a-f0-9]{40}$/i.test(t)) || topics[2].slice(24).toLowerCase() !== toHex || !/^[a-f0-9]{64}$/i.test(log.data || "")) return [];
    const value = BigInt(`0x${log.data}`);
    if (value <= 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return [];
    return [{ transaction_id: txid, log_index: i, block: receipt.blockNumber!, block_timestamp: receipt.blockTimeStamp!, from: bs58check.encode(Buffer.from(`41${topics[1].slice(24)}`, "hex")), to: recipient, type: "Transfer", value: value.toString(), token_info: { address: contract, decimals: 6, symbol: "USDT", name: "Tether USD" } }];
  });
}

export function sumTransferUnits(transfers: Array<{ value: string | number }>): bigint {
  return transfers.reduce((sum, transfer) => {
    if (!/^\d+$/.test(String(transfer.value))) throw new Error("链上金额无效");
    return sum + BigInt(transfer.value);
  }, 0n);
}
