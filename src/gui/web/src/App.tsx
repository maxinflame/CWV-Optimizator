import { useEffect, useState } from "react";
import {
  abortRun,
  fetchConfigs,
  fetchRun,
  openConfig,
  pickRepository,
  saveConfig,
  startRun,
  type RunView,
} from "./api.ts";
import { defaultForm, type GuiFormBody, type GuiPageBody } from "./draft.ts";
import { AgentSection } from "./sections/AgentSection.tsx";
import { ConfigSection } from "./sections/ConfigSection.tsx";
import { BrowserSection } from "./sections/BrowserSection.tsx";
import { MeasurementsSection } from "./sections/MeasurementsSection.tsx";
import { ObjectivesSection } from "./sections/ObjectivesSection.tsx";
import { PagesSection } from "./sections/PagesSection.tsx";
import { RunSection } from "./sections/RunSection.tsx";
import { ReportPage } from "./ReportPage.tsx";
import { StatusSection } from "./sections/StatusSection.tsx";
import { WebsiteSection } from "./sections/WebsiteSection.tsx";

export function App() {
  const [form, setForm] = useState<GuiFormBody>(defaultForm);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [configs, setConfigs] = useState<string[]>([]);
  const [chosenConfig, setChosenConfig] = useState("");
  const [configName, setConfigName] = useState("");
  const [configBusy, setConfigBusy] = useState(false);
  const [run, setRun] = useState<RunView | null>(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [page, setPage] = useState<"form" | "report">(
    window.location.hash === "#report" ? "report" : "form",
  );

  function openReport() {
    window.location.hash = "#report";
    setPage("report");
  }

  function openForm() {
    window.location.hash = "";
    setPage("form");
  }

  function patch(next: Partial<GuiFormBody>) {
    setForm((current) => ({ ...current, ...next }));
  }

  async function refreshRun() {
    const body = await fetchRun();
    setRun(body.run);
  }

  useEffect(() => {
    void refreshRun().catch(() => undefined);
    void fetchConfigs()
      .then((body) => setConfigs(body.configs))
      .catch(() => undefined);
    const onHash = () =>
      setPage(window.location.hash === "#report" ? "report" : "form");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (run?.status !== "running") return;
    const timer = window.setInterval(() => {
      void refreshRun().catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      );
    }, 1000);
    return () => window.clearInterval(timer);
  }, [run?.status]);

  async function onSaveConfig() {
    setConfigBusy(true);
    setError("");
    setNotice("");
    try {
      const saved = await saveConfig(configName, form);
      const body = await fetchConfigs();
      setConfigs(body.configs);
      setChosenConfig(saved.name);
      setConfigName(saved.name);
      setNotice(`Конфиг «${saved.name}» сохранён`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setConfigBusy(false);
    }
  }

  async function onOpenConfig() {
    setConfigBusy(true);
    setError("");
    setNotice("");
    try {
      const body = await openConfig(chosenConfig);
      setForm(body.form);
      setConfigName(chosenConfig);
      setNotice(`Открыт конфиг «${chosenConfig}»`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setConfigBusy(false);
    }
  }

  async function onPickRepository() {
    setPicking(true);
    setError("");
    try {
      const body = await pickRepository();
      if (body.path) patch({ workspacePath: body.path });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPicking(false);
    }
  }

  async function onStart() {
    setBusy(true);
    setError("");
    try {
      await startRun(form);
      await refreshRun();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function onAbort() {
    setError("");
    try {
      await abortRun();
      await refreshRun();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  return (
    <div className="shell">
      <header>
        <p className="eyebrow">Лабораторные замеры</p>
        <h1>CWV Optimizator</h1>
        <p>Запуск пайплайна и все настройки, которые он принимает.</p>
        <nav className="nav">
          <button
            type="button"
            className={page === "form" ? "primary" : "ghost"}
            onClick={openForm}
          >
            Настройки
          </button>
          <button
            type="button"
            className={page === "report" ? "primary" : "ghost"}
            data-testid="nav-report"
            onClick={openReport}
          >
            Отчёт
          </button>
        </nav>
      </header>
      {error ? (
        <p className="banner error" data-testid="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="banner ok" data-testid="form-notice">
          {notice}
        </p>
      ) : null}
      {page === "report" ? (
        <ReportPage run={run} />
      ) : (
        <div className="layout">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void onStart();
            }}
          >
            <ConfigSection
              configs={configs}
              chosen={chosenConfig}
              name={configName}
              busy={configBusy}
              onChoose={(name) => {
                setChosenConfig(name);
                if (name) setConfigName(name);
              }}
              onName={setConfigName}
              onOpen={() => void onOpenConfig()}
              onSave={() => void onSaveConfig()}
            />
            <RunSection
              form={form}
              picking={picking}
              onPickRepository={() => void onPickRepository()}
              onChange={patch}
            />
            <WebsiteSection form={form} onChange={patch} />
            <AgentSection form={form} onChange={patch} />
            <BrowserSection form={form} onChange={patch} />
            <PagesSection
              form={form}
              onChange={(pages: GuiPageBody[]) => patch({ pages })}
            />
            <MeasurementsSection form={form} onChange={patch} />
            <ObjectivesSection form={form} onChange={patch} />
          </form>
          <StatusSection
            run={run}
            busy={busy}
            onStart={() => void onStart()}
            onAbort={() => void onAbort()}
            onOpenReport={openReport}
          />
        </div>
      )}
    </div>
  );
}
