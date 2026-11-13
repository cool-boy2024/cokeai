import { HDKey } from "@scure/bip32";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import bs58check from "bs58check";
import { toChecksumEvmAddress, type UsdtNetwork } from "./networks";

/** TRON addresses use the BIP44 coin type 195. */
export function validateTronXpub(xpub: string): void {
  if (!/^xpub[1-9A-HJ-NP-Za-km-z]{100,115}$/.test(xpub)) throw new Error("请输入账户扩展公钥 xpub");
  const account = HDKey.fromExtendedKey(xpub);
  if (account.privateKey || account.depth !== 3 || account.index !== 0x80000000) {
    throw new Error("xpub 须为 m/44'/195'/0' 的账户公钥");
  }
}

/**
 * BSC and Polygon share the standard EVM path m/44'/60'/0'. An account xpub
 * at depth 3 is required; the purpose can only be confirmed by the operator
 * comparing the derived first address in their own wallet.
 */
export function validateEvmXpub(xpub: string): void {
  if (!/^xpub[1-9A-HJ-NP-Za-km-z]{100,115}$/.test(xpub)) throw new Error("请输入账户扩展公钥 xpub");
  const account = HDKey.fromExtendedKey(xpub);
  if (account.privateKey || account.depth !== 3 || account.index !== 0x80000000) {
    throw new Error("xpub 须为 m/44'/60'/0' 的账户公钥");
  }
}

export function validateUsdtXpub(xpub: string): void {
  validateTronXpub(xpub);
}

function assertIndex(index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= 0x80000000) {
    throw new Error("USDT 派生索引无效");
  }
}

export function deriveTronAddress(index: number, xpub: string): string {
  assertIndex(index);
  validateTronXpub(xpub);
  // The configured account xpub is m/44'/195'/0'; deposit addresses live on
  // the external chain: .../0/index.
  const account = HDKey.fromExtendedKey(xpub);
  const child = account.deriveChild(0).deriveChild(index);
  if (!child.publicKey) throw new Error("无法派生收款地址");
  const uncompressed = secp256k1.Point.fromHex(
    Buffer.from(child.publicKey).toString("hex"),
  ).toBytes(false);
  const hash = keccak_256(uncompressed.slice(1));
  const body = new Uint8Array(21);
  body[0] = 0x41; // Tron mainnet address version
  body.set(hash.slice(-20), 1);
  return bs58check.encode(body);
}

/** EVM address for m/44'/60'/0'/0/index, in EIP-55 checksum form. */
export function deriveEvmAddress(index: number, xpub: string): string {
  assertIndex(index);
  validateEvmXpub(xpub);
  const account = HDKey.fromExtendedKey(xpub);
  const child = account.deriveChild(0).deriveChild(index);
  if (!child.publicKey) throw new Error("无法派生收款地址");
  const uncompressed = secp256k1.Point.fromHex(
    Buffer.from(child.publicKey).toString("hex"),
  ).toBytes(false);
  const hash = keccak_256(uncompressed.slice(1));
  const hex = Buffer.from(hash.slice(-20)).toString("hex");
  return toChecksumEvmAddress(hex);
}

export function deriveUsdtAddress(network: UsdtNetwork, index: number, xpub: string): string {
  return network === "trc20" ? deriveTronAddress(index, xpub) : deriveEvmAddress(index, xpub);
}
