import { AggregateRepository } from "@db/aggregates"

/** Convenience wrapper that rebuilds all aggregate tables in one call. */
export class AggregatorService {
  private aggregates: AggregateRepository

  /** @param aggregates - The aggregate repository to rebuild. */
  constructor(aggregates: AggregateRepository) {
    this.aggregates = aggregates
  }

  /** Rebuilds file stats, contributors, and coupling tables from enriched commit data. */
  rebuild(): void {
    this.aggregates.rebuildFileStats()
    this.aggregates.rebuildFileContributors()
    this.aggregates.rebuildFileCoupling()
  }
}
