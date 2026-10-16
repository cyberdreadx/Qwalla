import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

/**
 * A drop-in stand-in for react-native-webview's <WebView>, backed by Electron's
 * <webview> tag, for the desktop (web) build of the dApp browser.
 *
 * It mirrors just enough of the WebView API that app/(tabs)/browser/index.tsx
 * uses — the same props (source, injectedJavaScriptBeforeContentLoaded,
 * onMessage, onNavigationStateChange) and the same imperative ref methods
 * (goBack/goForward/reload/clearCache/clearHistory/injectJavaScript). That lets
 * the browser screen share one code path across native and desktop.
 *
 * The provider bridge is wired to match mobile exactly:
 *   • guest → host: webview-preload.js forwards window.ReactNativeWebView
 *     .postMessage over ipc-message; we surface it as onMessage({nativeEvent:{data}}).
 *   • host → guest: injectJavaScript() maps to executeJavaScript(), so the
 *     providers' `window.postMessage(...)` responses land in the guest unchanged.
 *   • The provider scripts install at document-start via desktop/webview-preload.js
 *     (so dApps that read window.rougechain/ethereum during initial page eval see
 *     them). The 'dom-ready' executeJavaScript() here is a CSP-safe FALLBACK —
 *     it re-runs the same scripts (which self-guard against double injection) so
 *     strict-CSP sites that block the preload's inline <script> still get a
 *     provider.
 */

// Set by desktop/preload.js. file:// URL to webview-preload.js. Undefined in a
// plain browser (no Electron) — where <webview> doesn't exist anyway.
const WEBVIEW_PRELOAD: string | undefined =
  typeof window !== 'undefined' ? (window as any).qwallaWebviewPreload : undefined;

const clearBrowserData: (() => Promise<void>) | undefined =
  typeof window !== 'undefined' ? (window as any).qwallaBrowser?.clearData : undefined;

interface Props {
  source?: { uri?: string };
  style?: StyleProp<ViewStyle>;
  injectedJavaScriptBeforeContentLoaded?: string;
  onMessage?: (event: { nativeEvent: { data: string } }) => void;
  onNavigationStateChange?: (nav: {
    url: string;
    title: string;
    canGoBack: boolean;
    canGoForward: boolean;
  }) => void;
  /** Find-in-page match progress (active match index + total), for the find bar. */
  onFoundInPage?: (result: { activeMatchOrdinal: number; matches: number }) => void;
}

export interface ElectronWebViewHandle {
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
  stopLoading: () => void;
  clearCache: () => void;
  clearHistory: () => void;
  injectJavaScript: (code: string) => void;
  /** The guest webContents id — used to tell the extensions runtime which tab is active. */
  getWebContentsId: () => number | null;
  /** The guest's live URL — authoritative origin for dApp requests (vs. stale React state). */
  getURL: () => string | null;
  /** Move keyboard focus into this webview's guest page. */
  focus: () => void;
  /** Toggle the guest page's Chromium DevTools (Elements/Console/Network/etc.). */
  toggleDevTools: () => void;
  /** Find-in-page: highlight + scroll to matches of `text`. `forward`/`findNext` step results. */
  findInPage: (text: string, opts?: { forward?: boolean; findNext?: boolean }) => void;
  /** Clear the find-in-page highlight/selection. */
  stopFindInPage: () => void;
}

const ElectronWebView = forwardRef<ElectronWebViewHandle, Props>(function ElectronWebView(
  { source, style, injectedJavaScriptBeforeContentLoaded, onMessage, onNavigationStateChange, onFoundInPage },
  ref,
) {
  const el = useRef<any>(null);

  useImperativeHandle(
    ref,
    () => ({
      goBack: () => el.current?.canGoBack?.() && el.current.goBack(),
      goForward: () => el.current?.canGoForward?.() && el.current.goForward(),
      reload: () => el.current?.reload?.(),
      stopLoading: () => el.current?.stop?.(),
      clearHistory: () => el.current?.clearHistory?.(),
      clearCache: () => {
        void clearBrowserData?.();
        el.current?.reload?.();
      },
      injectJavaScript: (code: string) => {
        try {
          // executeJavaScript returns a Promise that rejects if the guest is
          // navigating/detached when the response or event is injected — catch
          // it so an in-flight reply doesn't surface as an unhandled rejection.
          const p = el.current?.executeJavaScript?.(code);
          p?.catch?.(() => {});
        } catch {
          /* guest not ready */
        }
      },
      getWebContentsId: () => {
        try {
          return el.current?.getWebContentsId?.() ?? null;
        } catch {
          return null;
        }
      },
      getURL: () => {
        try {
          return el.current?.getURL?.() ?? null;
        } catch {
          return null;
        }
      },
      findInPage: (text: string, opts?: { forward?: boolean; findNext?: boolean }) => {
        try {
          if (text) el.current?.findInPage?.(text, opts);
        } catch {
          /* not ready */
        }
      },
      stopFindInPage: () => {
        try {
          el.current?.stopFindInPage?.('clearSelection');
        } catch {
          /* not ready */
        }
      },
      focus: () => {
        try {
          el.current?.focus?.();
        } catch {
          /* not ready */
        }
      },
      toggleDevTools: () => {
        try {
          const node = el.current;
          if (!node) return;
          if (node.isDevToolsOpened?.()) node.closeDevTools?.();
          else node.openDevTools?.();
        } catch {
          /* not ready */
        }
      },
    }),
    [],
  );

  useEffect(() => {
    const node = el.current;
    if (!node) return;

    const reportNav = () => {
      onNavigationStateChange?.({
        url: node.getURL?.() || source?.uri || '',
        title: node.getTitle?.() || '',
        canGoBack: !!node.canGoBack?.(),
        canGoForward: !!node.canGoForward?.(),
      });
    };

    const onDomReady = () => {
      if (injectedJavaScriptBeforeContentLoaded) {
        try {
          node.executeJavaScript(injectedJavaScriptBeforeContentLoaded);
        } catch {
          /* ignore */
        }
      }
      reportNav();
    };
    const onIpc = (e: any) => {
      if (e?.channel === 'rnwv-message') {
        onMessage?.({ nativeEvent: { data: String(e.args?.[0] ?? '') } });
      }
    };
    const onFound = (e: any) => {
      onFoundInPage?.({
        activeMatchOrdinal: e?.result?.activeMatchOrdinal ?? 0,
        matches: e?.result?.matches ?? 0,
      });
    };

    node.addEventListener('dom-ready', onDomReady);
    node.addEventListener('ipc-message', onIpc);
    node.addEventListener('found-in-page', onFound);
    node.addEventListener('did-navigate', reportNav);
    node.addEventListener('did-navigate-in-page', reportNav);
    node.addEventListener('page-title-updated', reportNav);
    return () => {
      node.removeEventListener('dom-ready', onDomReady);
      node.removeEventListener('ipc-message', onIpc);
      node.removeEventListener('found-in-page', onFound);
      node.removeEventListener('did-navigate', reportNav);
      node.removeEventListener('did-navigate-in-page', reportNav);
      node.removeEventListener('page-title-updated', reportNav);
    };
  }, [injectedJavaScriptBeforeContentLoaded, onMessage, onNavigationStateChange, onFoundInPage, source?.uri]);

  // Address-bar navigation: keep the guest's src in sync with the source prop.
  useEffect(() => {
    const node = el.current;
    if (node && source?.uri && node.getAttribute?.('src') !== source.uri) {
      try {
        node.loadURL ? node.loadURL(source.uri) : node.setAttribute('src', source.uri);
      } catch {
        node.setAttribute?.('src', source.uri);
      }
    }
  }, [source?.uri]);

  // Electron <webview> doesn't size reliably via flexbox — it can collapse or
  // render the guest at a stale size that never reflows to the window. The
  // robust fix is to absolutely fill a positioned container, so the webview
  // always tracks the container's real pixel box.
  return (
    <View style={[style, { position: 'relative', overflow: 'hidden' }]}>
      {React.createElement('webview', {
        ref: el,
        src: source?.uri,
        preload: WEBVIEW_PRELOAD,
        partition: 'persist:dappbrowser',
         
        allowpopups: 'true',
        style: {
          display: 'flex',
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          border: '0',
        },
      })}
    </View>
  );
});

export default ElectronWebView;
