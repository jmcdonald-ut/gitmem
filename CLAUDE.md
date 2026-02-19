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
bun test              # Run tests (90% coverage threshold enforced)
bun run lint          # ESLint
bun run typecheck     # TypeScript type checking (tsc --noEmit)
bun run format        # Prettier
bun run format:check  # Prettier check
bun run build         # Compile to standalone binary at build/gitmem
```

## Project structure

```
src/
  cli.tsx              # Entry point — registers commands via addCommand()
  types.ts             # All shared types, interfaces, and constants
  schema.ts            # Database schema documentation
  output.ts            # CLI output format resolution
  commands/            # One directory per CLI command
    <name>/
      command.tsx      # Commander definition, options, help text, action handler
      <Name>.tsx       # Ink React component for terminal UI (most commands)
      <Name>.test.tsx  # Component tests (co-located)
    index/             # Also has BatchIndexCommand.tsx for --batch mode
    check/             # Also has BatchCheckCommand.tsx for --batch mode
    visualize/         # HTTP server (no Ink component): hierarchy.ts, page.ts
    utils/
      command-context.ts   # Shared runCommand() setup, file locking (index.lock)
      test-utils.ts        # Test helpers (waitForFrame)
      parse-int.ts         # Safe positive-integer parser for CLI options
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
    enricher.ts        # Orchestrates the 5-phase pipeline (EnricherService)
    measurer.ts        # Orchestrates complexity measurement for commit files
    complexity.ts      # Indentation-based complexity metrics
    file-filter.ts     # Test/docs/generated file exclusion logic
    checker.ts         # Orchestrates enrichment quality evaluation
    judge.ts           # Anthropic API for commit evaluation (JudgeService)
    judge-shared.ts    # Shared judge prompt, message builder, response parser
    batch-judge.ts     # Anthropic Message Batches API for evaluation (BatchJudgeService)
    batch-shared.ts    # Shared batch status polling utility
```

## CLI commands

| Command | Alias | Description |
|---------|-------|-------------|
| `index` | `i` | Run the 5-phase enrichment pipeline (`--batch` for async Batches API) |
| `query` | `q` | FTS5 full-text search over enriched commits (no API calls) |
| `hotspots` | `h` | Most-changed files with classification breakdown |
| `coupling` | `c` | Files that frequently change together |
| `trends` | `t` | Change velocity over time (weekly/monthly/quarterly) |
| `stats` | — | Detailed change statistics for a file or directory |
| `status` | `s` | Index health: coverage %, commit counts, DB size |
| `check` | — | LLM-as-judge quality evaluation of enrichments |
| `schema` | — | Display database schema documentation |
| `visualize` | `viz` | Interactive circle-packing visualization via local HTTP server |

Several commands (`hotspots`, `coupling`, `visualize`) support file-filter flags (`--include-tests`, `--include-docs`, `--include-generated`, `--all`) via `file-filter.ts`. By default, test, docs, and generated files are excluded.

## Architecture

The indexing pipeline has 5 phases:
1. **Discover** - Extract commit metadata from git (bulk via `getCommitInfoBatch`)
2. **Measure** - Compute indentation-based complexity metrics for changed files
3. **Enrich** - Classify each commit via Claude API (parallel sliding window or batch API)
4. **Aggregate** - Compute per-file analytics: hotspots, contributors, file coupling
5. **Index** - Rebuild SQLite FTS5 full-text search index

Data is stored in `.gitmem/index.db`. Write commands acquire a file lock (`.gitmem/index.lock`) to prevent concurrent access. Services use dependency injection via interfaces (`IGitService`, `ILLMService`, `IJudgeService`).

## Code conventions

- No semicolons (Prettier config)
- Path aliases: `@/` = `src/`, `@db/` = `src/db/`, `@services/` = `src/services/`, `@commands/` = `src/commands/`
- Tests are co-located: `foo.ts` has `foo.test.ts` in the same directory
- Tests use in-memory SQLite (`:memory:`) and factory functions like `makeCommit()`
- 90% test coverage threshold enforced via `bunfig.toml`
- Classes for repositories and services, interfaces prefixed with `I` for dependency injection
- Commit classifications: `bug-fix`, `feature`, `refactor`, `docs`, `chore`, `perf`, `test`, `style`

## Environment

- Requires `ANTHROPIC_API_KEY` env var for indexing commands
- Database stored at `<repo>/.gitmem/index.db`
- Git operations use `Bun.$` shell with `-C` flag for working directory
