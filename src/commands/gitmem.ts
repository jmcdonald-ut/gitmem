import { Command } from "@commander-js/extra-typings"

const HELP_TEXT = `
Getting started:
  1. Initialize gitmem:              gitmem init
  2. Export your Anthropic API key:  export ANTHROPIC_API_KEY=sk-ant-...
  3. Run the indexer:                gitmem index
  4. Search your history:            gitmem query "auth bug"

Global options --format json and --json work with every command.
Run gitmem schema for database table documentation.`

const gitmemCommand = new Command()
  .name("gitmem")
  .description("AI-powered git history index")
  .version("0.1.0")
  .option("--format <format>", "Output format (text or json)", "text")
  .option("--json", "Shorthand for --format json")
  .addHelpText("after", HELP_TEXT)

type GitmemCommandOpts = ReturnType<(typeof gitmemCommand)["opts"]>

export { gitmemCommand, type GitmemCommandOpts }
