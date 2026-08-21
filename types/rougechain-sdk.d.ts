declare module '@rougechain/sdk' {
  // ─── Wallet ────────────────────────────────────────────────────────────
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

  // ─── Common result envelope ────────────────────────────────────────────
  export interface TxResult<T = Record<string, unknown>> {
    success: boolean;
    error?: string;
    data?: T;
  }

  export interface SignedTx {
    payload: Record<string, unknown>;
    signature: string;
    public_key: string;
  }

  // ─── DEX ───────────────────────────────────────────────────────────────
  export interface Pool {
    pool_id?: string;
    id?: string;
    token_a?: string;
    token_b?: string;
    reserve_a?: number;
    reserve_b?: number;
    lp_supply?: number;
    [key: string]: unknown;
  }

  export interface SwapQuote {
    amount_out?: number;
    amountOut?: number;
    price_impact?: number;
    fee?: number;
    [key: string]: unknown;
  }

  export interface DexClient {
    getPools(): Promise<Pool[]>;
    getPool(poolId: string): Promise<Pool>;
    getPoolEvents(poolId: string): Promise<unknown[]>;
    getPriceHistory(poolId: string): Promise<unknown[]>;
    getPoolStats(poolId: string): Promise<unknown>;
    quote(params: {
      poolId?: string;
      tokenIn: string;
      tokenOut: string;
      amountIn: number;
    }): Promise<SwapQuote>;
    swap(
      wallet: Wallet,
      params: { tokenIn: string; tokenOut: string; amountIn: number; minAmountOut: number },
    ): Promise<TxResult>;
    createPool(
      wallet: Wallet,
      params: { tokenA: string; tokenB: string; amountA: number; amountB: number },
    ): Promise<TxResult>;
    addLiquidity(
      wallet: Wallet,
      params: { poolId: string; amountA: number; amountB: number },
    ): Promise<TxResult>;
    removeLiquidity(wallet: Wallet, params: { poolId: string; lpAmount: number }): Promise<TxResult>;
  }

  // ─── NFT ───────────────────────────────────────────────────────────────
  export interface NftClient {
    getCollections(): Promise<unknown[]>;
    getCollection(collectionId: string): Promise<unknown>;
    waitForCollection(
      collectionId: string,
      opts?: { timeoutMs?: number; pollMs?: number },
    ): Promise<unknown>;
    getTokens(collectionId: string, opts?: { limit?: number; offset?: number }): Promise<unknown>;
    getToken(collectionId: string, tokenId: number | string): Promise<unknown>;
    getByOwner(pubkey: string): Promise<unknown[]>;
    createCollection(
      wallet: Wallet,
      params: {
        symbol: string;
        name: string;
        maxSupply?: number;
        royaltyBps?: number;
        image?: string;
        description?: string;
      },
    ): Promise<TxResult>;
    mint(
      wallet: Wallet,
      params: {
        collectionId: string;
        name: string;
        metadataUri?: string;
        attributes?: Record<string, unknown>;
      },
    ): Promise<TxResult>;
    batchMint(
      wallet: Wallet,
      params: {
        collectionId: string;
        names: string[];
        uris?: string[];
        batchAttributes?: Record<string, unknown>[];
      },
    ): Promise<TxResult>;
    transfer(
      wallet: Wallet,
      params: { collectionId: string; tokenId: number | string; to: string; salePrice?: number },
    ): Promise<TxResult>;
    burn(wallet: Wallet, params: { collectionId: string; tokenId: number | string }): Promise<TxResult>;
    lock(
      wallet: Wallet,
      params: { collectionId: string; tokenId: number | string; locked: boolean },
    ): Promise<TxResult>;
    freezeCollection(
      wallet: Wallet,
      params: { collectionId: string; frozen: boolean },
    ): Promise<TxResult>;
  }

  // ─── Bridge ────────────────────────────────────────────────────────────
  export interface BridgeConfig {
    enabled: boolean;
    custodyAddress?: string;
    chainId: number;
    supportedTokens?: string[];
    [key: string]: unknown;
  }

  export interface XrgeBridgeConfig {
    enabled: boolean;
    vaultAddress?: string;
    tokenAddress?: string;
    chainId: number;
    [key: string]: unknown;
  }

  export interface BridgeWithdrawal {
    txId?: string;
    amount?: number;
    evmAddress?: string;
    status?: string;
    [key: string]: unknown;
  }

  export interface BridgeClient {
    getConfig(): Promise<BridgeConfig>;
    getWithdrawals(): Promise<BridgeWithdrawal[]>;
    withdraw(
      wallet: Wallet,
      params: { amount: number; evmAddress: string; tokenSymbol?: string; fee?: number },
    ): Promise<TxResult>;
    claim(params: {
      evmTxHash: string;
      evmAddress: string;
      evmSignature?: string;
      recipientPubkey: string;
      token?: string;
    }): Promise<TxResult>;
    getXrgeConfig(): Promise<XrgeBridgeConfig>;
    claimXrge(params: {
      evmTxHash: string;
      evmAddress: string;
      amount: number;
      recipientPubkey: string;
    }): Promise<TxResult>;
    withdrawXrge(wallet: Wallet, params: { amount: number; evmAddress: string }): Promise<TxResult>;
    getXrgeWithdrawals(): Promise<BridgeWithdrawal[]>;
  }

  // ─── Mail ──────────────────────────────────────────────────────────────
  export interface MailClient {
    registerName(wallet: Wallet, name: string, walletId: string): Promise<TxResult>;
    resolveName(name: string): Promise<{
      entry: { name: string; wallet_id: string };
      wallet: {
        id: string;
        signing_public_key: string;
        encryption_public_key: string;
        display_name?: string;
      };
    } | null>;
    reverseLookup(walletId: string): Promise<string | null>;
    releaseName(wallet: Wallet, name: string): Promise<TxResult>;
    send(
      wallet: Wallet,
      params: {
        from: string;
        to: string;
        encrypted_subject?: string;
        encrypted_body?: string;
        body?: string;
        reply_to_id?: string;
      },
    ): Promise<TxResult>;
    getInbox(wallet: Wallet): Promise<unknown[]>;
    getSent(wallet: Wallet): Promise<unknown[]>;
    getTrash(wallet: Wallet): Promise<unknown[]>;
    getMessage(wallet: Wallet, messageId: string): Promise<unknown>;
    move(wallet: Wallet, messageId: string, folder: string): Promise<TxResult>;
    markRead(wallet: Wallet, messageId: string): Promise<TxResult>;
    delete(wallet: Wallet, messageId: string): Promise<TxResult>;
  }

  // ─── Messenger ─────────────────────────────────────────────────────────
  export interface MessengerClient {
    getWallets(): Promise<unknown[]>;
    registerWallet(
      wallet: Wallet,
      opts: {
        id: string;
        displayName: string;
        signingPublicKey: string;
        encryptionPublicKey: string;
        discoverable?: boolean;
      },
    ): Promise<TxResult>;
    getConversations(wallet: Wallet): Promise<unknown[]>;
    createConversation(
      wallet: Wallet,
      participantIds: string[],
      opts?: { name?: string; isGroup?: boolean },
    ): Promise<TxResult>;
    getMessages(wallet: Wallet, conversationId: string): Promise<unknown[]>;
    sendMessage(
      wallet: Wallet,
      conversationId: string,
      encryptedContent: string,
      opts?: {
        contentSignature?: string;
        messageType?: string;
        selfDestruct?: boolean;
        destructAfterSeconds?: number;
        spoiler?: boolean;
      },
    ): Promise<TxResult>;
    deleteMessage(wallet: Wallet, messageId: string, conversationId: string): Promise<TxResult>;
    deleteConversation(wallet: Wallet, conversationId: string): Promise<TxResult>;
    markRead(wallet: Wallet, messageId: string, conversationId: string): Promise<TxResult>;
  }

  // ─── Shielded (+ WASM contracts) ───────────────────────────────────────
  export interface ShieldedNote {
    commitment: string;
    nullifier: string;
    value: number;
    randomness: string;
    ownerPubKey: string;
  }

  export interface ShieldedClient {
    getStats(): Promise<{
      total_shielded: number;
      active_commitments: number;
      spent_nullifiers: number;
    }>;
    isNullifierSpent(nullifierHex: string): Promise<{ spent: boolean }>;
    shield(wallet: Wallet, params: { amount: number }): Promise<TxResult & { note?: ShieldedNote }>;
    transfer(
      wallet: Wallet,
      params: {
        nullifiers: string[];
        outputCommitments: string[];
        proof: string;
        shieldedFee?: number;
      },
    ): Promise<TxResult>;
    unshield(
      wallet: Wallet,
      params: { nullifiers: string[]; amount: number; proof: string },
    ): Promise<TxResult>;
    deployContract(params: Record<string, unknown>): Promise<unknown>;
    callContract(params: Record<string, unknown>): Promise<unknown>;
    getContract(addr: string): Promise<unknown>;
    getContractState(addr: string, key?: string): Promise<unknown>;
    getContractEvents(addr: string, limit?: number): Promise<unknown>;
    listContracts(): Promise<unknown>;
  }

  // ─── Social ────────────────────────────────────────────────────────────
  export interface SocialComment {
    id: string;
    track_id: string;
    wallet_pubkey: string;
    body: string;
    timestamp: string;
  }

  export interface SocialPost {
    id: string;
    author_pubkey: string;
    body: string;
    reply_to_id: string | null;
    created_at: string;
  }

  export interface PostStats {
    likes: number;
    reposts: number;
    replies: number;
    liked: boolean;
    reposted: boolean;
  }

  export interface SocialClient {
    // Posts / timeline
    createPost(
      wallet: Wallet,
      body: string,
      replyToId?: string,
    ): Promise<TxResult & { post?: SocialPost }>;
    deletePost(wallet: Wallet, postId: string): Promise<TxResult>;
    toggleRepost(
      wallet: Wallet,
      postId: string,
    ): Promise<TxResult & { reposted?: boolean; reposts?: number }>;
    getPost(
      postId: string,
      viewerPubkey?: string,
    ): Promise<{ post: SocialPost; stats: PostStats } | null>;
    getPostStats(postId: string, viewerPubkey?: string): Promise<PostStats>;
    getPostReplies(postId: string, limit?: number, offset?: number): Promise<SocialPost[]>;
    getUserPosts(
      pubkey: string,
      limit?: number,
      offset?: number,
    ): Promise<{ posts: SocialPost[]; total: number }>;
    getGlobalTimeline(limit?: number, offset?: number): Promise<SocialPost[]>;
    getFollowingFeed(wallet: Wallet, limit?: number, offset?: number): Promise<SocialPost[]>;
    // Follows / likes / comments
    toggleFollow(
      wallet: Wallet,
      artistPubkey: string,
    ): Promise<TxResult & { following?: boolean; followers?: number }>;
    toggleLike(
      wallet: Wallet,
      trackId: string,
    ): Promise<TxResult & { liked?: boolean; likes?: number }>;
    postComment(
      wallet: Wallet,
      trackId: string,
      body: string,
    ): Promise<TxResult & { comment?: SocialComment }>;
    deleteComment(wallet: Wallet, commentId: string): Promise<TxResult>;
    getComments(trackId: string, limit?: number, offset?: number): Promise<SocialComment[]>;
    getUserLikes(pubkey: string): Promise<string[]>;
    getUserFollowing(pubkey: string): Promise<string[]>;
    getTrackStats(trackId: string, viewerPubkey?: string): Promise<unknown>;
    getArtistStats(pubkey: string, viewerPubkey?: string): Promise<unknown>;
    recordPlay(wallet: Wallet, trackId: string): Promise<TxResult>;
    hideTrack(
      wallet: Wallet,
      trackId: string,
      hidden?: boolean,
    ): Promise<TxResult & { hidden?: boolean }>;
    getHiddenTracks(pubkey: string): Promise<string[]>;
  }

  // ─── Validators / staking ──────────────────────────────────────────────
  export interface Validator {
    public_key?: string;
    address?: string;
    stake?: number;
    active?: boolean;
    [key: string]: unknown;
  }

  // ─── Client ────────────────────────────────────────────────────────────
  export class RougeChain {
    constructor(baseUrl: string, options?: { apiKey?: string; fetch?: typeof fetch });
    nft: NftClient;
    dex: DexClient;
    bridge: BridgeClient;
    mail: MailClient;
    messenger: MessengerClient;
    shielded: ShieldedClient;
    social: SocialClient;

    get<T = unknown>(path: string): Promise<T>;
    post<T = unknown>(path: string, body: unknown): Promise<T>;

    getStats(): Promise<unknown>;
    getHealth(): Promise<unknown>;
    getBlocks(opts?: { limit?: number }): Promise<unknown[]>;
    getBlocksSummary(range?: string): Promise<unknown>;
    getBalance(
      publicKey: string,
    ): Promise<{ balance: number; tokens?: Record<string, number>; token_balances?: Record<string, number> }>;
    getTokenBalance(publicKey: string, token: string): Promise<number>;
    getTransactions(opts?: { limit?: number; offset?: number }): Promise<unknown>;
    getTokens(): Promise<unknown[]>;
    getTokenMetadata(symbol: string): Promise<unknown>;
    getTokenHolders(symbol: string): Promise<unknown[]>;
    getTokenTransactions(symbol: string): Promise<unknown>;
    getValidators(): Promise<Validator[]>;
    getValidatorStats(): Promise<unknown>;
    getFinality(): Promise<unknown>;
    getFinalityProof(height: number): Promise<unknown>;
    /** EIP-1559 fee info: base fee + suggestions. Shape: { base_fee, suggested_fee, ... } */
    getFeeInfo(): Promise<unknown>;
    getPeers(): Promise<unknown[]>;
    getBurnedTokens(): Promise<unknown>;
    resolveAddress(input: string): Promise<{ publicKey: string; address: string; balance: number }>;
    getNonce(publicKey: string): Promise<{ nonce: number; next_nonce: number }>;

    registerPushToken(wallet: Wallet, pushToken: string, platform?: string): Promise<TxResult>;
    unregisterPushToken(wallet: Wallet): Promise<TxResult>;

    transfer(
      wallet: Wallet,
      params: { to: string; amount: number; fee?: number; token?: string },
    ): Promise<TxResult>;
    createToken(
      wallet: Wallet,
      params: { name: string; symbol: string; totalSupply: number; fee?: number; image?: string },
    ): Promise<TxResult>;
    stake(wallet: Wallet, params: { amount: number; fee?: number }): Promise<TxResult>;
    unstake(wallet: Wallet, params: { amount: number; fee?: number }): Promise<TxResult>;
    faucet(wallet: Wallet): Promise<TxResult>;
    burn(wallet: Wallet, amount: number, fee?: number, token?: string): Promise<TxResult>;
    updateTokenMetadata(
      wallet: Wallet,
      params: {
        symbol: string;
        image?: string;
        description?: string;
        website?: string;
        twitter?: string;
        discord?: string;
      },
    ): Promise<TxResult>;
    claimTokenMetadata(wallet: Wallet, tokenSymbol: string): Promise<TxResult>;
    mintTokens(
      wallet: Wallet,
      params: { symbol: string; amount: number; fee?: number },
    ): Promise<unknown>;

    connectWebSocket(topics?: string[]): WebSocket;

    getRollupStatus(): Promise<unknown>;
    submitRollupTransfer(params: unknown): Promise<unknown>;
    getRollupBatch(batchId: number): Promise<unknown>;

    /** @internal — used by signed-request helpers */
    submitTx(endpoint: string, signedTx: SignedTx): Promise<TxResult>;
  }

  // ─── Signers & helpers ─────────────────────────────────────────────────
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
    passphrase?: string,
  ): { publicKey: string; secretKey: string };
  export function mnemonicToMLDSASeed(mnemonic: string, passphrase?: string): Uint8Array;
  export function signTransaction(
    payload: Record<string, unknown>,
    privateKey: string,
    publicKey: string,
  ): SignedTx;
  export function verifyTransaction(signedTx: SignedTx): boolean;
  export function generateNonce(): string;
  export function serializePayload(payload: unknown): Uint8Array;
  export function signRequest(wallet: Wallet, payload: Record<string, unknown>): SignedTx;
  export function createSignedTokenApproval(
    wallet: Wallet,
    spender: string,
    tokenSymbol: string,
    amount: number,
  ): SignedTx;
  export function createSignedTokenTransferFrom(
    wallet: Wallet,
    owner: string,
    to: string,
    tokenSymbol: string,
    amount: number,
  ): SignedTx;
  export function createSignedTokenMetadataUpdate(
    wallet: Wallet,
    tokenSymbol: string,
    metadata: Record<string, unknown>,
  ): SignedTx;
  export function createSignedTokenMetadataClaim(wallet: Wallet, tokenSymbol: string): SignedTx;
  export function createSignedBridgeWithdraw(
    wallet: Wallet,
    amount: number,
    evmAddress: string,
    tokenSymbol?: string,
    fee?: number,
  ): SignedTx;
  export function createSignedShield(wallet: Wallet, amount: number, commitment: string): SignedTx;
  export function createSignedShieldedTransfer(
    wallet: Wallet,
    nullifiers: string[],
    outputCommitments: string[],
    proof: string,
    shieldedFee?: number,
  ): SignedTx;
  export function createSignedUnshield(
    wallet: Wallet,
    nullifiers: string[],
    amount: number,
    proof: string,
  ): SignedTx;
  export function generateRandomness(): string;
  export function computeCommitment(amount: number, ownerPubKey: string, randomness: string): string;
  export function computeNullifier(randomness: string, commitment: string): string;
  export function createShieldedNote(amount: number, ownerPubKey: string): ShieldedNote;
}
