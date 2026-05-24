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

## Architecture & Knowledge Graph

This project uses **Graphify** to maintain a comprehensive knowledge graph of its architecture, enabling quick navigation across the 42,000+ word codebase. 

Based on the latest Graphify insights, the codebase is structurally organized into 24 distinct communities bridging the Rust backend and Next.js frontend:

*   **Core Abstractions (God Nodes)**: Central to the project's operation are utility functions like `cn()` for uniform styling across React components, and `get_db_path()` / `get_active_account()` for robust data access and state management in Rust.
*   **Frontend Authentication**: The Next.js pages heavily rely on `useAuth()` to manage secure state bridging between the UI and Tauri layers.
*   **Backend Synchronization**: Processes like `sync_folder()` handle complex operations connecting local databases with remote data.
*   **Exploration**: Run `graphify query "<your question>"` to explore the relationship between any undocumented components or to traverse across the architectural communities. Don't forget to run `graphify update .` after code changes to keep the graph AST up to date.

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

*   `app/`: Contains the Next.js App Router pages and layouts.
*   `components/`: Houses reusable React UI components (e.g., Settings modules).
*   `lib/`: Includes utility functions (like `cn()`) and data providers.
*   `src-tauri/`: Manages the Rust-based Tauri configuration, database access, and backend sync logic.
*   `graphify-out/`: Contains the generated knowledge graph and architecture reports.

## Contributing

Contributions are welcome. Please feel free to submit a pull request or open an issue to discuss proposed changes. When making changes, please remember to update the Graphify knowledge base.

## License

This project is distributed under the MIT License.
