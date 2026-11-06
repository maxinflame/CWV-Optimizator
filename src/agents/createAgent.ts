import { CursorAgent } from "./cursor/index.js";
import type { CodingAgent, AgentSettings } from "./types.js";

export function createAgent(settings: AgentSettings): CodingAgent {
  switch (settings.provider) {
    case "cursor":
      return new CursorAgent();
    default:
      throw new Error(`Unsupported agent provider: ${settings.provider}`);
  }
}
