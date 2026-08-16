# Contributing to OfflineSync

Thanks for your interest in contributing! This guide will help you get started.

## Prerequisites

- **Node.js** >= 20.0.0
- **pnpm** >= 9.0.0 (we use pnpm workspaces)

## Setup

```bash
git clone <your-fork-url>
cd OfflineSync
pnpm install
```

## Development Commands

| Command | Description |
|---|---|
| `pnpm build` | Build all packages |
| `pnpm build:clean` | Clean + build all packages |
| `pnpm test` | Run all tests |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm test:coverage` | Run tests with coverage report |
| `pnpm lint` | Lint all packages |
| `pnpm lint:fix` | Auto-fix lint issues |
| `pnpm typecheck` | Type-check all packages |
| `pnpm clean` | Remove all build artifacts and coverage |

## Project Structure

This is a **pnpm monorepo** with 12 packages under `packages/`:

| Package | Description |
|---|---|
| `@offlinesync/core` | Sync engine, collections, mutation queue, recovery |
| `@offlinesync/protocol` | Wire protocol types, validation, handshake |
| `@offlinesync/storage` | Storage adapter interface + in-memory implementation |
| `@offlinesync/storage-sqlite` | SQLite storage adapter (better-sqlite3) |
| `@offlinesync/conflict` | Conflict detection and resolution strategies |
| `@offlinesync/transport-http` | HTTP-based sync transport |
| `@offlinesync/transport-websocket` | WebSocket-based sync transport |
| `@offlinesync/server` | Reference sync server implementation |
| `@offlinesync/discovery` | LAN peer discovery (pluggable backends) |
| `@offlinesync/react` | React hooks integration |
| `@offlinesync/vue` | Vue composable integration |
| `@offlinesync/electron` | Electron IPC bridge |

## Architecture & Design

The codebase enforces **8 invariants** (INV-1 through INV-8) that guarantee data consistency. See the source code and README for details.

Key architectural decisions are documented as ADRs (Architecture Decision Records).

## Pull Request Process

1. **Fork** the repository and create a feature branch from `main`
2. **Make your changes** and ensure all four checks pass:
   ```bash
   pnpm lint && pnpm typecheck && pnpm test && pnpm build
   ```
3. **Write tests** for any new functionality or bug fixes
4. **Keep it small** — one logical change per PR
5. **Update docs** if you change public APIs

## Code Style

- TypeScript strict mode is enabled
- We use ESLint + Prettier — run `pnpm lint:fix` before committing
- No `any` types without explicit justification

## Reporting Issues

When filing bugs, please include:
- Minimal reproduction steps
- Expected vs actual behavior
- Node.js version, OS, and relevant package versions

## License

By contributing, you agree that your code will be licensed under the **MIT License**.
