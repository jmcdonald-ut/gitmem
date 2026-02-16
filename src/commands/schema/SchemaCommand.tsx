import React from "react"
import { Box, Text } from "ink"
import type { SchemaTable } from "@/types"

/** Props for the SchemaCommand component. */
interface SchemaCommandProps {
  /** Schema tables to display. */
  tables: SchemaTable[]
}

/** Ink component that displays the database schema documentation. */
export function SchemaCommand({ tables }: SchemaCommandProps) {
  return (
    <Box flexDirection="column">
      <Text bold>gitmem schema</Text>
      <Text> </Text>
      <Text color="gray">
        Database: .gitmem/index.db (SQLite, WAL mode, FTS5)
      </Text>
      <Text> </Text>
      {tables.map((table, i) => (
        <Box key={table.name} flexDirection="column">
          {i > 0 && <Text> </Text>}
          <Text bold color="cyan">
            {table.name}
            {table.virtual ? " (FTS5 virtual table)" : ""}
          </Text>
          <Text color="gray">{table.description}</Text>
          {table.columns.map((col) => (
            <Box key={col.name} marginLeft={2}>
              <Text>
                <Text color="green">{col.name}</Text>
                <Text color="gray">
                  {" "}
                  {col.type}
                  {col.primary_key ? " PK" : ""}
                  {col.not_null ? " NOT NULL" : ""}
                </Text>
                <Text> — {col.description}</Text>
              </Text>
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  )
}
