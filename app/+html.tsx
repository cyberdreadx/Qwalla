import { ScrollViewStyleReset } from 'expo-router/html';

export default function Root({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />

        <title>Qwalla — Post-Quantum Encrypted Wallet</title>
        <meta name="description" content="The quantum-safe wallet for RougeChain. Send, chat, and mail — all end-to-end encrypted with NIST post-quantum cryptography." />
        <meta name="theme-color" content="#0A0C10" />

        {/* Open Graph */}
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://qwalla.io" />
        <meta property="og:title" content="Qwalla — Post-Quantum Encrypted Wallet" />
        <meta property="og:description" content="Send, chat & mail on RougeChain — end-to-end encrypted with NIST post-quantum cryptography. Your keys, your data, zero trust required." />
        <meta property="og:image" content="https://qwalla.io/images/og-image.png" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:site_name" content="Qwalla" />

        {/* Twitter / X */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Qwalla — Post-Quantum Encrypted Wallet" />
        <meta name="twitter:description" content="Send, chat & mail on RougeChain — end-to-end encrypted with NIST post-quantum cryptography." />
        <meta name="twitter:image" content="https://qwalla.io/images/og-image.png" />
        <meta name="twitter:site" content="@RougeChainIO" />

        {/* PWA */}
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Qwalla" />

        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: responsiveBackground }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

const responsiveBackground = `
body {
  background-color: #fff;
}
@media (prefers-color-scheme: dark) {
  body {
    background-color: #000;
  }
}`;
