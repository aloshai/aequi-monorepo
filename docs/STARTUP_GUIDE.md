# Project Startup Guide

This guide describes how to set up and run the Aequi Monorepo project.

## Prerequisites
- **Node.js**: v18+ (v20+ recommended)
- **Bun**: v1.2+ (Recommended package manager)

## 1. Environment Setup

Copy the example environment files to create your local configurations:

```bash
# Root environment (if needed by specific scripts)
cp .env.example .env

# Server environment
cp apps/server/.env.example apps/server/.env

# Web environment
cp apps/web/.env.example apps/web/.env
```

**Note:** You may need to edit `apps/server/.env` to add valid RPC URLs if the defaults are not sufficient.

## 2. Installation

Install all dependencies using Bun:

```bash
bun install
```

## 3. Building Packages (Critical)

Since this is a monorepo with internal packages (like `@aequi/dex-adapters`, `@aequi/pricing`), you **MUST** build the project at least once before starting the development server. This compiles the TypeScript packages in `packages/*` to JavaScript so the apps can consume them.

```bash
bun run build
```

*Note: If you skip this step, you may see errors like "Cannot find module" or "File not found" for internal packages.*

## 4. Running Development Server

Start all applications (server and web) in development mode:

```bash
bun run dev
```

- **Web App**: http://localhost:5173
- **API Server**: http://localhost:3000

## Troubleshooting

- **Missing modules**: Ensure you ran `bun run build`.
- **Vite errors**: Verify your Node.js version is compatible (v18+).
- **Environment errors**: Check that `.env` files exist in `apps/server` and `apps/web`.
