# リモートデュエル

実物のカードを Web カメラ越しに使うリモートデュエルの補助ツールです。ライフ・フェイズ・チェーンを共有でき、相手のカメラ映像を手元で拡大して見られます。設計は [docs/design.md](docs/design.md)、セキュリティレビューは [docs/security.md](docs/security.md) にあります。

公開版: https://yt-glaceon.github.io/remote-duel/

## 使い方

1. 「ルームを作る」を押し、「招待リンクをコピー」で相手にリンクを送る
2. 相手がリンクを開くと、自動でつながる
3. 「自分のカメラ」でカメラを選ぶ。スマホをカメラにする場合は「スマホをカメラにする」の QR コードを読み取る
4. 相手の映像は、ホイール・ピンチで拡大、ドラッグで移動、ダブルクリックで元に戻る。文字を読みたいときは「📷 高画質で撮る」を押す

LP 欄に数値を入れて「ダメージ」「回復」「指定」(その値を LP にする)のボタンを押します。Enter はダメージです。`2400*2` や `2500-1900` のような式も使えます。先頭に `+` を付けると回復、`=` を付けると指定として Enter で入れられます。

## 開発

```bash
npm install
npm run dev        # http://localhost:5173
npm run dev:lan    # スマホから LAN 経由で試す(HTTPS・自己署名証明書)
npm run build      # dist/ に静的ファイルを出力
```

開発モードでは、カメラの選択肢に「テスト映像」が出ます。カメラがなくても動作を試せます。

## 設定(任意・`.env`)

| 変数 | 用途 |
|---|---|
| `VITE_PEER_HOST` / `VITE_PEER_PORT` / `VITE_PEER_PATH` | 自前の PeerServer を使う場合に指定する(省略すると PeerJS の公開サーバーを使う) |
| `VITE_TURN_URL` / `VITE_TURN_USER` / `VITE_TURN_PASS` | P2P でつながらない回線向けの TURN サーバー |

## 公開

`main` に push すると、GitHub Actions(`.github/workflows/deploy.yml`)がビルドして GitHub Pages に公開します。
