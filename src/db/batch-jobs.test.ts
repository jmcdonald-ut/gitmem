import { Database } from "bun:sqlite"
import { beforeEach, describe, expect, test } from "bun:test"

import { BatchJobRepository } from "@db/batch-jobs"
import { createDatabase } from "@db/database"

describe("BatchJobRepository", () => {
  let db: Database
  let repo: BatchJobRepository

  beforeEach(() => {
    db = createDatabase(":memory:")
    repo = new BatchJobRepository(db)
  })

  test("insert creates a batch job record", () => {
    repo.insert("batch_001", 50, "claude-haiku-4-5-20251001")

    const row = repo.get("batch_001")
    expect(row).not.toBeNull()
    expect(row!.batch_id).toBe("batch_001")
    expect(row!.status).toBe("submitted")
    expect(row!.request_count).toBe(50)
    expect(row!.succeeded_count).toBe(0)
    expect(row!.failed_count).toBe(0)
    expect(row!.model_used).toBe("claude-haiku-4-5-20251001")
    expect(row!.submitted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(row!.completed_at).toBeNull()
  })

  test("updateStatus updates counts and status", () => {
    repo.insert("batch_002", 100, "claude-haiku-4-5-20251001")
    repo.updateStatus("batch_002", "in_progress", 30, 2)

    const row = repo.get("batch_002")
    expect(row!.status).toBe("in_progress")
    expect(row!.succeeded_count).toBe(30)
    expect(row!.failed_count).toBe(2)
    expect(row!.completed_at).toBeNull()
  })

  test("updateStatus sets completed_at when ended", () => {
    repo.insert("batch_003", 50, "claude-haiku-4-5-20251001")
    repo.updateStatus("batch_003", "ended", 48, 2)

    const row = repo.get("batch_003")
    expect(row!.status).toBe("ended")
    expect(row!.completed_at).not.toBeNull()
  })

  test("getPendingBatch returns active batch", () => {
    repo.insert("batch_004", 10, "claude-haiku-4-5-20251001")

    const pending = repo.getPendingBatch()
    expect(pending).not.toBeNull()
    expect(pending!.batch_id).toBe("batch_004")
  })

  test("getPendingBatch returns null when all ended", () => {
    repo.insert("batch_005", 10, "claude-haiku-4-5-20251001")
    repo.updateStatus("batch_005", "ended", 10, 0)

    expect(repo.getPendingBatch()).toBeNull()
  })

  test("getPendingBatch returns null when all failed", () => {
    repo.insert("batch_006", 10, "claude-haiku-4-5-20251001")
    repo.updateStatus("batch_006", "failed", 0, 10)

    expect(repo.getPendingBatch()).toBeNull()
  })

  test("get returns null for non-existent batch", () => {
    expect(repo.get("nonexistent")).toBeNull()
  })

  test("getAll returns all batch jobs", () => {
    repo.insert("batch_a", 10, "claude-haiku-4-5-20251001")
    repo.insert("batch_b", 20, "claude-haiku-4-5-20251001")

    const all = repo.getAll()
    expect(all).toHaveLength(2)
  })

  test("getAll returns empty array when no batches", () => {
    expect(repo.getAll()).toEqual([])
  })

  test("insert stores type field defaulting to index", () => {
    repo.insert("batch_typed", 10, "claude-haiku-4-5-20251001")

    const row = repo.get("batch_typed")
    expect(row!.type).toBe("index")
  })

  test("insert stores custom type field", () => {
    repo.insert("batch_check", 5, "claude-sonnet-4-5-20250929", "check")

    const row = repo.get("batch_check")
    expect(row!.type).toBe("check")
  })

  test("getPendingBatchByType filters by type", () => {
    repo.insert("batch_idx", 10, "claude-haiku-4-5-20251001", "index")
    repo.insert("batch_chk", 5, "claude-sonnet-4-5-20250929", "check")

    const indexBatch = repo.getPendingBatchByType("index")
    expect(indexBatch).not.toBeNull()
    expect(indexBatch!.batch_id).toBe("batch_idx")

    const checkBatch = repo.getPendingBatchByType("check")
    expect(checkBatch).not.toBeNull()
    expect(checkBatch!.batch_id).toBe("batch_chk")
  })

  test("getPendingBatchByType returns null when no pending of that type", () => {
    repo.insert("batch_idx", 10, "claude-haiku-4-5-20251001", "index")
    repo.updateStatus("batch_idx", "ended", 10, 0)

    expect(repo.getPendingBatchByType("index")).toBeNull()
    expect(repo.getPendingBatchByType("check")).toBeNull()
  })

  test("getPendingBatchByType ignores batches of other types", () => {
    repo.insert("batch_idx", 10, "claude-haiku-4-5-20251001", "index")

    expect(repo.getPendingBatchByType("check")).toBeNull()
    expect(repo.getPendingBatchByType("index")).not.toBeNull()
  })

  test("insertCheckBatchItems and getCheckBatchItems round-trip", () => {
    repo.insert("batch_chk", 2, "claude-sonnet-4-5-20250929", "check")
    repo.insertCheckBatchItems([
      {
        batchId: "batch_chk",
        hash: "aaa",
        classification: "feature",
        summary: "Added feature",
      },
      {
        batchId: "batch_chk",
        hash: "bbb",
        classification: "bug-fix",
        summary: "Fixed bug",
      },
    ])

    const items = repo.getCheckBatchItems("batch_chk")
    expect(items).toHaveLength(2)
    expect(items[0].hash).toBe("aaa")
    expect(items[0].classification).toBe("feature")
    expect(items[0].summary).toBe("Added feature")
    expect(items[1].hash).toBe("bbb")
    expect(items[1].classification).toBe("bug-fix")
  })

  test("getCheckBatchItems returns empty for nonexistent batch", () => {
    expect(repo.getCheckBatchItems("nonexistent")).toEqual([])
  })
})
