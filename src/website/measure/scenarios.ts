import type { Page } from "playwright";
import type { InteractionStep, PageScenarioConfig, ScenarioKind } from "../config.js";

export async function runScenarioActions(
  page: Page,
  pageConfig: PageScenarioConfig,
  kind: ScenarioKind,
  observationMs: number,
): Promise<void> {
  switch (kind) {
    case "cold-load":
      await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
      await page.waitForTimeout(Math.min(observationMs, 2_000));
      return;
    case "scroll": {
      await page.waitForLoadState("domcontentloaded");
      const steps = 6;
      for (let index = 0; index < steps; index++) {
        await page.evaluate((ratio) => {
          window.scrollTo(0, document.body.scrollHeight * ratio);
        }, (index + 1) / steps);
        await page.waitForTimeout(Math.max(100, observationMs / steps));
      }
      await page.waitForTimeout(Math.min(observationMs, 1_000));
      return;
    }
    case "interaction": {
      await page.waitForLoadState("domcontentloaded");
      const steps = pageConfig.interaction ?? [];
      if (!steps.length)
        throw new Error(
          `Page ${pageConfig.id} interaction scenario requires interaction steps`,
        );
      for (const step of steps) await performStep(page, step);
      await page.waitForTimeout(Math.min(observationMs, 1_500));
      return;
    }
    default:
      throw new Error(`Unknown scenario kind: ${String(kind)}`);
  }
}

async function performStep(page: Page, step: InteractionStep): Promise<void> {
  const timeout = step.timeoutMs ?? 10_000;
  switch (step.action) {
    case "waitForSelector":
      if (!step.selector) throw new Error("waitForSelector requires selector");
      await page.waitForSelector(step.selector, { timeout });
      return;
    case "click":
      if (!step.selector) throw new Error("click requires selector");
      await page.click(step.selector, { timeout });
      return;
    case "type":
      if (!step.selector || step.text === undefined)
        throw new Error("type requires selector and text");
      await page.fill(step.selector, step.text, { timeout });
      return;
    case "press":
      if (!step.key) throw new Error("press requires key");
      await page.keyboard.press(step.key);
      return;
    case "hover":
      if (!step.selector) throw new Error("hover requires selector");
      await page.hover(step.selector, { timeout });
      return;
    default:
      throw new Error(`Unknown interaction action: ${String((step as InteractionStep).action)}`);
  }
}
