#!/usr/bin/env bun
import { checkCommand } from "@commands/check/command"
import { couplingCommand } from "@commands/coupling/command"
import { generateCommand } from "@commands/generate/command"
import { gitmemCommand } from "@commands/gitmem"
import { hotspotsCommand } from "@commands/hotspots/command"
import { indexCommand } from "@commands/index/command"
import { initCommand } from "@commands/init/command"
import { queryCommand } from "@commands/query/command"
import { schemaCommand } from "@commands/schema/command"
import { statsCommand } from "@commands/stats/command"
import { statusCommand } from "@commands/status/command"
import { trendsCommand } from "@commands/trends/command"
import { visualizeCommand } from "@commands/visualize/command"

gitmemCommand.addCommand(initCommand)
gitmemCommand.addCommand(indexCommand)
gitmemCommand.addCommand(statusCommand)
gitmemCommand.addCommand(queryCommand)
gitmemCommand.addCommand(checkCommand)
gitmemCommand.addCommand(hotspotsCommand)
gitmemCommand.addCommand(statsCommand)
gitmemCommand.addCommand(couplingCommand)
gitmemCommand.addCommand(trendsCommand)
gitmemCommand.addCommand(schemaCommand)
gitmemCommand.addCommand(visualizeCommand)
gitmemCommand.addCommand(generateCommand)

gitmemCommand.parse()
