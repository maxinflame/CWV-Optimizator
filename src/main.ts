import { errorMessage } from "./runtime/errors.js";
import { parseArgs, usage } from "./cli.js";
import { loadWebsiteCommandConfig } from "./website/cli.js";
import { executeWebsitePipeline } from "./website/pipeline.js";

const startedAt = new Date();
const controller = new AbortController();
const interrupt = () => controller.abort(new Error("Interrupted by user"));
process.on("SIGINT", interrupt);
process.on("SIGTERM", interrupt);
try {
  const command = parseArgs(process.argv.slice(2));
  if (command.type === "help") {
    console.log(usage);
  } else {
    const config = await loadWebsiteCommandConfig(command);
    const { directory, report } = await executeWebsitePipeline({
      root: process.cwd(),
      config,
      measureOnly: command.measureOnly,
      validateOnly: command.validateOnly,
      agentProvider: command.agent,
      signal: controller.signal,
      startedAt,
    });
    console.log(`${report.status}: ${directory}\n${report.stopReason ?? ""}`);
    if (report.status !== "completed")
      process.exitCode = report.status === "interrupted" ? 130 : 1;
  }
} catch (error) {
  console.error(errorMessage(error));
  process.exitCode = 1;
} finally {
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", interrupt);
}
