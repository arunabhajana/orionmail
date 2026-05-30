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

OrionMail connects local robustness with web-like flexibility. Key aspects of the project include:

*   **Offline-First & Fast Sync**: Seamlessly synchronize your inbox with the Rust backend handling complex background operations (e.g., `sync_folder`), data persistence, and local database management (`get_db_path()`).
*   **Secure Email Rendering**: Robust email sanitization using DOMPurify ensures safety when rendering HTML content from untrusted senders.
*   **High Performance UI**: Easily handles thousands of emails in your inbox utilizing virtualized lists (`@tanstack/react-virtual`).
*   **Deep OS Integration**: Utilizing Tauri's native plugins for system-level dialogs and push notifications, bringing a native app feel to web technologies.
*   **Adaptive Theming**: Built-in support for multiple color schemes including dark mode using `next-themes`.
*   **State Management & Auth**: Clean React abstractions including the `useAuth()` hook securely manage active accounts and state (`get_active_account()`) bridging the UI and the local Tauri system.

---

## Getting Started

### Prerequisites

The following components are required for local development:
*   [Node.js](https://nodejs.org/) (v18 or higher)
*   [Rust and Cargo](https://rustup.rs/) (required for Tauri builds)

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
