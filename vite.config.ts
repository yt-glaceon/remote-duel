import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// 本番ビルドにだけ CSP を入れる(開発サーバーはインラインスクリプトを使うので対象外)
function csp(peerHost: string): Plugin {
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    // 拡大表示で style 属性を使う
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "media-src 'self' blob:",
    `connect-src 'self' https://${peerHost} wss://${peerHost}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  return {
    name: 'csp',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`),
  };
}

// `npm run dev:lan` はスマホから LAN 経由で試すためのモード。カメラは HTTPS が必須なので自己署名証明書を使う
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.');
  return {
    base: './',
    plugins: [react(), csp(env.VITE_PEER_HOST || '0.peerjs.com'), ...(mode === 'lan' ? [basicSsl()] : [])],
  };
});
