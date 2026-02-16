import { Database } from "bun:sqlite"

/** Database row representation of a batch job. */
export interface BatchJobRow {
  batch_id: string
  status: string
  request_count: number
  succeeded_count: number
  failed_count: number
  submitted_at: string
  completed_at: string | null
  model_used: string
}

/** Repository for managing batch job records in the SQLite database. */
export class BatchJobRepository {
  private db: Database

  constructor(db: Database) {
    this.db = db
  }

  /** Inserts a new batch job record. */
  insert(batchId: string, requestCount: number, modelUsed: string): void {
    this.db
      .prepare(
        `INSERT INTO batch_jobs (batch_id, status, request_count, submitted_at, model_used)
         VALUES (?, 'submitted', ?, ?, ?)`,
      )
      .run(batchId, requestCount, new Date().toISOString(), modelUsed)
  }

  /** Updates the status and counts for a batch job. */
  updateStatus(
    batchId: string,
    status: string,
    succeededCount: number,
    failedCount: number,
  ): void {
    const completedAt = status === "ended" ? new Date().toISOString() : null
    this.db
      .prepare(
        `UPDATE batch_jobs SET status = ?, succeeded_count = ?, failed_count = ?, completed_at = ?
         WHERE batch_id = ?`,
      )
      .run(status, succeededCount, failedCount, completedAt, batchId)
  }

  /** Returns the most recent pending (non-ended) batch job, or null. */
  getPendingBatch(): BatchJobRow | null {
    return (
      this.db
        .query<
          BatchJobRow,
          []
        >("SELECT * FROM batch_jobs WHERE status != 'ended' AND status != 'failed' ORDER BY submitted_at DESC LIMIT 1")
        .get() ?? null
    )
  }

  /** Returns a batch job by its ID, or null if not found. */
  get(batchId: string): BatchJobRow | null {
    return (
      this.db
        .query<
          BatchJobRow,
          [string]
        >("SELECT * FROM batch_jobs WHERE batch_id = ?")
        .get(batchId) ?? null
    )
  }

  /** Returns all batch jobs ordered by submission time descending. */
  getAll(): BatchJobRow[] {
    return this.db
      .query<
        BatchJobRow,
        []
      >("SELECT * FROM batch_jobs ORDER BY submitted_at DESC")
      .all()
  }
}
