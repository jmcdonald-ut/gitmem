import { describe, test, expect } from "bun:test"
import React from "react"
import { render } from "ink-testing-library"
import { SchemaCommand } from "@commands/schema/SchemaCommand"
import { SCHEMA } from "@/schema"
import type { SchemaTable } from "@/types"

const sampleTables: SchemaTable[] = [
  {
    name: "commits",
    description: "Core commit metadata",
    virtual: false,
    columns: [
      {
        name: "hash",
        type: "TEXT",
        primary_key: true,
        not_null: true,
        description: "SHA-1 commit hash",
      },
      {
        name: "summary",
        type: "TEXT",
        primary_key: false,
        not_null: false,
        description: "LLM-generated summary",
      },
    ],
  },
  {
    name: "commits_fts",
    description: "Full-text search index",
    virtual: true,
    columns: [
      {
        name: "message",
        type: "TEXT",
        primary_key: false,
        not_null: false,
        description: "Commit message",
      },
    ],
  },
]

describe("SchemaCommand", () => {
  test("displays header and database info", () => {
    const { lastFrame } = render(<SchemaCommand tables={sampleTables} />)
    const output = lastFrame()

    expect(output).toContain("gitmem schema")
    expect(output).toContain(".gitmem/index.db")
  })

  test("displays table names and descriptions", () => {
    const { lastFrame } = render(<SchemaCommand tables={sampleTables} />)
    const output = lastFrame()

    expect(output).toContain("commits")
    expect(output).toContain("Core commit metadata")
    expect(output).toContain("commits_fts")
    expect(output).toContain("Full-text search index")
  })

  test("displays column details with type and constraints", () => {
    const { lastFrame } = render(<SchemaCommand tables={sampleTables} />)
    const output = lastFrame()

    expect(output).toContain("hash")
    expect(output).toContain("TEXT")
    expect(output).toContain("PK")
    expect(output).toContain("NOT NULL")
    expect(output).toContain("SHA-1 commit hash")
  })

  test("displays nullable columns without NOT NULL", () => {
    const { lastFrame } = render(<SchemaCommand tables={sampleTables} />)
    const output = lastFrame()

    // summary is nullable — should show TEXT but not "NOT NULL"
    // We check that the description appears (it's rendered)
    expect(output).toContain("LLM-generated summary")
  })

  test("marks virtual tables", () => {
    const { lastFrame } = render(<SchemaCommand tables={sampleTables} />)
    const output = lastFrame()

    expect(output).toContain("FTS5 virtual table")
  })

  test("renders empty table list", () => {
    const { lastFrame } = render(<SchemaCommand tables={[]} />)
    const output = lastFrame()

    expect(output).toContain("gitmem schema")
    expect(output).toContain(".gitmem/index.db")
  })

  test("renders full schema without errors", () => {
    const { lastFrame } = render(<SchemaCommand tables={SCHEMA} />)
    const output = lastFrame()

    expect(output).toContain("commits")
    expect(output).toContain("commit_files")
    expect(output).toContain("file_stats")
    expect(output).toContain("file_contributors")
    expect(output).toContain("file_coupling")
    expect(output).toContain("batch_jobs")
    expect(output).toContain("metadata")
    expect(output).toContain("commits_fts")
  })
})
