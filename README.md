# Madness Combat - Multiplayer

## Cara pasang (sekali saja)
1. Upload SEMUA isi folder ini ke repo GitHub `Madness-Combat` (index.html, net.js, config.js, server.js, Image/, Sound/, dst).
2. Aktifkan GitHub Pages (Settings > Pages > branch main) -> game ada di https://USERNAME.github.io/Madness-Combat
3. Buat server di https://render.com : New > Web Service > pilih repo yang sama.
   - Runtime Node, Build Command kosong / `echo no build`, Start Command `node server.js`, Region Singapore, Plan Free.
   (atau New > Blueprint, render.yaml sudah disiapkan)
4. Setelah jalan Render memberi alamat, mis. https://madness-combat.onrender.com
   Edit `config.js` di repo:  window.MC_SERVER = 'wss://madness-combat.onrender.com';
5. Selesai. Siapa pun yang membuka link GitHub Pages bisa tekan "MAIN ONLINE".
   Room lain: tambahkan ?room=namaroom di link (maks 8 pemain per room).

Game juga langsung jalan dari alamat Render itu sendiri (server melayani index.html), tanpa GitHub Pages.

## Tes lokal
node server.js  ->  buka http://localhost:8080 di dua tab.
