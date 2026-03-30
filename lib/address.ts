/**
 * Native-compatible pubkeyToAddress using @noble/hashes instead of crypto.subtle.
 * Produces the same rouge1... bech32m addresses as the SDK.
 */
import { sha256 } from '@noble/hashes/sha2';

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32M_CONST = 0x2bc830a3;
const HRP = 'rouge';

function polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const b = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((b >> i) & 1) chk ^= GEN[i];
    }
  }
  return chk;
}

function hrpExpand(hrp: string): number[] {
  const ret: number[] = [];
  for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) >> 5);
  ret.push(0);
  for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) & 31);
  return ret;
}

function createChecksum(hrp: string, data: number[]): number[] {
  const values = hrpExpand(hrp).concat(data).concat([0, 0, 0, 0, 0, 0]);
  const pm = polymod(values) ^ BECH32M_CONST;
  const ret: number[] = [];
  for (let i = 0; i < 6; i++) ret.push((pm >> (5 * (5 - i))) & 31);
  return ret;
}

function convertBits(data: Uint8Array, fromBits: number, toBits: number): number[] {
  let acc = 0;
  let bits = 0;
  const ret: number[] = [];
  const maxv = (1 << toBits) - 1;
  for (const value of data) {
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      ret.push((acc >> bits) & maxv);
    }
  }
  if (bits > 0) ret.push((acc << (toBits - bits)) & maxv);
  return ret;
}

function bech32mEncode(hrp: string, data: Uint8Array): string {
  const data5bit = convertBits(data, 8, 5);
  const checksum = createChecksum(hrp, data5bit);
  const combined = data5bit.concat(checksum);
  let result = hrp + '1';
  for (const d of combined) result += CHARSET[d];
  return result;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

/**
 * Convert a hex public key to a rouge1... bech32m address.
 * Uses @noble/hashes for SHA-256, works on native iOS/Android.
 */
export function nativePubkeyToAddress(publicKeyHex: string): string {
  const pkBytes = hexToBytes(publicKeyHex);
  const hash = sha256(pkBytes);
  return bech32mEncode(HRP, hash);
}
