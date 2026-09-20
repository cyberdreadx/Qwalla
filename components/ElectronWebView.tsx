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
 *   • The provider scripts are injected on 'dom-ready' (Electron has no
 *     before-content-loaded hook for <webview>); they self-guard against double
 *     injection, so re-running per navigation is safe.
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
}

export interface ElectronWebViewHandle {
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
  stopLoading: () => void;
  clearCache: () => void;
  clearHistory: () => void;
  injectJavaScript: (code: string) => void;
}

const ElectronWebView = forwardRef<ElectronWebViewHandle, Props>(function ElectronWebView(
  { source, style, injectedJavaScriptBeforeContentLoaded, onMessage, onNavigationStateChange },
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
          el.current?.executeJavaScript?.(code);
        } catch {
          /* guest not ready */
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

    node.addEventListener('dom-ready', onDomReady);
    node.addEventListener('ipc-message', onIpc);
    node.addEventListener('did-navigate', reportNav);
    node.addEventListener('did-navigate-in-page', reportNav);
    node.addEventListener('page-title-updated', reportNav);
    return () => {
      node.removeEventListener('dom-ready', onDomReady);
      node.removeEventListener('ipc-message', onIpc);
      node.removeEventListener('did-navigate', reportNav);
      node.removeEventListener('did-navigate-in-page', reportNav);
      node.removeEventListener('page-title-updated', reportNav);
    };
  }, [injectedJavaScriptBeforeContentLoaded, onMessage, onNavigationStateChange, source?.uri]);

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

  return (
    <View style={style}>
      {React.createElement('webview', {
        ref: el,
        src: source?.uri,
        preload: WEBVIEW_PRELOAD,
        partition: 'persist:dappbrowser',
        style: { display: 'flex', width: '100%', height: '100%', border: '0', flex: 1 },
      })}
    </View>
  );
});

export default ElectronWebView;
