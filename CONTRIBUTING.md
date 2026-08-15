# Contributing to brg

Thanks for considering a contribution — `brg` is early-stage, and every
contribution (code, docs, bug reports, ideas) genuinely helps shape it.

## Ways to contribute

- **Report a bug** — open an [issue](../../issues/new/choose) with steps to
  reproduce, what you expected, and what actually happened.
- **Suggest a feature** — open an issue describing the use case, not just the
  solution. Context helps us design it right.
- **Fix a bug / build a feature** — look for issues tagged
  [`good first issue`](../../issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)
  if you're new here.
- **Improve docs** — typos, unclear steps, missing examples — all welcome,
  no issue needed for small fixes.

## Development setup

```bash
git clone https://github.com/brghq/brg.git
cd brg
npm install
npm link          # makes the `brg` command available globally, pointing at your local checkout
```

Run the CLI locally with:
```bash
brg --help
```

## Making a change

1. Fork the repo and create a branch off `main`:
   ```bash
   git checkout -b fix/short-description
   ```
2. Make your change. Keep commits focused — one logical change per commit.
3. Add or update tests if you're changing behavior.
4. Run the test suite before opening a PR:
   ```bash
   npm test
   ```
5. Push and open a pull request against `main`. Fill out the PR template —
   it's short on purpose.

## Commit messages

We loosely follow [Conventional Commits](https://www.conventionalcommits.org/):
```
feat: add brg checkout --list flag
fix: summary.md regeneration dropping the newest checkpoint on Windows paths
docs: clarify setup wizard flow in README
```
Not strictly enforced, but it makes `brg log`-style history much easier to
scan later.

## Code style

- TypeScript, kept close to the existing style in the file you're editing.
- Prefer small, readable functions over clever one-liners.
- If you're adding a new command, check the [command reference](./README.md#command-reference)
  and [ROADMAP.md](./ROADMAP.md) first — new commands should fit the
  existing verb/noun pattern (`brg <verb> <noun>`).
- Adding support for a new AI CLI means adding one adapter file under
  `src/tools/` that implements the `ToolAdapter` interface — see the
  existing adapters (`claude.ts`, `codex.ts`) for the shape, and register
  it in `tools/registry.ts`. No changes needed elsewhere in the codebase.
  Gemini CLI and OpenCode adapters would be welcome community
  contributions using this pattern.

## Pull request review

- A maintainer will review and may ask for changes — this is normal, not a
  rejection.
- Once approved, a maintainer will merge. You don't need merge access to
  contribute.

## Reporting security issues

Please **do not** open a public issue for security vulnerabilities. See
[SECURITY.md](./SECURITY.md) for how to report privately.

## Code of Conduct

This project follows a [Code of Conduct](./CODE_OF_CONDUCT.md). Participating
means agreeing to keep interactions respectful and constructive.
