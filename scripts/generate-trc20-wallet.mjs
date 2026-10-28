import { HDKey } from "@scure/bip32";
import { generateMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import bs58check from "bs58check";

const mnemonic = generateMnemonic(wordlist, 256);
const seed = mnemonicToSeedSync(mnemonic);
const account = HDKey.fromMasterSeed(seed).derive("m/44'/195'/0'");

function tronAddress(index) {
  const child = account.deriveChild(0).deriveChild(index);
  const uncompressed = secp256k1.Point.fromHex(
    Buffer.from(child.publicKey).toString("hex"),
  ).toBytes(false);
  const hash = keccak_256(uncompressed.slice(1));
  const body = new Uint8Array(21);
  body[0] = 0x41;
  body.set(hash.slice(-20), 1);
  return bs58check.encode(body);
}

console.log("");
console.log("=== CokeAI TRC20 HD wallet ===");
console.log("");
console.log("mnemonic (OFFLINE ONLY, never commit or upload):");
console.log(mnemonic);
console.log("");
console.log("account xpub (put in USDT_TRC20_XPUB):");
console.log(account.publicExtendedKey);
console.log("");
console.log("first deposit addresses:");
for (let i = 0; i < 5; i += 1) {
  console.log(`  m/44'/195'/0'/0/${i}  ${tronAddress(i)}`);
}
console.log("");
console.log("Keep the mnemonic in a safe place. The server only needs the xpub.");
console.log("Fund the sweep wallet with TRX later if you plan automatic consolidation.");
