import type { GuiFormBody } from "./draft.ts";
import type { RunMode, RunStatus } from "../../activity.ts";
import type { PipelineProgress } from "../../../website/progress.ts";
import type { WebsiteReport } from "../../../website/report.ts";

export interface RunView {
  status: RunStatus;
  mode: RunMode;
  directory?: string;
  progress?: PipelineProgress;
  error?: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `Ошибка ${response.status}`);
  return body;
}

export function pickRepository(): Promise<{ path: string | null }> {
  return request("/api/repository", { method: "POST", body: "{}" });
}

export function startRun(form: GuiFormBody): Promise<{ ok: true }> {
  return request("/api/runs", {
    method: "POST",
    body: JSON.stringify({ form }),
  });
}

export function abortRun(): Promise<{ ok: true }> {
  return request("/api/runs/current/abort", { method: "POST", body: "{}" });
}

export function fetchRun(): Promise<{ run: RunView | null }> {
  return request("/api/runs/current");
}

export function fetchReport(): Promise<{ report: WebsiteReport | null }> {
  return request("/api/runs/current/report");
}

export function fetchConfigs(): Promise<{ configs: string[] }> {
  return request("/api/configs");
}

export function saveConfig(
  name: string,
  form: GuiFormBody,
): Promise<{ name: string }> {
  return request("/api/configs", {
    method: "POST",
    body: JSON.stringify({ name, form }),
  });
}

export function openConfig(name: string): Promise<{ form: GuiFormBody }> {
  return request("/api/configs/open", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}
