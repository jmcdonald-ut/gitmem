# CLAUDE.md

## Project overview

gitmem is an AI-powered git history index. It enriches commits with Claude API classifications and summaries, stores everything in a local SQLite database, and provides full-text search with no LLM calls at query time.

## Tech stack

- **Runtime**: Bun (not Node.js)
- **Language**: TypeScript (strict mode, ESNext, bundler module resolution)
- **UI**: Ink (React-based terminal UI) with React 18
- **CLI framework**: Commander
- **Database**: SQLite via `bun:sqlite` (WAL mode, FTS5 for search)
- **AI**: Anthropic SDK (`@anthropic-ai/sdk`) for commit enrichment
- **Testing**: `bun:test` with `ink-testing-library` for component tests
- **Linting**: ESLint 9 flat config + typescript-eslint + react-hooks + prettier
- **Formatting**: Prettier (no semicolons)

## Commands

```bash
bun test              # Run tests (100% coverage thresholds enforced)
bun run lint          # ESLint
bun run format        # Prettier
bun run format:check  # Prettier check
bun run build         # Compile to standalone binary at build/gitmem
```

## Project structure

```
src/
  cli.tsx              # Entry point — registers commands via addCommand()
  types.ts             # All shared types, interfaces, and constants
  commands/            # One directory per CLI command
    <name>/
      command.tsx      # Commander definition, options, help text, action handler
      <Name>.tsx       # Ink React component for terminal UI
      <Name>.test.tsx  # Component tests (co-located)
    utils/
      command-context.ts   # Shared runCommand() setup (git, db, format, API key)
      test-utils.ts        # Test helpers (waitForFrame)
  db/                  # SQLite repositories and schema
    database.ts        # Schema creation, WAL + FK setup
    commits.ts         # Commit CRUD (CommitRepository)
    aggregates.ts      # File stats, coupling, contributors (AggregateRepository)
    search.ts          # FTS5 index and search (SearchService)
    batch-jobs.ts      # Batch job tracking (BatchJobRepository)
  services/            # Business logic and external integrations
    git.ts             # Git CLI interaction via Bun shell ($`...`)
    llm.ts             # Anthropic API for single commit enrichment (LLMService)
    llm-shared.ts      # Shared prompt, message builder, response parser
    batch-llm.ts       # Anthropic Message Batches API (BatchLLMService)
    enricher.ts        # Orchestrates the 4-phase pipeline (EnricherService)
    aggregator.ts      # Computes per-file stats, coupling, contributors
```

## Architecture

The indexing pipeline has 4 phases:
1. **Discover** - Extract commit metadata from git (bulk via `getCommitInfoBatch`)
2. **Enrich** - Classify each commit via Claude API (parallel sliding window or batch API)
3. **Aggregate** - Compute per-file analytics: hotspots, contributors, file coupling
4. **Index** - Rebuild SQLite FTS5 full-text search index

Data is stored in `.gitmem/index.db`. Services use dependency injection via interfaces (`IGitService`, `ILLMService`).

## Code conventions

- No semicolons (Prettier config)
- Path aliases: `@/` = `src/`, `@db/` = `src/db/`, `@services/` = `src/services/`, `@commands/` = `src/commands/`
- Tests are co-located: `foo.ts` has `foo.test.ts` in the same directory
- Tests use in-memory SQLite (`:memory:`) and factory functions like `makeCommit()`
- 100% test coverage thresholds (line, function, statement) enforced via `bunfig.toml`
- Classes for repositories and services, interfaces prefixed with `I` for dependency injection
- Commit classifications: `bug-fix`, `feature`, `refactor`, `docs`, `chore`, `perf`, `test`, `style`

## Environment

- Requires `ANTHROPIC_API_KEY` env var for indexing commands
- Database stored at `<repo>/.gitmem/index.db`
- Git operations use `Bun.$` shell with `-C` flag for working directory
