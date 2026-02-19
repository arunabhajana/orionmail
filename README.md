# OrbitMail 🚀

OrbitMail is a modern, high-performance email client built with **Next.js**, **Tauri**, and **Tailwind CSS**. It features a sleek, glassmorphic UI inspired by macOS design principles, offering a premium user experience with smooth animations and a focus on aesthetics.

## Features ✨

*   **Glassmorphism UI**: A stunning, translucent interface with blur effects and semantic coloring.
*   **Modern Tech Stack**: Built on the robustness of Rust (Tauri) and the flexibility of React (Next.js).
*   **Animations**: Fluid transitions and micro-interactions powered by `framer-motion`.
*   **Mock Data Integration**: value-rich mock data for development and testing.
*   **Settings System**: A comprehensive settings page with modular sections for Account and Appearance customization.
*   **Optimized Performance**: Lightweight and fast, leveraging Tauri's small bundle size.

## Tech Stack 🛠️

*   **Frontend**: Next.js 14, React, TypeScript
*   **Styling**: Tailwind CSS v4
*   **Desktop Framework**: Tauri v2 (Rust)
*   **Icons**: Lucide React
*   **Animations**: Framer Motion

## Getting Started 🏁

### Prerequisites

Ensure you have the following installed:
*   Node.js (v18+)
*   Rust & Cargo (for Tauri)

### Installation

1.  Clone the repository:
    ```bash
    git clone https://github.com/yourusername/orbitmail.git
    cd orbitmail
    ```

2.  Install dependencies:
    ```bash
    npm install
    ```

3.  Run the development server:
    ```bash
    npm run tauri dev
    ```

## Project Structure 📂

*   `app/`: Next.js app router pages and layouts.
*   `components/`: Reusable UI components.
    *   `settings/`: Modular settings page sections.
*   `lib/`: Utility functions and mock data.
*   `src-tauri/`: Rust backend configuration for Tauri.

## Contributing 🤝

Contributions are welcome! Please feel free to submit a Pull Request.

## License 📄

This project is licensed under the MIT License.
