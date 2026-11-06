import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createAgent } from "../agents/createAgent.js";
import { Budget } from "../runtime/budget.js";
import { errorMessage } from "../runtime/errors.js";
import {
  compareCandidate,
  quickReject,
  selectBottleneck,
  type Bottleneck,
} from "./acceptance.js";
import type { WebsiteConfig } from "./config.js";
import { scenarioKeys, usesExternalServer } from "./config.js";
import { GitWorkspace, type GitState } from "./git.js";
import { withProjectLock } from "./lock.js";
import { WebsiteBenchmarkRunner, aggregateSamples } from "./measure/runner.js";
import type { ScenarioAggregate } from "./measure/types.js";
import { runLighthouseAudit } from "./lighthouse.js";
import {
  createWebsitePrompt,
  readWebsiteHypothesis,
  websiteResponseSchema,
  type WebsiteAttemptSummary,
} from "./prompt.js";
import {
  createWebsiteReport,
  saveWebsiteReport,
  type WebsiteAttemptRecord,
  type WebsiteReport,
} from "./report.js";
import { scenarioPhrase, type PipelineProgress } from "./progress.js";
import { ProductionServer } from "./server.js";
import {
  assertFingerprintsUnchanged,
  fingerprintProtectedPaths,
  runProjectTests,
  smokeTest,
} from "./verify.js";

/** Minimum remaining time before starting another agent iteration (agent+verify+quick+confirm). */
export const MIN_REMAINING_MS_FOR_ITERATION = 20 * 60_000;
/** Minimum remaining time before starting confirmation batches. */
export const MIN_REMAINING_MS_FOR_CONFIRM = 12 * 60_000;

export interface WebsitePipelineOptions {
  root: string;
  config: WebsiteConfig;
  measureOnly?: boolean;
  validateOnly?: boolean;
  agentProvider?: string;
  signal: AbortSignal;
  startedAt?: Date;
  /** Каталог прогона известен до окончания пайплайна, чтобы GUI читал report.json. */
  onRunDirectory?: (directory: string) => void;
  /** Текущий шаг для интерфейса. Не заменяет report.json. */
  onProgress?: (progress: PipelineProgress) => void;
}

async function measureAll(
  runner: WebsiteBenchmarkRunner,
  keys: string[],
  repeats: number,
  label: string,
  onSample?: (scenario: string, index: number, total: number) => void,
): Promise<ScenarioAggregate[]> {
  const results: ScenarioAggregate[] = [];
  for (const key of keys) {
    results.push(
      await runner.measureBatch(key, repeats, label, (index, total) =>
        onSample?.(key, index, total),
      ),
    );
  }
  return results;
}

export async function validateWebsitePrerequisites(
  config: WebsiteConfig,
  root: string,
  onProgress?: (progress: PipelineProgress) => void,
): Promise<string[]> {
  const notes: string[] = [];
  const projectPath = resolve(config.workspace.path);
  const external = usesExternalServer(config);
  const git = new GitWorkspace(
    projectPath,
    join(root, "runs", "website", "validate"),
  );
  onProgress?.({ phase: "repository" });
  await git.assertRepository();
  if (external) {
    notes.push(
      `Git repository at ${projectPath} (clean tree not required for external URL)`,
    );
  } else {
    onProgress?.({ phase: "clean-tree" });
    await git.assertClean();
    notes.push(`Git repository clean at ${projectPath}`);
  }

  // До build/health: без рабочего агента --validate не должен проходить «успешно».
  onProgress?.({ phase: "agent-ready" });
  const agent = createAgent(config.agent);
  notes.push(`Agent: ${await agent.assertReady()}`);

  const server = new ProductionServer(
    config,
    projectPath,
    join(root, "runs", "website", "validate", "logs"),
  );
  const controller = new AbortController();
  try {
    if (external) {
      if (config.website.buildCommand) {
        onProgress?.({ phase: "build" });
        await server.build(controller.signal);
        notes.push("External rebuild (buildCommand) succeeded");
      }
      onProgress?.({ phase: "health" });
      await server.waitUntilHealthy(controller.signal);
      notes.push(`External server reachable at ${server.baseUrl}`);
    } else {
      onProgress?.({ phase: "build" });
      await server.build(controller.signal);
      notes.push("Production build succeeded");
      onProgress?.({ phase: "server" });
      await server.start(controller.signal);
      notes.push(`Production server ready at ${server.baseUrl}`);
    }
  } finally {
    await server.stop();
  }
  return notes;
}

export async function executeWebsitePipeline(
  options: WebsitePipelineOptions,
): Promise<{ directory: string; report: WebsiteReport }> {
  const startedAt = options.startedAt ?? new Date();
  const projectPath = resolve(options.config.workspace.path);
  const config = structuredClone(options.config);
  if (options.agentProvider) config.agent.provider = options.agentProvider;

  const runId = `${startedAt.toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const directory = join(options.root, "runs", "website", runId);
  await mkdir(directory, { recursive: true });
  options.onRunDirectory?.(directory);

  const report = createWebsiteReport(config, startedAt);
  await saveWebsiteReport(directory, report);

  return withProjectLock(projectPath, directory, async () => {
    const budget = new Budget(
      startedAt.toISOString(),
      config.budgets.maxDurationMinutes,
      options.signal,
    );
    const external = usesExternalServer(config);
    const git = new GitWorkspace(projectPath, directory);
    const server = new ProductionServer(
      config,
      projectPath,
      join(directory, "logs"),
    );
    const runner = new WebsiteBenchmarkRunner(
      config,
      server.baseUrl,
      join(directory, "measurements"),
    );
    const keys = scenarioKeys(config);
    let state: GitState | undefined;
    const tell = (progress: PipelineProgress) => options.onProgress?.(progress);
    const watchMeasure =
      (context: {
        measureKind: PipelineProgress["measureKind"];
        role?: PipelineProgress["role"];
        iteration?: number;
      }) =>
      (scenario: string, index: number, total: number) => {
        const phrase = scenarioPhrase(config, scenario);
        tell({
          phase: "measure",
          index,
          total,
          pagePath: phrase.pagePath,
          scenario: phrase.scenario,
          measureKind: context.measureKind,
          role: context.role,
          iteration: context.iteration,
          iterationTotal: context.iteration
            ? config.budgets.maxIterations
            : undefined,
        });
      };

    try {
      if (options.validateOnly) {
        const notes = await validateWebsitePrerequisites(
          config,
          options.root,
          tell,
        );
        report.status = "completed";
        report.stopReason = `Validation OK:\n${notes.join("\n")}`;
        report.finishedAt = new Date().toISOString();
        await saveWebsiteReport(directory, report);
        return { directory, report };
      }

      tell({ phase: "repository" });
      await git.assertRepository();
      // measure-only против внешнего URL не мутирует дерево — dirty OK.
      // Оптимизация (в т.ч. Docker/external) требует чистый tree для Git safety.
      if (!(external && options.measureOnly)) {
        tell({ phase: "clean-tree" });
        await git.assertClean();
      }

      if (options.measureOnly) {
        state = {
          projectPath,
          originalBranch: await git.currentBranch(),
          originalCommit: await git.currentCommit(),
          optimizationBranch: await git.currentBranch(),
          baselineCommit: await git.currentCommit(),
          acceptedCommit: await git.currentCommit(),
        };
        report.git = state;
        if (external) {
          report.limitations.push(
            config.website.buildCommand
              ? `External URL mode at ${server.baseUrl}: pipeline runs buildCommand and health-check, but does not start/stop the server process.`
              : `External URL mode at ${server.baseUrl}: pipeline only health-checks; it does not start/stop the server process.`,
          );
        }
        tell({
          phase: external && !config.website.buildCommand ? "health" : "build",
        });
        await budget.within(() =>
          external && !config.website.buildCommand
            ? server.waitUntilHealthy(budget.signal)
            : server.ensureReady(budget.signal),
        );
        tell({ phase: "browser" });
        await runner.open();
        report.baseline = await measureAll(
          runner,
          keys,
          config.measurements.baselineRepeats,
          "baseline",
          watchMeasure({ measureKind: "baseline" }),
        );
        report.bottleneck = selectBottleneck(report.baseline, config);
        if (config.pages[0]) {
          tell({ phase: "lighthouse", label: "baseline" });
          report.lighthouse = {
            baseline: await runLighthouseAudit({
              config,
              url: new URL(config.pages[0].path, `${server.baseUrl}/`).href,
              artifactDirectory: join(directory, "lighthouse"),
              label: "baseline",
            }),
          };
        }
        report.status = "completed";
        report.stopReason = external
          ? `Measurement-only run completed against external URL ${server.baseUrl}`
          : "Measurement-only run completed";
        report.finishedAt = new Date().toISOString();
        await saveWebsiteReport(directory, report);
        return { directory, report };
      }

      tell({ phase: "branch" });
      state = await git.startOptimization();
      report.git = state;
      report.bestCommit = state.acceptedCommit;
      if (external) {
        report.limitations.push(
          `External URL optimization at ${server.baseUrl}: after each checkout the pipeline runs buildCommand (if set) and health-check; Docker/OSPanel stack is not restarted.`,
        );
      }
      await saveWebsiteReport(directory, report);

      const protectedFingerprints = await fingerprintProtectedPaths(
        options.root,
        ["src/website", "package.json"],
      );

      tell({
        phase: external && !config.website.buildCommand ? "health" : "build",
      });
      await budget.within(() => server.ensureReady(budget.signal));
      tell({ phase: "browser" });
      await runner.open();
      report.baseline = await measureAll(
        runner,
        keys,
        config.measurements.baselineRepeats,
        "baseline",
        watchMeasure({ measureKind: "baseline" }),
      );
      let current = report.baseline;
      report.bottleneck = selectBottleneck(current, config);
      if (config.pages[0]) {
        tell({ phase: "lighthouse", label: "baseline" });
        report.lighthouse = {
          baseline: await runLighthouseAudit({
            config,
            url: new URL(config.pages[0].path, `${server.baseUrl}/`).href,
            artifactDirectory: join(directory, "lighthouse"),
            label: "baseline",
          }),
        };
      }
      await saveWebsiteReport(directory, report);

      const agent = createAgent(config.agent);
      tell({ phase: "agent-ready" });
      await agent.version();

      for (let index = 1; index <= config.budgets.maxIterations; index++) {
        budget.check();
        if (budget.remainingMs() < MIN_REMAINING_MS_FOR_ITERATION) {
          report.stopReason =
            "Insufficient time for another iteration (need ~20 minutes remaining)";
          break;
        }
        const bottleneck =
          selectBottleneck(current, config) ??
          ({
            metric: "lcpMs",
            scenario: keys[0]!,
            median: current[0]?.medians.lcpMs ?? 0,
            threshold: 2500,
            excessRatio: 1,
          } satisfies Bottleneck);
        report.bottleneck = bottleneck;

        const attempt: WebsiteAttemptRecord = {
          id: `iteration-${String(index).padStart(3, "0")}`,
          startedAt: new Date().toISOString(),
          status: "running",
          stage: "agent",
          targetMetric: bottleneck.metric,
          targetScenario: bottleneck.scenario,
          targetPage: bottleneck.scenario.split(":")[0],
          errors: [],
        };
        report.attempts.push(attempt);
        await saveWebsiteReport(directory, report);

        try {
          await git.ensureOnOptimizationBranch(state);
          await git.restoreAccepted(state);

          const history: WebsiteAttemptSummary[] = report.attempts
            .filter((item) => item.id !== attempt.id)
            .map((item) => ({
              id: item.id,
              status: item.status,
              hypothesis: item.hypothesis,
              targetMetric: item.targetMetric,
              scenario: item.targetScenario,
              decisionReasons: [
                ...(item.decision?.reasons ?? []),
                ...item.errors,
              ],
              filesModified: item.filesModified,
              improvementPercent: item.decision?.improvementPercent ?? null,
              referenceMedian: item.decision?.referenceMedian ?? null,
              candidateMedian: item.decision?.candidateMedian ?? null,
              regressions: item.decision?.regressions,
            }));

          const phrase = scenarioPhrase(config, bottleneck.scenario);
          tell({
            phase: "agent",
            iteration: index,
            iterationTotal: config.budgets.maxIterations,
            model: config.agent.model,
            metric: bottleneck.metric,
            pagePath: phrase.pagePath,
            scenario: phrase.scenario,
          });
          const response = await budget.within(() =>
            agent.run({
              cwd: projectPath,
              outputDirectory: join(directory, attempt.id, "agent"),
              settings: config.agent,
              prompt: createWebsitePrompt({
                config,
                bottleneck,
                aggregates: current,
                history,
              }),
              responseSchema: websiteResponseSchema,
              signal: budget.signal,
              tools: [],
            }),
          );
          attempt.hypothesis = readWebsiteHypothesis(response);
          attempt.agentSummary =
            typeof response === "object"
              ? JSON.stringify(response).slice(0, 4000)
              : String(response);
          await saveWebsiteReport(directory, report);

          attempt.stage = "commit";
          tell({
            phase: "commit",
            iteration: index,
            iterationTotal: config.budgets.maxIterations,
          });
          const candidateCommit = await git.commitCandidate(
            `cwv: ${attempt.hypothesis.slice(0, 72)}`,
            state,
          );
          attempt.gitRevision = candidateCommit;
          attempt.filesModified = await git.changedFiles(
            state.acceptedCommit,
            candidateCommit,
          );

          attempt.stage = "verify";
          tell({
            phase: "verify",
            iteration: index,
            iterationTotal: config.budgets.maxIterations,
          });
          await budget.within(() => server.rebuildAndStart(budget.signal));
          attempt.buildOk = true;
          tell({
            phase: "tests",
            iteration: index,
            iterationTotal: config.budgets.maxIterations,
          });
          await runProjectTests(config, projectPath, budget.signal);
          attempt.testsOk = true;
          tell({
            phase: "smoke",
            iteration: index,
            iterationTotal: config.budgets.maxIterations,
          });
          await smokeTest(config, server, join(directory, attempt.id, "smoke"));
          attempt.smokeOk = true;

          attempt.stage = "quick-measure";
          const quick = await measureAll(
            runner,
            [bottleneck.scenario],
            config.measurements.quickRepeats,
            `${attempt.id}-quick`,
            watchMeasure({ measureKind: "quick", iteration: index }),
          );
          attempt.quick = quick;
          const rejectedQuick = quickReject(
            config,
            bottleneck.metric,
            current.find((item) => item.scenario === bottleneck.scenario) ??
              current[0]!,
            quick[0]!,
          );
          if (rejectedQuick.reject) {
            attempt.status = "rejected";
            attempt.decision = {
              accepted: false,
              inconclusive: false,
              reasons: [rejectedQuick.reason ?? "Quick reject"],
              targetMetric: bottleneck.metric,
              scenario: bottleneck.scenario,
              referenceMedian:
                current.find((item) => item.scenario === bottleneck.scenario)
                  ?.medians[bottleneck.metric] ?? null,
              candidateMedian: quick[0]?.medians[bottleneck.metric] ?? null,
              improvementPercent: null,
              regressions: [],
            };
            await git.discardCandidate(state);
            attempt.finishedAt = new Date().toISOString();
            await saveWebsiteReport(directory, report);
            continue;
          }

          attempt.stage = "confirm";
          if (budget.remainingMs() < MIN_REMAINING_MS_FOR_CONFIRM) {
            attempt.status = "interrupted";
            attempt.errors.push(
              "Insufficient time for confirm (need ~12 minutes remaining)",
            );
            await git.discardCandidate(state);
            report.stopReason =
              "Insufficient time for confirm (need ~12 minutes remaining)";
            attempt.finishedAt = new Date().toISOString();
            await saveWebsiteReport(directory, report);
            break;
          }
          const order: Array<{
            role: "candidate" | "reference";
            repeats: number;
            commit: string;
          }> = [];
          const candidateSamples: ScenarioAggregate[] = [];
          const referenceSamples: ScenarioAggregate[] = [];

          for (const batch of config.measurements.confirmationBatches) {
            budget.check();
            const commit =
              batch.role === "candidate"
                ? candidateCommit
                : state.acceptedCommit;
            tell({
              phase: "checkout",
              role: batch.role,
              iteration: index,
              iterationTotal: config.budgets.maxIterations,
            });
            await server.stop();
            await runner.close();
            await git.checkoutCommit(commit);
            tell({
              phase: "build",
              iteration: index,
              iterationTotal: config.budgets.maxIterations,
            });
            await server.rebuildAndStart(budget.signal);
            await runner.open();
            const measured = await measureAll(
              runner,
              [bottleneck.scenario],
              batch.repeats,
              `${attempt.id}-${batch.role}-${order.length + 1}`,
              watchMeasure({
                measureKind: "confirm",
                role: batch.role,
                iteration: index,
              }),
            );
            order.push({ ...batch, commit });
            if (batch.role === "candidate") candidateSamples.push(...measured);
            else referenceSamples.push(...measured);
          }

          const candidateAgg = aggregateSamples(
            bottleneck.scenario,
            candidateSamples.flatMap((item) => item.samples),
          );
          const referenceAgg = aggregateSamples(
            bottleneck.scenario,
            referenceSamples.flatMap((item) => item.samples),
          );

          attempt.confirmation = {
            order,
            candidate: [candidateAgg],
            reference: [referenceAgg],
          };

          const decision = compareCandidate({
            config,
            targetMetric: bottleneck.metric,
            scenario: bottleneck.scenario,
            reference: referenceAgg,
            candidate: candidateAgg,
            allReference: [referenceAgg],
            allCandidate: [candidateAgg],
          });
          attempt.decision = decision;

          if (decision.accepted) {
            await git.acceptCandidate(state);
            attempt.status = "accepted";
            report.bestCommit = state.acceptedCommit;
            // Refresh current measurements for accepted scenario
            current = current.map((item) =>
              item.scenario === bottleneck.scenario ? candidateAgg : item,
            );
          } else {
            attempt.status = decision.inconclusive
              ? "inconclusive"
              : "rejected";
            await git.discardCandidate(state);
            await server.stop();
            await runner.close();
            await git.ensureOnOptimizationBranch(state);
            await server.rebuildAndStart(budget.signal);
            await runner.open();
          }

          assertFingerprintsUnchanged(
            protectedFingerprints,
            await fingerprintProtectedPaths(options.root, [
              "src/website",
              "package.json",
            ]),
            "Pipeline internals",
          );
        } catch (error) {
          attempt.status = budget.interrupted ? "interrupted" : "failed";
          attempt.errors.push(errorMessage(error));
          try {
            if (state) await git.discardCandidate(state);
          } catch (restoreError) {
            attempt.errors.push(
              `Restore failed: ${errorMessage(restoreError)}`,
            );
          }
          if (budget.interrupted) throw error;
        } finally {
          attempt.finishedAt = new Date().toISOString();
          await saveWebsiteReport(directory, report);
        }

        if (budget.interrupted) break;
      }

      if (config.pages[0] && state) {
        await server.stop();
        await runner.close();
        await git.ensureOnOptimizationBranch(state);
        tell({ phase: "build" });
        await server.rebuildAndStart(budget.signal);
        await runner.open();
        tell({ phase: "lighthouse", label: "final" });
        report.lighthouse = {
          ...report.lighthouse,
          final: await runLighthouseAudit({
            config,
            url: new URL(config.pages[0].path, `${server.baseUrl}/`).href,
            artifactDirectory: join(directory, "lighthouse"),
            label: "final",
          }),
        };
      }

      const stoppedForTime =
        typeof report.stopReason === "string" &&
        report.stopReason.startsWith("Insufficient time");
      report.status =
        budget.interrupted || stoppedForTime ? "interrupted" : "completed";
      if (!report.stopReason) {
        report.stopReason = budget.interrupted
          ? "Interrupted"
          : "Iteration or time budget finished";
      }
      report.finishedAt = new Date().toISOString();
      await saveWebsiteReport(directory, report);
      await writeFile(
        join(directory, "final-state.json"),
        `${JSON.stringify({ git: state, bestCommit: report.bestCommit }, null, 2)}\n`,
      );
      return { directory, report };
    } catch (error) {
      report.status = options.signal.aborted ? "interrupted" : "failed";
      report.stopReason = errorMessage(error);
      report.finishedAt = new Date().toISOString();
      await saveWebsiteReport(directory, report);
      throw error;
    } finally {
      await runner.close().catch(() => undefined);
      await server.stop().catch(() => undefined);
    }
  });
}
