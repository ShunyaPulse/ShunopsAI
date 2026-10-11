---
description: Unified engineering, security, and runtime invariants from SaralGati and Sagentic
always_on: true
---

# SaralGati & Sagentic Unified Engineering Invariants

## 1. Zero Hardcoded Secrets & Credentials Invariant
- **Rule**: NEVER hardcode, paste, or default credentials, database passwords, API tokens, connection strings, or private keys into ANY Git-tracked file (including test scripts, scratch files, configs, documentation, or workflows).
- **Enforcement**: Always read secrets from environment variables (e.g. `process.env.DATABASE_URL`, `process.env.API_SECRET`) with generic placeholders (`'REPLACE_WITH_SECRET'`) if fallbacks are needed.
- **Location**: Actual credentials must ONLY reside in `.env` / `.env.local` (git-ignored) or platform Secret Managers (Cloud Run / GitHub Secrets).

## 2. GitHub Actions Shell Injection Prevention
- **Rule**: Never interpolate `${{ ... }}` context expressions (such as `github.event.*`, `inputs.*`, `vars.*`) directly inside `run:` inline bash scripts in `.github/workflows/`.
- **Enforcement**: Always map them to intermediate environment variables under `env:` and access them via `"$ENV_VAR"` in shell scripts.

## 3. Windows PowerShell Command Chaining
- **Rule**: In Windows terminal commands, always use `;` (semicolon) to chain sequential commands instead of `&&`.

## 4. Zod v4 API Invariants
- Always use `error.issues` instead of `error.errors`.
- Do NOT manually type-annotate `err` in `error.issues.forEach((err) => ...)` (Zod v4 `$ZodIssue.path` is `PropertyKey[]`, including `symbol`).
- Always use two arguments for `z.record(z.string(), ...)` instead of `z.record(...)`.

## 5. Nested Dependency CVE Fixes & Overrides
- When fixing vulnerabilities in indirect/nested dependencies (e.g., `postcss` under `next` or `nodemailer`), prefer `package.json` `"overrides"` combined with `npm install --legacy-peer-deps` instead of breaking framework upgrades.

## 6. Container Hardening
- Enforce non-root execution (`USER node`) in multi-stage Dockerfiles.
