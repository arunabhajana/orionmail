# OrionMail

OrionMail is a modern, high-performance email client built with Next.js, Tauri, and Tailwind CSS. It features a sleek, glassmorphic user interface inspired by macOS design principles, offering a premium experience with smooth animations and a refined aesthetic focus.

## Key Features

*   **Glassmorphic Interface**: A sophisticated, translucent UI with advanced blur effects and semantic color systems.
*   **Modern Technology Stack**: Developed using Rust (Tauri) for high-performance backend logic and React (Next.js) for a flexible frontend.
*   **Fluid Animations**: Seamless transitions and micro-interactions implemented via Framer Motion.
*   **Mock Data Integration**: Robust mock data sets provided for efficient development and testing.
*   **Comprehensive Settings**: A modular settings architecture allowing for extensive account and appearance customization.
*   **Optimized Performance**: A lightweight and efficient application, leveraging Tauri's minimal bundle size.

## Technology Stack

*   **Frontend**: Next.js 14, React, TypeScript
*   **Styling**: Tailwind CSS v4
*   **Desktop Framework**: Tauri v2 (Rust)
*   **Iconography**: Lucide React
*   **Animation Engine**: Framer Motion

## Getting Started

### Prerequisites

The following components are required for local development:
*   Node.js (v18 or higher)
*   Rust and Cargo (required for Tauri builds)

### Installation

1.  Clone the repository:
    ```bash
    git clone https://github.com/arunabhajana/orionmail.git
    cd orionmail
    ```

2.  Install the required dependencies:
    ```bash
    npm install
    ```

3.  Launch the development environment:
    ```bash
    npm run tauri dev
    ```

## Project Structure

*   `app/`: Contains the Next.js app router pages and layouts.
*   `components/`: Houses reusable UI components.
    *   `settings/`: Contains modular sections for the settings interface.
*   `lib/`: Includes utility functions and mock data providers.
*   `src-tauri/`: Manages the Rust-based Tauri configuration and backend logic.

## Contributing

Contributions are welcome. Please feel free to submit a pull request or open an issue to discuss proposed changes.

## License

This project is distributed under the MIT License.

