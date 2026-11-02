import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// `npm run dev:lan` はスマホから LAN 経由で試すためのモード。カメラは HTTPS が必須なので自己署名証明書を使う
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react(), ...(mode === 'lan' ? [basicSsl()] : [])],
}));
