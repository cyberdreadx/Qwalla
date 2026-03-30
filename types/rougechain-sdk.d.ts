declare module '@rougechain/sdk' {
  export class Wallet {
    publicKey: string;
    privateKey: string;
    mnemonic?: string;
    static generate(strength?: number): Wallet;
    static generateRandom(): Wallet;
    static fromMnemonic(mnemonic: string, passphrase?: string): Wallet;
    static fromKeys(publicKey: string, privateKey: string): Wallet;
    toJSON(): { publicKey: string; privateKey: string; mnemonic?: string };
    verify(): boolean;
    address(): Promise<string>;
  }

  export class RougeChain {
    constructor(baseUrl: string, options?: { apiKey?: string; fetch?: typeof fetch });
    nft: unknown;
    dex: {
      getPools(): Promise<unknown[]>;
      getPool(poolId: string): Promise<unknown>;
      getPriceHistory(poolId: string): Promise<unknown[]>;
      getPoolStats(poolId: string): Promise<unknown>;
      getPoolEvents(poolId: string): Promise<unknown>;
      quote(params: unknown): Promise<unknown>;
      swap(wallet: Wallet, params: unknown): Promise<unknown>;
      createPool(wallet: Wallet, params: unknown): Promise<unknown>;
      addLiquidity(wallet: Wallet, params: unknown): Promise<unknown>;
      removeLiquidity(wallet: Wallet, params: unknown): Promise<unknown>;
    };
    bridge: unknown;
    mail: {
      registerName(wallet: Wallet, name: string, walletId: string): Promise<{ success: boolean; error?: string; data?: unknown }>;
      resolveName(name: string): Promise<{
        entry: { name: string; wallet_id: string };
        wallet: { id: string; signing_public_key: string; encryption_public_key: string; display_name?: string };
      } | null>;
      reverseLookup(walletId: string): Promise<string | null>;
      releaseName(wallet: Wallet, name: string): Promise<{ success: boolean; error?: string }>;
      send(wallet: Wallet, params: {
        from: string;
        to: string;
        encrypted_subject?: string;
        encrypted_body?: string;
        body?: string;
        reply_to_id?: string;
      }): Promise<{ success: boolean; error?: string; data?: unknown }>;
      getInbox(wallet: Wallet): Promise<unknown[]>;
      getSent(wallet: Wallet): Promise<unknown[]>;
      getTrash(wallet: Wallet): Promise<unknown[]>;
      getMessage(wallet: Wallet, messageId: string): Promise<unknown>;
      move(wallet: Wallet, messageId: string, folder: string): Promise<{ success: boolean; error?: string }>;
      markRead(wallet: Wallet, messageId: string): Promise<{ success: boolean; error?: string }>;
      delete(wallet: Wallet, messageId: string): Promise<{ success: boolean; error?: string }>;
    };
    messenger: {
      getWallets(): Promise<unknown[]>;
      registerWallet(wallet: Wallet, opts: {
        id: string;
        displayName: string;
        signingPublicKey: string;
        encryptionPublicKey: string;
        discoverable?: boolean;
      }): Promise<{ success: boolean; error?: string; data?: unknown }>;
      getConversations(wallet: Wallet): Promise<unknown[]>;
      createConversation(wallet: Wallet, participantIds: string[], opts?: Record<string, unknown>): Promise<{
        success: boolean;
        error?: string;
        data?: unknown;
      }>;
      getMessages(wallet: Wallet, conversationId: string): Promise<unknown[]>;
      sendMessage(
        wallet: Wallet,
        conversationId: string,
        encryptedContent: string,
        opts?: {
          messageType?: string;
          selfDestruct?: boolean;
          destructAfterSeconds?: number;
          spoiler?: boolean;
        }
      ): Promise<{ success: boolean; error?: string; data?: unknown }>;
      deleteMessage(wallet: Wallet, messageId: string, conversationId: string): Promise<{ success: boolean; error?: string }>;
      deleteConversation(wallet: Wallet, conversationId: string): Promise<{ success: boolean; error?: string }>;
      markRead(wallet: Wallet, messageId: string, conversationId: string): Promise<{ success: boolean; error?: string }>;
    };
    shielded: {
      getStats(): Promise<{ total_shielded: number; active_commitments: number; spent_nullifiers: number }>;
      isNullifierSpent(nullifierHex: string): Promise<{ spent: boolean }>;
      shield(wallet: Wallet, params: { amount: number }): Promise<{ success: boolean; error?: string; note?: { commitment: string; nullifier: string; value: number; randomness: string; ownerPubKey: string } }>;
      unshield(wallet: Wallet, params: { nullifiers: string[]; amount: number; proof: string }): Promise<{ success: boolean; error?: string }>;
    };
    get(path: string): Promise<unknown>;
    post(path: string, body: unknown): Promise<unknown>;
    getStats(): Promise<unknown>;
    getHealth(): Promise<unknown>;
    getBlocks(opts?: { limit?: number }): Promise<unknown>;
    getBalance(publicKey: string): Promise<{ balance: number; tokens?: Record<string, number> }>;
    getTransactions(opts?: unknown): Promise<unknown>;
    getTokens(): Promise<unknown>;
    getValidators(): Promise<unknown>;
    resolveAddress(address: string): Promise<{ publicKey: string; address: string; balance: number }>;
    getNonce(publicKey: string): Promise<{ nonce: number; next_nonce: number }>;
    transfer(
      wallet: Wallet,
      params: { to: string; amount: number; fee?: number; token?: string }
    ): Promise<{ success: boolean; error?: string }>;
    faucet(wallet: Wallet): Promise<{ success: boolean; error?: string }>;
    signRequest(wallet: Wallet, payload: Record<string, unknown>): unknown;
    registerPushToken(
      wallet: Wallet,
      pushToken: string,
      platform?: string
    ): Promise<{ success: boolean; error?: string }>;
    unregisterPushToken(
      wallet: Wallet
    ): Promise<{ success: boolean; error?: string }>;
    createToken(
      wallet: Wallet,
      params: { name: string; symbol: string; totalSupply: number; image?: string }
    ): Promise<{ success: boolean; error?: string }>;
    updateTokenMetadata(
      wallet: Wallet,
      params: { symbol: string; image?: string; description?: string; website?: string }
    ): Promise<{ success: boolean; error?: string }>;
    burn(wallet: Wallet, amount: number): Promise<{ success: boolean; error?: string }>;
    getRollupStatus(): Promise<unknown>;
    submitRollupTransfer(params: unknown): Promise<unknown>;
    getRollupBatch(batchId: number): Promise<unknown>;
  }

  export function bytesToHex(bytes: Uint8Array): string;
  export function hexToBytes(hex: string): Uint8Array;
  export function formatAddress(address: string, prefixLen?: number, suffixLen?: number): string;
  export function pubkeyToAddress(publicKeyHex: string): Promise<string>;
  export function addressToHash(address: string): string;
  export function isRougeAddress(input: string): boolean;
  export function isBurnAddress(address: string): boolean;
  export const BURN_ADDRESS: string;
  export function generateMnemonic(strength?: number): string;
  export function validateMnemonic(mnemonic: string): boolean;
  export function keypairFromMnemonic(
    mnemonic: string,
    passphrase?: string
  ): { publicKey: string; secretKey: string };
  export function mnemonicToMLDSASeed(
    mnemonic: string,
    passphrase?: string
  ): Uint8Array;
  export function signTransaction(payload: unknown, privateKey: string, publicKey: string): unknown;
  export function verifyTransaction(signedTx: unknown): boolean;
  export function generateNonce(): string;
  export function serializePayload(payload: unknown): Uint8Array;
  export function generateRandomness(): string;
  export function computeCommitment(amount: number, ownerPubKey: string, randomness: string): string;
  export function computeNullifier(randomness: string, commitment: string): string;
  export function createShieldedNote(amount: number, ownerPubKey: string): unknown;
}
