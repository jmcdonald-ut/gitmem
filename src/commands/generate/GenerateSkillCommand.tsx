import React from "react"
import { Box, Text } from "ink"

interface GenerateSkillCommandProps {
  skillPath: string
}

export function GenerateSkillCommand({ skillPath }: GenerateSkillCommandProps) {
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
