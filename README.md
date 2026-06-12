<div align="center">
  <img src="public/app-icon.svg" alt="OrionMail Logo" width="128" />
  <h1>OrionMail</h1>
</div>

OrionMail is a modern, high-performance desktop email client built with **Next.js**, **Tauri**, and **Tailwind CSS**. Designed with a refined aesthetic focus, it features a sleek, glassmorphic user interface inspired by macOS design principles, offering a premium experience with smooth animations and an intuitive layout.

## Highlights

*   **Glassmorphic Interface**: A sophisticated, translucent UI with advanced blur effects and semantic color systems.
*   **Modern Technology Stack**: Developed using Rust (Tauri) for high-performance backend logic and React (Next.js) for a flexible frontend.
*   **Fluid Animations**: Seamless transitions and micro-interactions implemented via Framer Motion & GSAP.

---

## Detailed Features & Architecture

OrionMail connects local robustness with web-like flexibility. Key features and their underlying mechanics include:

### ⚡ Core Capabilities
*   **Offline-First Database**: Uses a local SQLite database (`get_db_path()`, `init_from_db()`) to store emails, contacts, and account configurations, ensuring instant access even without an internet connection.
*   **Smart Background Sync**: The Rust backend handles complex IMAP/SMTP operations (`sync_folder()`, `sync_inbox()`) quietly in the background without blocking the UI.
*   **Predictive Body Prefetching**: Features a dedicated `BodyPrefetchManager` and background worker (`spawn_worker()`) that preemptively downloads and caches email contents (`fetch_and_cache_body_internal()`) for zero-latency reading.
*   **Multi-Provider Authentication**: Secure OAuth flows for Google and Outlook, plus support for Custom IMAP/SMTP configurations, managed via a secure local `AuthStore` and seamlessly integrated with the React frontend.

### 🎨 User Interface & Experience
*   **Glassmorphic & Adaptive Theming**: A sophisticated, translucent UI built with Tailwind CSS. Includes dynamic accent color customization (`AccentColorProvider`, `useAccentColor()`) and dark mode support.
*   **High-Performance Email List**: Utilizes virtualized lists to effortlessly render thousands of emails (`EmailList`), paired with smooth transitions and interactive loaders like `OrbitLoader`.
*   **Secure Email Rendering**: Robust email sanitization ensures safety when rendering HTML content from untrusted senders in the `EmailDetail` view.
*   **Integrated Compose & Attachments**: A feature-rich `ComposeModal` for drafting emails, alongside native attachment handling and a dedicated downloads manager (`useDownloads()`, `download_attachment()`).

### 🧠 Smart Features & OS Integration
*   **Intelligent Content Extraction**: A robust extraction pipeline (`run_extraction_pipeline()`) that parses inline images (`rewrite_cid_images()`) and decodes calendar invites (ICS) for enhanced viewing.
*   **Automated Contact Management**: Automatically extracts and stores contacts from your communications (`extract_and_store_contacts()`) into a local database, enabling fast address auto-completion (`search_contacts()`).
*   **Deep OS Integration**: Leverages Tauri for native system tray support (`spawn_tray_update_loop()`), background OS notifications (`show_new_emails()`), and "minimize to tray" functionality (`was_launched_minimized()`).
*   **Instant Actions**: Perform standard email operations—like starring (`toggle_star()`), marking as read (`toggle_read()`), and deleting (`delete_message()`)—with immediate optimistic UI updates backed by robust local-to-remote sync.

---

## Getting Started

### Prerequisites

The following components and versions are required for local development:
*   **[Node.js](https://nodejs.org/)**: v18 or higher
*   **[Rust](https://rustup.rs/)**: v1.77.2 or higher (specified in `Cargo.toml`)

### Core Dependencies

**Frontend (`package.json`)**:
*   **Next.js**: v16.1.6
*   **React**: v19.2.3
*   **Tailwind CSS**: v4.x
*   **Tauri API/CLI**: v2.10.x

**Backend (`Cargo.toml`)**:
*   **Tauri**: v2.10.0
*   **Rusqlite**: v0.38.x (for local SQLite storage)
*   **IMAP & Lettre**: For email synchronization and SMTP sending
*   **OAuth2**: For secure Google and Outlook authentication

### 1. Clone the repository
```bash
git clone https://github.com/arunabhajana/orionmail.git
cd orionmail
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Environment Variables
You need to set up the appropriate environment variables for the Tauri backend.
Create or edit the `.env` file in the `src-tauri/` directory:
```bash
# src-tauri/.env
GOOGLE_CLIENT_ID=your_google_client_id_here
GOOGLE_CLIENT_SECRET=your_google_client_secret_here
```
*(Note: A predefined `.env` with development keys may already be present in the repository for seamless initial setup. Ensure these are configured to your own Google Cloud Console credentials for production.)*

### 4. Launch Development Environment
```bash
npm run tauri dev
```

---

## Project Structure

### Frontend (Next.js & React)
*   `app/`: Contains the Next.js App Router pages and layouts, handling routing and core views.
*   `components/`: Houses reusable React UI components (e.g., Settings modules, Email list items), styled with Tailwind CSS.
*   `hooks/`: Custom React hooks for frontend state management and encapsulating side effects.
*   `lib/`: Includes utility functions (like `cn()`) and data providers.
*   `public/`: Static assets such as images and icons.

### Backend (Tauri & Rust)
*   `src-tauri/`: Manages the Rust-based Tauri configuration, local database access, and core backend logic.
    *   `src/auth/`: Handles secure authentication flows (e.g., Google OAuth).
    *   `src/commands/`: Defines Tauri IPC (Inter-Process Communication) commands exposed to the frontend.
    *   `src/contacts/`: Manages user contacts and address book functionality.
    *   `src/mail/`: Core email processing module, handling IMAP/SMTP synchronization, email parsing, and local storage management.

## Contributing

Contributions are welcome. Please feel free to submit a pull request or open an issue to discuss proposed changes.

## License

This project is distributed under the MIT License.
