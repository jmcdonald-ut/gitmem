import { InvalidArgumentError } from "commander"

export function parsePositiveInt(value: string): number {
  const n = parseInt(value, 10)
  if (isNaN(n) || n < 1) {
    throw new InvalidArgumentError("must be a positive integer")
  }
  return n
}
