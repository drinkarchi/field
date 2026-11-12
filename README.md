# Archi Field

Archi Field adalah aplikasi lapangan untuk MD dan SPG Archi, dengan dashboard untuk Brand Manager (BM), Admin, dan Pemilik. Aplikasinya berbentuk PWA: dibuka di browser HP, lalu dipasang ke layar utama Android maupun iPhone.

- **Alamat aplikasi:** https://drinkarchi.github.io/field/
- **Backend:** Supabase, proyek `archifield`. Isinya login, database, foto, dan sinkron realtime.

## Pasang di HP

| HP | Langkah |
|---|---|
| Android (Chrome) | Buka alamat aplikasi → menu ⋮ → **Instal aplikasi** / *Tambahkan ke layar utama* |
| iPhone (Safari) | Buka alamat aplikasi → tombol **Bagikan** → **Tambah ke Layar Utama** |

Saat pertama dipakai, izinkan **Lokasi** dan **Kamera**. Keduanya wajib untuk cek toko dan absen.

## Akun (username + PIN 4 digit)

1. **Pemilik.** Akun awal dibuat lewat Supabase (email + password). Setelah masuk, buka menu **Akun → Atur username & PIN**. Login berikutnya cukup dengan username dan PIN. Opsi "Masuk dengan email (khusus Pemilik)" tetap tersedia sebagai cadangan.
2. **Anggota lain.** Pemilik, BM, atau Admin membuatnya dari **Pengaturan → Tim → Akun login → Buat akun**, isi username dan PIN awal.
3. **Ganti PIN.** Staf mengganti PIN sendiri di menu **Akun**. Lupa PIN: BM menekan **Reset PIN**.

Keamanan PIN:
- PIN disimpan sebagai hash di server, dengan *pepper* rahasia yang hanya ada di server.
- Salah 5x membuat akun terkunci 15 menit.
- PIN yang terlalu mudah (0000, 1234, dan sejenisnya) ditolak.

## Cara kerja

| Bagian | Penjelasan |
|---|---|
| Data | Semua data tersimpan sebagai record per koleksi di tabel `app_records` (JSON). Perubahan dikirim per record, jadi hanya yang berubah yang terkirim. |
| Hak akses (RLS) | MD/SPG hanya bisa menulis data operasional: kunjungan, absen, tindak lanjut, retur, dan sejenisnya. Master data (outlet, harga, produk, aturan, tim) hanya bisa diubah Pemilik, BM, atau Admin. Akun tanpa profil tidak bisa membaca apa pun. |
| Offline | Laporan dan foto disimpan di HP saat tidak ada sinyal, lalu terkirim otomatis begitu online. |
| Realtime | Laporan MD/SPG langsung muncul di layar BM dan Pemilik. |
| Waktu | Jam foto dan absen memakai jam server (WIB), bukan jam HP. |
| Foto | Diambil langsung dari kamera; foto galeri yang sudah lama ditolak. Foto dikompres ke maksimal 1280 px dan diberi watermark berisi toko, nama, jam, dan koordinat GPS, lalu disimpan di bucket privat `photos`. |
| GPS | Jarak ke titik toko dihitung saat foto SEBELUM dan SESUDAH. Kunjungan di luar radius atau tanpa GPS otomatis ditandai merah. |
| Durasi kunjungan | Dihitung otomatis dari jam foto SEBELUM sampai SESUDAH. |

## Struktur

```
index.html                 Aplikasi (satu file)
manifest.webmanifest, sw.js, icons/   PWA
vendor/                    supabase-js 2.45.4, SheetJS 0.18.5 (lokal, tanpa CDN)
supabase/migrations/       Skema, RLS, storage
supabase/functions/kelola-akun/   Buat akun & reset password (service role hanya di server)
tests/                     Uji end-to-end (Playwright + mock Supabase)
```

Menjalankan uji: `cd tests && node e2e.js` (butuh Playwright).

Kunci yang ada di `index.html` hanya *publishable key*, yang memang aman berada di aplikasi karena dilindungi RLS. *Service role key* tidak pernah disimpan di repo ini.
