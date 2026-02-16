# gitmem

AI-powered git history index. Enrich commits once with Claude, then search and analyze instantly — no LLM calls at query time.

gitmem extracts your repository's commit history, classifies each commit via the Anthropic API, and stores everything in a local SQLite database with full-text search. Run `gitmem index` to build, `gitmem query` to search.

gitmem helps users and LLMs answer aggregate and pattern-based questions about a git repo. The end goal is a tool that augments coding agents with answers to questions that are hard to get from the Git CLI alone. Sample questions that an LLM can hopefully answer using this tool include:

- What types of bugs recur?
- What files change the most? Why?
- What files tend to change together?
- Is this area of the code stabilizing or getting worse?

## Install

Requires [Bun](https://bun.sh).

```bash
git clone git@github.com:jmcdonald-ut/gitmem.git && cd gitmem
bun install
```

Set your API key:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

Build the CLI tool:

```bash
bun run build
```

## Usage

### Index a repository

```bash
gitmem index
```

Discovers commits, sends each to the Anthropic API for classification and summarization, then builds aggregates and a full-text search index. Progress is displayed in real time:

```
⠋ Enriching commits...
Enriching commit 42 / 128 [a1b2c3d]

Indexing complete!
Enriched this run: 128
Total coverage: 128 / 128 commits (100%)
```

Use a different model with `--model`:

```bash
gitmem index --model claude-sonnet-4-5-20250929
```

The default model is `claude-haiku-4-5-20251001`. Indexing is incremental — re-running only processes new or unenriched commits.

#### Batch mode

Use the Anthropic Message Batches API for 50% cost reduction:

```bash
gitmem index --batch
```

Batch mode is stateful across invocations. The first run submits all unenriched commits as a batch. Subsequent runs poll for progress and import results when complete:

```
# First run
Batch submitted! ID: msg_bch_xxx. Run `gitmem index --batch` again to check status.

# Later run
Indexing complete!
Enriched this run: 128
Total coverage: 128 / 128 commits (100%)
```

### Search the index

```bash
gitmem query "authentication bug"
```

Searches are pure SQLite FTS5 lookups with no API calls:

```
Query: authentication bug

Matching commits (3):
 a1b2c3d [bug-fix] Fixed session expiry causing silent auth failures
 e4f5a6b [bug-fix] Corrected OAuth token refresh race condition
 c7d8e9f [feature] Added JWT-based authentication flow

Top hotspots:
  src/auth/session.ts (24 changes, 8 bug fixes)
  src/middleware/auth.ts (18 changes, 5 bug fixes)
```

Limit results with `--limit`:

```bash
gitmem query "refactor" --limit 5
```

### Evaluate enrichment quality

```bash
gitmem check abc123f
```

Evaluates a single commit's enrichment using an LLM-as-judge (default: Claude Sonnet 4.5). The judge assesses classification correctness, summary accuracy, and summary completeness:

```
Evaluation for abc123f

  Original: [feature] Add batch indexing support

  [PASS] Classification
         The commit introduces a new feature...

  [PASS] Summary accuracy
         Accurately describes the changes made.

  [PASS] Summary completeness
         Covers the main changes adequately.
```

Evaluate a random sample of enriched commits with `--sample`:

```bash
gitmem check --sample 50
```

```
Evaluation Summary (50 commits)

  Classification: 47/50 correct
  Summary accuracy: 45/50 accurate
  Summary completeness: 43/50 complete

  Details saved to: .gitmem/check-20260216T123045.json
```

### Check index status

```bash
gitmem status
```

```
Indexed: 128 / 128 commits (100%)
Enriched: 128 / 128 indexed commits (100%)
Last run: 2025-01-15T10:30:00.000Z
Model: claude-haiku-4-5-20251001
DB: /path/to/repo/.gitmem/index.db
DB size: 2.4 MB
```

## How it works

gitmem runs a four-phase pipeline:

```
1. Discover   — extract commit metadata and file stats from git
2. Enrich     — classify each commit via Claude API (bug-fix, feature, refactor, docs, chore, perf, test, style)
3. Aggregate  — compute per-file analytics: change hotspots, contributor breakdown, file coupling
4. Index      — rebuild SQLite FTS5 full-text search index
```

All data is stored in `.gitmem/index.db` (SQLite, WAL mode). The database includes:

- **commits** — hash, author, timestamp, message, classification, AI summary
- **commit_files** — per-file additions/deletions for each commit
- **file_stats** — change counts by classification type, first/last seen dates
- **file_contributors** — which authors modify which files
- **file_coupling** — files that frequently change together
- **batch_jobs** — batch API job state for resumable enrichment
- **commits_fts** — FTS5 virtual table for fast text search

## Project structure

```
src/
├── cli.tsx                      # Entry point, command definitions
├── types.ts                     # Shared types and interfaces
├── commands/
│   ├── index-command.tsx         # Index progress UI
│   ├── batch-index-command.tsx   # Batch index progress UI
│   ├── check-command.tsx         # Evaluation results display
│   ├── query-command.tsx         # Search results display
│   └── status-command.tsx        # Index health display
├── db/
│   ├── database.ts               # Schema creation, SQLite setup
│   ├── commits.ts                # Commit CRUD operations
│   ├── aggregates.ts             # File stats, coupling, contributors
│   ├── batch-jobs.ts             # Batch job tracking
│   └── search.ts                 # FTS5 index and search
└── services/
    ├── git.ts                    # Git command execution via Bun shell
    ├── llm.ts                    # Anthropic API integration
    ├── llm-shared.ts             # Shared prompt and response parsing
    ├── batch-llm.ts              # Anthropic Message Batches API
    ├── enricher.ts               # Orchestrates the 4-phase pipeline
    ├── aggregator.ts             # Computes per-file stats, coupling, contributors
    ├── checker.ts                # Quality evaluation workflow
    ├── judge.ts                  # LLM-as-judge API client
    └── judge-shared.ts           # Judge prompt and response parsing
```

## Development

```bash
bun test              # Run tests
bun test --coverage   # Run tests with coverage
bun run lint          # ESLint
bun run format        # Prettier
bun run build         # Compile to standalone binary at build/gitmem
```
