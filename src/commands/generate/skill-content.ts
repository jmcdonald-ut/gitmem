/** Returns the full content of the SKILL.md file for Claude Code. */
export function getSkillContent(): string {
  return `---
name: use-gitmem
description: Use when investigating why code was written or changed, searching for past bug fixes in an area, finding files that co-evolve together, identifying high-risk or frequently buggy files, scoping work in unfamiliar code, or assessing change trends. Provides AI-enriched git history search, hotspots, coupling analysis, and trends via the gitmem CLI.
---

# gitmem — Git History Intelligence

gitmem enriches git commits with AI-generated classifications and summaries, stored in a local SQLite database. All query commands run locally with **no API calls**.

It provides signals you cannot get from static analysis alone — behavioral patterns like which files co-evolve, which areas accumulate bug fixes, and how change velocity shifts over time.

## Setup

If the index doesn't exist yet, the user must run:

\`\`\`bash
export ANTHROPIC_API_KEY=sk-ant-...
gitmem index
\`\`\`

Check index health with \`gitmem status\`.

## When to Reach for gitmem

**Investigating history or intent** — Use \`gitmem query\` to search enriched commit summaries. More useful than \`git log --grep\` because commits are classified (bug-fix, feature, refactor, etc.) and summarized. Filter by classification to narrow results.

**Finding what co-evolves with a file** — Use \`gitmem coupling <file>\` to find files that historically change alongside it. This reveals behavioral coupling that may not be visible from imports alone — useful for catching related files you might need to update, or during code review to spot what might be missing from a changeset.

**Finding high-risk or buggy files** — Use \`gitmem hotspots --sort bug-fix\` to surface files with the most bug-fix commits. Use \`--sort combined\` to find files that are both frequently changed and complex. Scope with \`--path <dir>\` to focus on a specific area.

**Profiling a file or directory** — Use \`gitmem stats <path>\` to see a file's classification breakdown, top contributors, and recent commits before making changes. For directories, shows aggregate stats and the hottest files within.

**Assessing change velocity** — Use \`gitmem trends <path>\` to see whether an area is stabilizing or accumulating more changes over time. Supports weekly, monthly, or quarterly windows.

**Custom analysis** — Use \`gitmem schema\` to see the database tables, then query \`.gitmem/index.db\` directly with SQL for questions the built-in commands don't cover.

## Command Reference

### gitmem query <query>

Full-text search over enriched commits.

\`\`\`bash
gitmem query "memory leak"
gitmem query "auth NOT oauth" --limit 5
gitmem query "refactor" --classification refactor
\`\`\`

Classifications: \`bug-fix\`, \`feature\`, \`refactor\`, \`docs\`, \`chore\`, \`perf\`, \`test\`, \`style\`

FTS5 syntax: \`"exact phrase"\`, \`term1 NOT term2\`, \`summary:keyword\`

### gitmem hotspots

Most-changed files with classification breakdown.

\`\`\`bash
gitmem hotspots                                  # Top files by total changes
gitmem hotspots --sort bug-fix                   # Files with the most bug fixes
gitmem hotspots --sort combined                  # High churn AND high complexity
gitmem hotspots --path src/services/ --limit 20  # Scoped to a directory
\`\`\`

Sort options: \`total\`, \`bug-fix\`, \`feature\`, \`refactor\`, \`docs\`, \`chore\`, \`perf\`, \`test\`, \`style\`, \`complexity\`, \`combined\`

### gitmem coupling [path]

Files that frequently change together (co-change in the same commit).

\`\`\`bash
gitmem coupling                        # Global top pairs
gitmem coupling src/auth.ts            # Files most coupled to a specific file
gitmem coupling src/services/          # Top pairs within a directory
\`\`\`

Test, docs, and generated files are excluded by default. Use \`--include-tests\`, \`--include-docs\`, \`--include-generated\`, or \`--all\` to override.

### gitmem stats <path>

Classification breakdown, top contributors, and recent commits for a file. Aggregate stats and hottest files for a directory.

\`\`\`bash
gitmem stats src/auth.ts
gitmem stats src/services/
\`\`\`

### gitmem trends <path>

Change velocity and classification mix over time.

\`\`\`bash
gitmem trends src/services/                      # Monthly (default)
gitmem trends src/services/ --window weekly       # Weekly granularity
gitmem trends src/ --window quarterly --limit 8   # Quarterly, last 8 periods
\`\`\`

Trend indicators: \`increasing\`, \`decreasing\`, or \`stable\`.

### gitmem schema

Database table documentation for writing custom SQL queries against \`.gitmem/index.db\`.

### gitmem status

Index health, coverage percentage, commit counts, and database size.

## Tips

- Use \`--json\` on any command for structured output.
- \`gitmem coupling\` and \`gitmem hotspots\` exclude test/docs/generated files by default.
- The \`--classification\` filter on \`gitmem query\` is useful for narrowing searches to specific change types.
- The database at \`.gitmem/index.db\` can be queried directly with SQLite for analysis the built-in commands don't cover.
`
}
