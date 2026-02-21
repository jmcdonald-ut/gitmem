import { Box, Text } from "ink"
import React from "react"

interface GenerateSkillCommandProps {
  skillPath: string
  error?: string
}

export function GenerateSkillCommand({
  error,
  skillPath,
}: GenerateSkillCommandProps) {
  if (error) {
    return (
      <Box flexDirection="column">
        <Text>
          <Text color="red">Create failed</Text> {skillPath}
        </Text>
        <Text> </Text>
        <Text>{error}</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      <Text>
        <Text color="green">Created</Text> {skillPath}
      </Text>
      <Text> </Text>
      <Text color="gray">
        Claude Code will now discover gitmem commands via this skill.
      </Text>
    </Box>
  )
}
