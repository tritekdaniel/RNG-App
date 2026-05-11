# RNG App

A desktop application for generating random values from a user-defined list of inputs. Built with [Tauri 2](https://tauri.app/) and [Svelte 5](https://svelte.dev/).

## Features

- Add, edit, and remove input items
- Generate single random output (no repeats until all used)
- Generate batch outputs (shuffles remaining items)
- Track used outputs to avoid duplicates
- Toggle between single and batch output modes
- Save and load input lists as json files
- Remove individual outputs or clear all at once
- Batch input with items seperated by pipes- item|item|item, the app will handle it for you
- Cross-platform desktop app (Windows/macOS/Linux)
- Docked panel mode for multi-window workflows
- Customizable accent color with color picker
- Global keyboard shortcut for quick access
- UI sounds and hover animations
- **Search/filter** - Quick filter when lists get long
- **Drag-and-drop reordering** - Rearrange inputs/outputs
- **Keyboard navigation** - Arrow keys to navigate list items
- **Dark/Light theme** - Toggle between dark and light modes

## Screenshots

![Main Interface](examples/Screenshot%202026-05-10%20024915.png)

![Input Management](examples/Screenshot%202026-05-10%20025000.png)

![Output Tracking](examples/Screenshot%202026-05-10%20025058.png)

![Settings](examples/Screenshot%202026-05-10%20025149.png)

![Docked Panel Mode](examples/Screenshot%202026-05-10%20025347.png)

![Filter and Drag-Drop](examples/Screenshot%202026-05-10%20225621.png)

![Dark Theme](examples/Screenshot%202026-05-10%20225734.png)

## Tech Stack

- **Frontend:** Svelte 5, Vite
- **Backend:** Rust (Tauri 2)
- **Build Tool:** Tauri CLI

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (LTS version recommended)
- [Rust](https://www.rust-lang.org/tools/global) (1.70 or later)
- Windows: [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-studio-code/) or [BuildTools](https://visualstudio.microsoft.com/visual-studio-code/)

### Installation

```bash
# Install dependencies
npm install

# Start development server with Tauri
npm run tauri dev

# Build for production
npm run tauri build
```

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Vite dev server (browser only) |
| `npm run build` | Build frontend for production |
| `npm run tauri dev` | Run the full Tauri desktop app in development mode |
| `npm run tauri build` | Build the desktop application for release |

## Project Structure

```
├── svelte-app/           # Svelte frontend + Tauri wrapper
│   ├── src/              # Svelte components and routes
│   ├── public/           # Static assets
│   ├── src-tauri/        # Rust backend (Tauri)
│   │   ├── src/          # Rust source code
│   │   └── tauri.conf.json # Tauri configuration
│   └── package.json
├── .gitignore
└── README.md
```

## How It Works

1. **Add inputs** — Enter items you want to randomize (one per line or individually)
2. **Generate** — Click "Generate" for a single random pick, or "Batch Generate" to shuffle all remaining items
3. **Track results** — Generated outputs are listed and marked as used until cleared

## License

Custom license.
