# Security Policy

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**
Public issues disclose the problem before a fix is available.

Report privately using **GitHub's private vulnerability reporting**:
the **"Report a vulnerability"** button under this repository's
**Security** tab (Security → Advisories → Report a vulnerability). This
opens a private advisory visible only to the maintainers.

Please include:

- A description of the vulnerability and its impact.
- Steps to reproduce (proof-of-concept input, commands, or a minimal repo).
- Affected version / commit and your environment (OS, Node version).
- Any suggested remediation, if you have one.

We aim to acknowledge reports within a few days. There is **no bug-bounty
program** — reports are handled on a best-effort basis. Coordinated
disclosure is appreciated: please give us a reasonable window to ship a
fix before publishing details.

## Supported versions

BenchTrace is pre-1.0. Only the latest `main` (the default branch) is
supported; security fixes land there. Older commits/tags are not
back-patched.

| Version | Supported |
|---|---|
| `main` (latest) | ✅ |
| Anything older | ❌ |

---

# Dependency notes

## ⚠️ Do not run `npm audit fix` (or `--force`) on this repo

It will silently downgrade `next` and `drizzle-kit` to ancient majors
and introduce dozens of new vulnerabilities instead of removing any.
This actually happened once — `next 16.2.6` got rewritten to `^9.3.3`
(a 2020 release) and `drizzle-kit ^0.31.10` to `^0.18.1`. Audit
findings jumped from ~6 to **92**. The fix was to revert
`package.json` + `package-lock.json` and `npm ci`.

If you must run npm's audit tooling, use:

```bash
npm audit            # report only, no changes — safe
```

`.npmrc` sets `audit=false` so `npm install` doesn't print the audit
summary on every run. The 6 findings below have already been triaged
and aren't actionable, so the summary was just noise that scares
contributors into running the destructive `audit fix`. The setting
only affects install-time output; explicit `npm audit` still works.

To address a real vulnerability, do it by hand: read the advisory,
identify whether you actually exercise the affected code path, then
either bump the direct dependency or pin a transitive resolution.

## Known audit findings (accepted)

`npm audit` reports 6 moderate-severity advisories at the time of
writing. All are in dev-only or unreachable code paths:

| Package | Where | Why it's accepted |
|---|---|---|
| `esbuild <=0.24.2` | `drizzle-kit` → `@esbuild-kit/core-utils` → `esbuild` | The advisory ([GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99)) is about esbuild's **dev server** accepting cross-origin requests. We never run an esbuild dev server. drizzle-kit only uses esbuild internally for one-shot transformation during `db:push` / `db:generate` / `db:studio`. |
| `postcss <8.5.10` | `next` → `postcss` | The advisory ([GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93)) is XSS in PostCSS's CSS stringify output. Exploitable when an attacker controls the CSS being stringified. We don't accept user CSS. |

Both have "fixes" suggested by `npm audit fix --force` — both would
downgrade us back to the ancient majors. Ignore them.

## How to safely upgrade dependencies

```bash
# 1. See what's outdated
npm outdated

# 2. Bump a specific dep
npm install next@latest
# or
npm install --save-dev drizzle-kit@latest

# 3. Verify the project still works
npm run typecheck && npm run build && npm run bench:test

# 4. Re-check audit
npm audit
```

Always upgrade individual packages by name. Do not use `npm update`
broadly — it has the same downgrade-risk behavior as `audit fix`
under some constraints.

## What "redaction" covers (different from this file)

Application-level redaction of API keys, tokens, home paths, and env
secrets in exported share documents is documented in the README under
**Sharing** and implemented in `src/lib/redaction/index.ts`.
