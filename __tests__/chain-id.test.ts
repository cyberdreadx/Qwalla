import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import {
  ChainIdMismatchError as SdkChainIdMismatchError,
  MAINNET_CHAIN_ID as SDK_MAINNET_CHAIN_ID,
  TESTNET_CHAIN_ID as SDK_TESTNET_CHAIN_ID,
  createSignedShield,
  createSignedTokenApproval,
  serializePayload,
  verifyTransaction,
} from '@rougechain/sdk';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';

import { NETWORKS } from '@/constants/networks';
import {
  ChainIdMismatchError,
  MAINNET_CHAIN_ID,
  TESTNET_CHAIN_ID,
  bindWallet,
  checkDappChainId,
  networkNameForChainId,
  resetChainIdChecks,
  signNodePayload,
  signingChainId,
  verifyChainId,
  withChainId,
} from '@/lib/chain-id';

// Signatures commit to the network: every payload Qwalla signs for the node carries `chainId`,
// cross-checked once per session against the node's /api/health.

const hex = (b: Uint8Array) => Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
const kp = ml_dsa65.keygen(new Uint8Array(32).fill(7));
const wallet = { publicKey: hex(kp.publicKey), privateKey: hex(kp.secretKey) };

function healthFetch(chainId: string | null) {
  return jest.fn(async () =>
    chainId === null
      ? ({ ok: false, json: async () => ({}) } as Response)
      : ({ ok: true, json: async () => ({ status: 'ok', chain_id: chainId, height: 1 }) } as Response),
  ) as unknown as typeof fetch;
}

beforeEach(() => resetChainIdChecks());

describe('network config', () => {
  it('names the exact chain ids', () => {
    expect(NETWORKS.mainnet.chainId).toBe(MAINNET_CHAIN_ID);
    expect(NETWORKS.testnet.chainId).toBe(TESTNET_CHAIN_ID);
    expect(NETWORKS.devnet.chainId).toBeNull();
    expect(networkNameForChainId(MAINNET_CHAIN_ID)).toBe('RougeChain Mainnet');
    expect(networkNameForChainId(TESTNET_CHAIN_ID)).toBe('RougeChain Testnet');
    expect(networkNameForChainId(undefined)).toBe('No network specified');
    expect(networkNameForChainId('other-1')).toBe('Unknown network (other-1)');
  });
});

describe('session cross-check', () => {
  it('accepts a node that reports the configured chain id, once per session', async () => {
    const f = healthFetch(MAINNET_CHAIN_ID);
    await expect(verifyChainId('mainnet', f)).resolves.toBe(MAINNET_CHAIN_ID);
    await expect(verifyChainId('mainnet', f)).resolves.toBe(MAINNET_CHAIN_ID);
    expect(f).toHaveBeenCalledTimes(1);
    expect((f as jest.Mock).mock.calls[0][0]).toBe(`${NETWORKS.mainnet.api}/health`);
  });

  it('refuses to sign when the node reports another chain id', async () => {
    await expect(verifyChainId('mainnet', healthFetch(TESTNET_CHAIN_ID))).rejects.toBeInstanceOf(ChainIdMismatchError);
    // one instanceof covers Qwalla's own check and the SDK client's (same class family and code)
    await expect(verifyChainId('mainnet', healthFetch(TESTNET_CHAIN_ID))).rejects.toBeInstanceOf(SdkChainIdMismatchError);
    await expect(verifyChainId('mainnet', healthFetch(TESTNET_CHAIN_ID))).rejects.toMatchObject({
      code: 'CHAIN_ID_MISMATCH',
      network: 'mainnet',
      expected: MAINNET_CHAIN_ID,
      reported: TESTNET_CHAIN_ID,
    });
    expect(() => signingChainId('mainnet')).toThrow(ChainIdMismatchError);
    expect(checkDappChainId({ chainId: MAINNET_CHAIN_ID }, 'mainnet').ok).toBe(false);
    // the other network is unaffected
    expect(signingChainId('testnet')).toBe(TESTNET_CHAIN_ID);
  });

  it('an unreachable node does not block; the configured id is used', async () => {
    await expect(verifyChainId('testnet', healthFetch(null))).resolves.toBe(TESTNET_CHAIN_ID);
  });

  it('a devnet adopts the id its node reports', async () => {
    expect(signingChainId('devnet')).toBeNull();
    await expect(verifyChainId('devnet', healthFetch('rougechain-local-9'))).resolves.toBe('rougechain-local-9');
    expect(signingChainId('devnet')).toBe('rougechain-local-9');
  });
});

describe('signed payloads', () => {
  it('chainId is inside the signed bytes', () => {
    const tx = signNodePayload(wallet, { type: 'approve', spender: 'aa', token_symbol: 'T', amount: 1 }, MAINNET_CHAIN_ID);
    expect(tx.payload.chainId).toBe(MAINNET_CHAIN_ID);
    expect(new TextDecoder().decode(serializePayload(tx.payload))).toContain(`"chainId":"${MAINNET_CHAIN_ID}"`);
    expect(verifyTransaction(tx)).toBe(true);
    // the same signature does not verify for the payload re-targeted to another network
    expect(verifyTransaction({ ...tx, payload: { ...tx.payload, chainId: TESTNET_CHAIN_ID } })).toBe(false);
  });

  it('withChainId never re-targets a payload', () => {
    expect(withChainId({ a: 1 }, MAINNET_CHAIN_ID)).toEqual({ a: 1, chainId: MAINNET_CHAIN_ID });
    expect(withChainId({ a: 1 }, null)).toEqual({ a: 1 });
    expect(() => withChainId({ chainId: TESTNET_CHAIN_ID }, MAINNET_CHAIN_ID)).toThrow();
  });
});

describe('SDK 1.15 builders on a chain-bound wallet', () => {
  it('the chain ids are the SDK constants', () => {
    expect(MAINNET_CHAIN_ID).toBe(SDK_MAINNET_CHAIN_ID);
    expect(TESTNET_CHAIN_ID).toBe(SDK_TESTNET_CHAIN_ID);
    expect(MAINNET_CHAIN_ID).toBe('rougechain-mainnet-1');
    expect(TESTNET_CHAIN_ID).toBe('rougechain-devnet-1');
  });

  it('shield / token approval (send screen, dApp approve) sign the chain id; unbound = unchanged', () => {
    const shield = createSignedShield(bindWallet(wallet, TESTNET_CHAIN_ID), 5, 'cc'.repeat(32));
    expect(shield.payload).toMatchObject({ type: 'shield', amount: 5, commitment: 'cc'.repeat(32), chainId: TESTNET_CHAIN_ID });
    expect(verifyTransaction(shield)).toBe(true);
    expect(verifyTransaction({ ...shield, payload: { ...shield.payload, chainId: MAINNET_CHAIN_ID } })).toBe(false);
    const appr = createSignedTokenApproval(bindWallet(wallet, MAINNET_CHAIN_ID), 'aa', 'T', 1);
    expect(appr.payload).toMatchObject({ type: 'approve', spender: 'aa', token_symbol: 'T', amount: 1, chainId: MAINNET_CHAIN_ID });
    expect(bindWallet(wallet, null)).toBe(wallet);
    expect(createSignedShield(bindWallet(wallet, null), 5, 'cc'.repeat(32)).payload).not.toHaveProperty('chainId');
    // a wallet bound to one network cannot be re-bound to another
    expect(() => bindWallet(bindWallet(wallet, MAINNET_CHAIN_ID), TESTNET_CHAIN_ID)).toThrow(SdkChainIdMismatchError);
  });
});

describe('@rougechain/sdk type shim', () => {
  // types/rougechain-sdk.d.ts has an explicit export list: every name Qwalla imports from the SDK
  // must be declared there, or tsc fails (createSignedContractCall was once missing).
  const root = path.join(__dirname, '..');
  const shim = readFileSync(path.join(root, 'types/rougechain-sdk.d.ts'), 'utf8');
  const declared = new Set(
    [...shim.matchAll(/export\s+(?:declare\s+)?(?:function|const|class|interface|type|let)\s+([A-Za-z0-9_]+)/g)].map((m) => m[1]),
  );
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      if (['node_modules', '.git', 'desktop', 'web', 'public'].includes(name)) return [];
      if (statSync(full).isDirectory()) return sources(full);
      return /\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts') ? [full] : [];
    });
  }
  const imported = new Set<string>();
  for (const file of sources(root)) {
    for (const m of readFileSync(file, 'utf8').matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'@rougechain\/sdk'/g)) {
      for (const part of m[1].split(',')) {
        const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
        if (name) imported.add(name);
      }
    }
  }

  it('declares every SDK name Qwalla imports (incl. the 1.15.0 chain-id exports)', () => {
    for (const name of ['MAINNET_CHAIN_ID', 'TESTNET_CHAIN_ID', 'ChainIdMismatchError', 'bindWalletToChain', 'createSignedContractCall']) {
      expect(imported.has(name) || name === 'createSignedContractCall').toBe(true);
      expect(declared.has(name)).toBe(true);
    }
    expect([...imported].filter((n) => !declared.has(n))).toEqual([]);
    expect(shim).toMatch(/chainId\?: string;/);
  });
});

describe('dApp approval gate', () => {
  it('allows the selected network, refuses another, warns when missing', () => {
    expect(checkDappChainId({ chainId: MAINNET_CHAIN_ID }, 'mainnet')).toEqual({ ok: true, status: 'match', networkName: 'RougeChain Mainnet' });
    const other = checkDappChainId({ chainId: TESTNET_CHAIN_ID }, 'mainnet');
    expect(other.ok).toBe(false);
    expect(checkDappChainId({ chainId: 5 }, 'mainnet').ok).toBe(false);
    expect(checkDappChainId({ type: 'transfer' }, 'testnet')).toEqual({ ok: true, status: 'missing', networkName: 'RougeChain Testnet' });
  });
});
