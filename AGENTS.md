# Panduan Pengembangan Agen AI (AGENTS.md)

Dokumen ini berisi panduan teknis, gaya kode, dan aturan operasional untuk agen AI (seperti Cursor, Windsurf, Copilot) yang bekerja pada repositori `Discord SelfBot Message Scheduler`.

> **Bahasa:** Selalu gunakan **Bahasa Indonesia** dalam komunikasi, komentar kode, dan dokumentasi.

---

## 1. Perintah Pengembangan (Development Commands)

Gunakan perintah berikut untuk operasi standar. Jalankan dari root direktori.

- **Build Proyek** (TypeScript ke JavaScript):
  ```bash
  npm run build
  ```
  *Output ada di folder `dist/`.*

- **Menjalankan Bot** (Production):
  ```bash
  npm start
  ```

- **Menjalankan Bot** (Development dengan Nodemon):
  ```bash
  npm run dev
  ```

- **Deploy Slash Commands** (Wajib dijalankan saat ada perubahan command):
  ```bash
  npm run deploy
  ```

- **Database (Prisma)**:
  - Push schema ke MongoDB: `npm run db:push`
  - Buka GUI Database: `npm run db:studio`

- **Linting**:
  ```bash
  npm run lint
  ```

- **Testing**:
  *Saat ini belum ada framework testing (Jest/Mocha) yang terkonfigurasi. Jika diminta membuat test, gunakan `ts-node` untuk menjalankan script test manual atau sarankan instalasi Jest.*

---

## 2. Gaya Kode (Code Style)

Ikuti konvensi ini dengan ketat untuk menjaga konsistensi.

### Format & Sintaks
- **Bahasa**: TypeScript (`.ts`).
- **Indentasi**:
  - **TypeScript**: 4 Spasi.
  - **JSON/Config**: 2 Spasi.
- **Quote**: Gunakan Single Quote (`'`) untuk string biasa, Backtick (`` ` ``) untuk template literals.
- **Semicolon**: Wajib (`always`).
- **Trailing Comma**: `es5` (di objek/array multiline).

### Penamaan (Naming Conventions)
- **Variabel/Fungsi**: `camelCase` (contoh: `handleInteraction`, `userBalance`).
- **Class**: `PascalCase` (contoh: `PaymentService`, `WorkerController`).
- **Interface/Type**: `PascalCase` (contoh: `WorkerPayload`, `Command`).
- **File**: `camelCase` atau `kebab-case` (contoh: `admin.handler.ts`, `deploy-commands.ts`).
- **Konstanta**: `UPPER_SNAKE_CASE` (contoh: `MAX_WORKERS_PER_USER`).

### Struktur Kode
- **Import**: Kelompokkan import library eksternal di atas, diikuti import internal.
- **Async/Await**: Gunakan `async/await` daripada `Promise.then()`.
- **Typing**: Hindari `any` sebisa mungkin. Buat Interface/Type untuk struktur data kompleks.

---

## 3. Arsitektur Proyek

Pahami struktur folder ini sebelum membuat file baru:

```
src/
├── api/                # Server Express & Webhook Controller
├── commands/           # Definisi & Logika Slash Command (1 file = 1 command)
├── config/             # Konfigurasi Environment & Konstanta Global
├── database/           # Setup Prisma Client
├── events/             # Discord Event Listeners (ready, interaction, message)
├── handlers/           # Routing Interaksi UI (Button, Modal, Select)
├── interfaces/         # Definisi Tipe Data (Interface Command, dll)
├── scripts/            # Script Utilitas (Deploy Commands)
├── services/           # Business Logic (Jantung Aplikasi - DB operations disini)
├── utils/              # Fungsi Bantuan (Logger, Encryption, Validator)
├── views/              # UI Builder (Embeds & Components)
└── workers/            # Script Worker Thread (Proses terisolasi)
```

**Aturan Arsitektur:**
1.  **Separation of Concerns**: Handler UI (`src/handlers`) **TIDAK BOLEH** memanggil database langsung. Panggil `Service` yang sesuai.
2.  **Service Layer**: Semua logika bisnis dan akses DB harus ada di `src/services`.
3.  **View Layer**: Kode pembuatan Embed/Button harus dipisah ke `src/views`.

---

## 4. Penanganan Error & Logging

- **Jangan gunakan `console.log`**. Gunakan utility `Logger` yang sudah disediakan.
  ```typescript
  import { Logger } from '../utils/logger';
  
  Logger.info('Pesan info', 'Context');
  Logger.error('Pesan error', errorObj, 'Context');
  ```
- **Try-Catch**: Selalu bungkus proses async yang berisiko (DB, API Call) dengan `try-catch`.
- **User Feedback**: Jika error terjadi saat interaksi user, berikan balasan *Ephemeral* agar user tahu (jangan diam saja).

---

## 5. Keamanan & Konfigurasi

- **Environment Variables**: Jangan pernah hardcode credentials (Token, API Key). Panggil dari `src/config/index.ts`.
- **Validasi Input**: Selalu validasi input dari Modal/Command sebelum diproses.
- **Enkripsi**: Token user Discord harus dienkripsi menggunakan `src/utils/security.ts` sebelum disimpan ke DB.

---

## 6. Instruksi Khusus Agen

1.  **Analisis Dulu**: Sebelum mengedit, baca file terkait secara menyeluruh.
2.  **Plan Mode**: Jika diminta membuat rencana, buatlah Todo List yang detail.
3.  **Refactoring**: Jika melihat kode di `handlers` yang mengakses `prisma` langsung, refactor ke `services`.
4.  **Bahasa**: Output penjelasan dan komentar kode harus dalam Bahasa Indonesia.
