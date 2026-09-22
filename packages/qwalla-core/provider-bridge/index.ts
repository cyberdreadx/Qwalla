/**
 * provider-bridge — the injected Web3 provider(s) and dApp session/approval
 * logic. This is what makes Qwalla a wallet-enabled browser: it generates the
 * scripts injected into pages and handles the request/approval message bus.
 *
 * MIGRATED: connected-sites (approved dApp origins; backed by the host storage
 * adapter). Pending from lib/: dapp-provider (RougeChain), evm-provider (EVM),
 * dapp-session, dapp-events. The message transport (RN WebView vs Electron
 * <webview> vs a native protocol) is injected by the host.
 */
export * from './connected-sites';
