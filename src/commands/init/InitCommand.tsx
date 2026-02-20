import React from "react"
import { Box, Text } from "ink"
import type { GitmemConfig } from "@/config"

interface InitCommandProps {
  config: GitmemConfig
}

export function InitCommand({ config }: InitCommandProps) {
  let aiDisplay: string
  if (config.ai === false) aiDisplay = "disabled"
  else if (config.ai === true) aiDisplay = "enabled"
  else aiDisplay = `enabled for commits after ${config.ai}`

  return (
    <Box flexDirection="column">
      <Text bold color="green">
        Initialized gitmem
      </Text>
      <Text> </Text>
      <Text> AI: {aiDisplay}</Text>
      <Text> Index start date: {config.indexStartDate ?? "all history"}</Text>
      <Text> Index model: {config.indexModel}</Text>
      <Text> Check model: {config.checkModel}</Text>
      <Text> </Text>
      <Text color="gray">
        Run `gitmem index` to analyze your commit history.
      </Text>
    </Box>
  )
}
