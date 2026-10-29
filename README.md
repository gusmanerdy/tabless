# Tabless

Ekstensi Chrome untuk menemukan tab duplikat dan tab yang sudah lama tidak diaktifkan. Tautan disimpan sebagai koleksi lokal sebelum tab ditutup. Dibuat dengan JavaScript, HTML, dan CSS; tidak membutuhkan Python, server, atau instalasi dependency.

## Pasang di Chrome

1. Buka `chrome://extensions`.
2. Aktifkan **Developer mode** di kanan atas.
3. Klik **Load unpacked**, lalu pilih folder `ProjectTabless` ini (folder yang berisi `manifest.json`).
4. Sematkan Tabless melalui menu Extensions, lalu klik ikonnya untuk membuka dashboard. Pintasan: **Alt+Shift+T** (dapat diubah di `chrome://extensions/shortcuts`).

Memerlukan Chrome 121 atau lebih baru. Setelah mengubah source, klik **Reload** pada kartu ekstensi dan muat ulang dashboard.

Untuk distribusi publik, ikuti [panduan publikasi ke Chrome Web Store](PUBLISHING.md).

## Fitur versi awal

- **Duplikat:** membandingkan URL lengkap, termasuk query dan fragmen; mempertahankan tab yang dilindungi atau salinan yang paling baru diaktifkan.
- **Tab lama:** ambang 1, 3, 7, 14, atau 30 hari, berdasarkan waktu terakhir tab diaktifkan menurut Chrome.
- **Pilihan manual dan pencarian:** temukan tab lewat judul atau domain, lalu simpan dan tutup pilihan.
- **Koleksi tersimpan:** buka satu tautan atau seluruh koleksi di jendela baru, ganti nama, hapus, dan batalkan penghapusan melalui notifikasi.
- **Cadangan JSON:** ekspor koleksi yang terlihat dan impor kembali sebagai koleksi tambahan. Impor tidak menimpa data lama.

Tab aktif di tiap jendela, tab yang dipin, memutar suara, atau sedang memuat/navigasi dilindungi. Mode Incognito serta halaman internal Chrome, ekstensi lain, dan URL selain HTTP(S) tidak dikelola. Semua jendela Chrome normal dalam profil yang sama ditampilkan.

## Cara penyimpanan bekerja

Worker menyimpan koleksi ke `chrome.storage.local` dan membaca ulang untuk memverifikasinya sebelum menutup tab. Setiap tab diperiksa ulang tepat sebelum penutupan; jika URL berubah, tab digunakan kembali, atau tab menjadi dilindungi, tab tersebut dilewati. Jika penutupan sebagian gagal, salinan tautan tetap tersedia. Pemulihan juga mempertahankan koleksi aslinya.

Yang disimpan adalah **judul dan URL**, bukan isi formulir, riwayat navigasi, posisi scroll, atau konten halaman. Simpan pekerjaan pada halaman sebelum menutupnya. Grup tab asli dan status pin belum dipulihkan.

Izin hanya `tabs` (membaca judul/URL/status tab) dan `storage` (koleksi dan preferensi). Tidak ada akun, analitik, pengiriman data, atau kode dari server. Data lokal tidak tersinkron antarperangkat. Batas bawaan Chrome storage adalah 10 MB; bila penyimpanan gagal, proses tidak menutup tab. Menghapus ekstensi juga menghapus data lokal: gunakan ekspor sebagai cadangan. Penghapusan koleksi dapat dibatalkan melalui tombol **Urungkan** pada notifikasi selama 15 detik. Salinan tersembunyinya dibersihkan permanen pada penggunaan berikutnya setelah satu menit, dan tidak ikut ekspor.

## Pengembangan dan verifikasi

```sh
npm test
npm run preview
```

Pratinjau ada di `http://127.0.0.1:4173` dan diberi label **Mode pratinjau • Data contoh**. Seluruh operasi hanya mengubah data contoh di penyimpanan browser; pratinjau tidak mengakses tab Chrome sebenarnya. Data pratinjau terpisah dari ekstensi. Untuk mengulang demo, hapus localStorage situs pratinjau.

Tes otomatis berfokus pada aturan duplikat/usia dan keselamatan penyimpanan/penutupan dengan API Chrome tiruan. Uji manual ekstensi: buka dua tab URL identik, buka Tabless, pilih salinan duplikat, simpan & tutup, lalu pulihkan dari koleksi. Ulangi dengan salah satu salinan dipin atau sedang memutar audio. Pengujian melalui pratinjau tidak menggantikan pengujian ekstensi yang dipasang di Chrome.

## Arah berikutnya

Pengelompokan per proyek, mempertahankan grup Chrome saat pemulihan, pengecualian domain, dan penjadwalan arsip dapat ditambahkan setelah alur inti diuji. Versi awal selalu memerlukan pilihan dan tindakan pengguna untuk menutup tab.
