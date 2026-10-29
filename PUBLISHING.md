# Publikasi Tabless ke Chrome Web Store

Panduan diperiksa pada 29 Oktober 2026. Ini panduan persiapan dan pengajuan; proyek belum diunggah atau dipublikasikan.

## 1. Uji ekstensi di Chrome

Pasang melalui `chrome://extensions` → **Developer mode** → **Load unpacked** → pilih folder proyek ini. Google meminta pengembang memeriksa ekstensi yang dimuat lokal sebelum mengunggahnya. [Persiapan resmi](https://developer.chrome.com/docs/webstore/prepare)

Verifikasi dengan tab percobaan:

- Dua URL identik terdeteksi sebagai duplikat; URL dengan query/fragmen berbeda tetap dibedakan.
- Simpan & tutup membuat koleksi; setidaknya satu salinan duplikat tetap terbuka.
- Tab aktif, dipin, bersuara, dan sedang memuat dilewati.
- Buka satu tautan dan pulihkan seluruh koleksi; koleksi tetap tersimpan.
- Ganti nama, hapus/urungkan, ekspor, dan impor bekerja.
- Koleksi masih ada setelah Chrome ditutup dan dibuka lagi.

Tes otomatis sudah tersedia melalui `npm test`. Pratinjau localhost memakai tab contoh dan tidak menggantikan uji ekstensi terpasang. Fitur tab lama mengikuti waktu terakhir tab diaktifkan; tab baru tidak langsung memenuhi ambang satu hari.

## 2. Siapkan akun pengembang

Buka [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole), masuk dengan akun Google milik penerbit, lalu selesaikan pendaftaran. Biaya pendaftaran akun dibayar sekali; Google menyebut nominal US$5 dalam pengumuman April 2026. Periksa jumlah pada dashboard sebelum membayar. [Pendaftaran](https://developer.chrome.com/docs/webstore/register) · [Konfirmasi biaya oleh Google](https://developer.chrome.com/blog/cws-role-expansion-developer-dashboard)

Aktifkan verifikasi dua langkah pada akun Google untuk dapat menerbitkan dan memperbarui ekstensi. Isi nama penerbit dan verifikasi email kontak. [Verifikasi dua langkah](https://developer.chrome.com/blog/policy-update-2sv) · [Pengaturan akun](https://developer.chrome.com/docs/webstore/set-up-account)

## 3. Siapkan materi listing

- Nama: **Tabless — Rapikan Tab**.
- Bahasa utama: Indonesia.
- Deskripsi yang menjelaskan fitur yang benar-benar tersedia.
- Ikon PNG 128×128; berkas proyek ada di `icons/icon128.png`. Tinjau padding artwork mengikuti panduan gambar.
- Minimal satu screenshot pengalaman ekstensi, ukuran **1280×800** atau **640×400**. Disarankan menampilkan daftar duplikat, filter tab lama, dan koleksi tersimpan menggunakan tab percobaan.
- Gambar promosi kecil 440×280 dapat disiapkan untuk tampilan listing yang lebih lengkap; ikuti field yang diminta dashboard.
- Email dukungan dan URL kebijakan privasi yang dapat dibuka publik.

Screenshot `artifacts/tabless-preview.png` saat ini berukuran 727×791 dan menampilkan mode contoh; siapkan screenshot rilis baru dengan ukuran yang benar. [Panduan screenshot dan listing](https://developer.chrome.com/docs/webstore/best-listing) · [Panduan ikon dan gambar promosi](https://developer.chrome.com/docs/webstore/images)

Contoh deskripsi berdasarkan implementasi sekarang:

> Rapikan tab Chrome yang menumpuk dengan Tabless. Temukan salinan duplikat dan tab yang lama tidak diaktifkan, pilih yang ingin dirapikan, lalu simpan tautannya dalam koleksi lokal sebelum menutupnya.
>
> Cari berdasarkan judul atau situs, atur batas usia 1–30 hari, dan buka kembali satu tautan atau seluruh koleksi. Tab aktif, dipin, dan bersuara dilindungi. Koleksi dapat diekspor dan diimpor sebagai cadangan JSON. Tanpa akun atau sinkronisasi cloud. Yang disimpan adalah judul dan URL, bukan isi formulir atau riwayat halaman.

## 4. Siapkan kebijakan dan deklarasi privasi

Tabless memproses data tab meskipun tidak mengirimkannya kepada pengembang. Google tetap meminta kebijakan privasi bagi ekstensi yang menangani informasi pengguna secara lokal. Terbitkan halaman kebijakan pada URL publik, lalu masukkan URL itu pada dashboard. [FAQ data lokal, poin 14](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)

Kebijakan perlu menjelaskan praktik aktual Tabless: membaca judul/URL dan metadata tab untuk pengelolaan tab, menyimpan koleksi serta preferensi di perangkat, tanpa akun/analitik/backend/sinkronisasi, ekspor JSON atas tindakan pengguna, retensi penghapusan/urungkan, dan penghapusan data saat uninstall. Cantumkan identitas penerbit dan kontak dukungan yang benar. Jelaskan pula bahwa membuka kembali tautan mengunjungi situs tujuan seperti biasa.

Contoh isian **Privacy practices**, berdasarkan kode versi 0.1.0:

| Isian | Contoh penjelasan |
| --- | --- |
| Single purpose | Membantu pengguna merapikan tab Chrome dengan menemukan tab duplikat dan tab yang lama tidak diaktifkan, lalu menyimpan tautannya secara lokal sebelum menutup pilihan pengguna agar dapat dibuka kembali. |
| Alasan izin `tabs` | Membaca judul dan URL tab untuk menampilkan daftar, membandingkan duplikat, dan menyimpan tautan. Metadata tab digunakan untuk menentukan usia pemakaian dan melindungi tab aktif, dipin, bersuara, serta sedang memuat. |
| Alasan izin `storage` | Menyimpan koleksi judul/URL, waktu penyimpanan, serta preferensi batas usia tab secara lokal agar tersedia setelah dashboard atau browser ditutup. |
| Remote code | No. Semua kode JavaScript disertakan dalam paket ekstensi. |

Cocokkan kategori data dan sertifikasi penggunaan data dengan definisi yang ditampilkan dashboard. Hindari deklarasi bahwa ekstensi sama sekali tidak menangani data pengguna: URL/judul tab memang diproses. Perbarui deklarasi jika perilaku kode berubah. [Petunjuk field privasi](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)

## 5. Buat ZIP rilis

Manifest harus berada tepat di akar ZIP. Untuk versi saat ini, jalankan dari folder proyek:

```sh
zip -r tabless-0.1.0.zip manifest.json index.html app.js styles.css worker.js lib icons preview.js
```

Perintah ini memasukkan berkas aplikasi dan dependency lokalnya. `preview.js` mendukung pratinjau di browser biasa; dalam ekstensi terpasang, aplikasi memakai API Chrome. Source tes, screenshot, server pratinjau, dan dokumentasi tidak diperlukan dalam paket rilis.

Jangan gunakan **Pack extension** untuk membuat berkas pengajuan; alur dashboard ini menggunakan ZIP. Untuk pembaruan berikutnya, naikkan `version` pada manifest, uji, buat ZIP baru, dan unggah pada item Store yang sama. [Aturan paket dan versi](https://developer.chrome.com/docs/webstore/prepare)

## 6. Unggah dan ajukan

Pada dashboard: **Add new item** → pilih ZIP → lengkapi **Store listing**, **Privacy practices**, dan **Distribution**. Untuk reviewer, jelaskan cara membuka dashboard melalui ikon Tabless, menyiapkan dua tab identik, menyimpan/menutup duplikat, lalu memulihkannya. Aplikasi tidak memerlukan login.

Pilih distribusi sesuai tujuan. Setelah semua isian lengkap, gunakan **Submit for Review**. Jika ingin mengendalikan waktu peluncuran, gunakan pilihan publikasi manual setelah persetujuan. Durasi review bervariasi; persetujuan tidak dijamin. [Panduan pengajuan resmi](https://developer.chrome.com/docs/webstore/publish)

## Status persiapan proyek

- Sudah ada: implementasi Manifest V3, ikon, deskripsi dasar, dan tes otomatis.
- Masih perlu: uji Chrome terpasang, screenshot rilis, tinjauan ikon, kebijakan privasi dengan URL publik, identitas/kontak penerbit, ZIP rilis, dan isian dashboard.
- Pendaftaran akun, pembayaran, penerimaan perjanjian, serta pengajuan belum dilakukan.
