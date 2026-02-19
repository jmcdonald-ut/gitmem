/** Returns the full content of the SKILL.md file for Claude Code. */
export function getSkillContent(): string {
  return `---
name: use-gitmem
description: Search git history, find hotspots, coupling, trends, and codebase analytics using the gitmem CLI. Use when asked about git history, commit search, file hotspots, change coupling, code trends, or codebase analysis.
---

# gitmem — AI-powered git history index

gitmem enriches git commits with AI-generated classifications and summaries, stored in a local SQLite database. All query commands run locally with **no API calls**.

## Setup

If the index doesn't exist yet, the user must run:

\`\`\`bash
export ANTHROPIC_API_KEY=sk-ant-...
gitmem index
\`\`\`

Check index health with \`gitmem status\`.

## Query commands

### Search commits

\`\`\`bash
gitmem query "auth bug"              # Full-text search over enriched commits
gitmem query "refactor database" -n 20  # Limit results
gitmem query "auth bug" --json       # Machine-readable output
\`\`\`

### Find hotspots

\`\`\`bash
gitmem hotspots                      # Most-changed files with classification breakdown
gitmem hotspots -n 20               # Top 20 files
gitmem hotspots --all                # Include test/docs/generated files
gitmem hotspots --json               # Machine-readable output
\`\`\`

### File coupling

\`\`\`bash
gitmem coupling                      # Files that frequently change together
gitmem coupling src/auth.ts          # Coupling for a specific file
gitmem coupling --json               # Machine-readable output
\`\`\`

### Change trends

\`\`\`bash
gitmem trends                        # Change velocity over time (monthly)
gitmem trends --interval weekly      # Weekly breakdown
gitmem trends --json                 # Machine-readable output
\`\`\`

### File/directory stats

\`\`\`bash
gitmem stats src/auth.ts             # Detailed stats for a file
gitmem stats src/services/           # Aggregate stats for a directory
gitmem stats src/auth.ts --json      # Machine-readable output
\`\`\`

### Index status

\`\`\`bash
gitmem status                        # Coverage %, commit counts, DB size
gitmem status --json                 # Machine-readable output
\`\`\`

### Database schema

\`\`\`bash
gitmem schema                        # Display table and column documentation
gitmem schema --json                 # Machine-readable output
\`\`\`

### Interactive visualization

\`\`\`bash
gitmem visualize                     # Opens circle-packing visualization in browser
\`\`\`

## Tips

- Use \`--json\` on any command for structured output suitable for further processing.
- By default, test, docs, and generated files are excluded from hotspots and coupling. Use \`--all\` to include them.
- The database is at \`.gitmem/index.db\` and can be queried directly with SQLite. Run \`gitmem schema\` to see the table definitions.
`
}
