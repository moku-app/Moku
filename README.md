<div align="center">
  <img src="src/assets/moku-icon.svg" width="96" />
  <h1>Moku</h1>
  <p>A fast, minimal manga reader for <a href="https://github.com/Suwayomi/Suwayomi-Server">Suwayomi-Server</a>.<br/>Built with Tauri v2 and Svelte.</p>
</div>

---

## Requirements

[Suwayomi-Server](https://github.com/Suwayomi/Suwayomi-Server) must be running. By default Moku expects it at `http://127.0.0.1:4567`.

> Moku will attempt to launch the server automatically on startup if the `suwayomi-server` binary is on your `PATH`.

---

## Installation

**Nix (recommended)**

```bash
nix run github:Youwes09/moku
```

Add to your flake:

```nix
inputs.moku.url = "github:Youwes09/moku";
```

**From source**

```bash
git clone https://github.com/Youwes09/moku
cd moku
nix build
./result/bin/moku
```

---

## Development

```bash
nix develop
pnpm install
pnpm tauri:dev
```

---

## Stack

| | |
|---|---|
| [Tauri v2](https://tauri.app) | Native app shell |
| [Svelte](https://svelte.dev) + [TypeScript](https://www.typescriptlang.org) | UI |
| [Vite](https://vitejs.dev) | Frontend bundler |
| [Crane](https://github.com/ipetkov/crane) | Nix Rust builds |

---

## License

Distributed under the [Apache 2.0 License](./LICENSE).

---

## Disclaimer

Moku does not host or distribute any content. The developers have no affiliation with any content providers accessible through connected sources.
