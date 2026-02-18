#!/usr/bin/env bun
import { Command } from "commander"
import { indexCommand } from "@commands/index/command"
import { statusCommand } from "@commands/status/command"
import { queryCommand } from "@commands/query/command"
import { checkCommand } from "@commands/check/command"
import { hotspotsCommand } from "@commands/hotspots/command"
import { statsCommand } from "@commands/stats/command"
import { couplingCommand } from "@commands/coupling/command"
import { trendsCommand } from "@commands/trends/command"
import { schemaCommand } from "@commands/schema/command"
import { visualizeCommand } from "@commands/visualize/command"

const HELP_TEXT = `
Getting started:
  1. Export your Anthropic API key:  export ANTHROPIC_API_KEY=sk-ant-...
  2. Run the indexer:                gitmem index
  3. Search your history:            gitmem query "auth bug"

Global options --format json and --json work with every command.
Run gitmem schema for database table documentation.`

const program = new Command()
  .name("gitmem")
  .description("AI-powered git history index")
  .version("0.1.0")
  .option("--format <format>", "Output format (text or json)", "text")
  .option("--json", "Shorthand for --format json")
  .addHelpText("after", HELP_TEXT)

program.addCommand(indexCommand)
program.addCommand(statusCommand)
program.addCommand(queryCommand)
program.addCommand(checkCommand)
program.addCommand(hotspotsCommand)
program.addCommand(statsCommand)
program.addCommand(couplingCommand)
program.addCommand(trendsCommand)
program.addCommand(schemaCommand)
program.addCommand(visualizeCommand)

program.parse()
