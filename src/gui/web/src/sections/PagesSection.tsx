import { CheckField, SelectField, TextField } from "../components/Fields.tsx";
import {
  actionLabels,
  emptyPage,
  emptyStep,
  scenarioLabels,
  type GuiFormBody,
  type GuiInteractionBody,
  type GuiPageBody,
} from "../draft.ts";

const scenarios = ["cold-load", "scroll", "interaction"] as const;

export function PagesSection(props: {
  form: GuiFormBody;
  onChange: (pages: GuiPageBody[]) => void;
}) {
  const pages = props.form.pages;
  function update(index: number, patch: Partial<GuiPageBody>) {
    props.onChange(
      pages.map((page, pageIndex) =>
        pageIndex === index ? { ...page, ...patch } : page,
      ),
    );
  }
  function updateStep(
    pageIndex: number,
    stepIndex: number,
    patch: Partial<GuiInteractionBody>,
  ) {
    const page = pages[pageIndex];
    if (!page) return;
    update(pageIndex, {
      interaction: page.interaction.map((step, index) =>
        index === stepIndex ? { ...step, ...patch } : step,
      ),
    });
  }

  return (
    <section className="card">
      <h2>Страницы</h2>
      {pages.map((page, index) => (
        <article className="subcard" key={index}>
          <div className="row-title">
            <h3>Страница {index + 1}</h3>
            <button
              type="button"
              className="ghost"
              onClick={() =>
                props.onChange(
                  pages.filter((_, pageIndex) => pageIndex !== index),
                )
              }
              disabled={pages.length === 1}
            >
              Удалить
            </button>
          </div>
          <div className="grid">
            <TextField
              label="Идентификатор"
              required
              testId={index === 0 ? "page-id" : undefined}
              value={page.id}
              onChange={(id) => update(index, { id })}
            />
            <TextField
              label="Путь"
              required
              value={page.path}
              onChange={(path) => update(index, { path })}
            />
          </div>
          <div className="checks">
            {scenarios.map((scenario) => (
              <CheckField
                key={scenario}
                label={scenarioLabels[scenario]}
                checked={page.scenarios.includes(scenario)}
                onChange={(checked) => {
                  const next = checked
                    ? [...page.scenarios, scenario]
                    : page.scenarios.filter((item) => item !== scenario);
                  update(index, { scenarios: next });
                }}
              />
            ))}
          </div>
          <label className="field">
            <span className="field-label">
              Критичные селекторы
              <em className="optional">по одному в строке</em>
            </span>
            <textarea
              value={page.criticalSelectors.join("\n")}
              onChange={(event) =>
                update(index, {
                  criticalSelectors: event.target.value
                    .split("\n")
                    .map((item) => item.trim())
                    .filter(Boolean),
                })
              }
            />
          </label>
          <div className="steps">
            <div className="row-title">
              <h3>Шаги взаимодействия</h3>
              <button
                type="button"
                onClick={() =>
                  update(index, {
                    interaction: [...page.interaction, emptyStep()],
                  })
                }
              >
                Добавить шаг
              </button>
            </div>
            {page.interaction.map((step, stepIndex) => (
              <div className="grid step" key={stepIndex}>
                <SelectField
                  label="Действие"
                  required
                  value={step.action}
                  onChange={(value) =>
                    updateStep(index, stepIndex, {
                      action: value as GuiInteractionBody["action"],
                    })
                  }
                  options={Object.entries(actionLabels).map(
                    ([value, label]) => ({
                      value,
                      label,
                    }),
                  )}
                />
                <TextField
                  label="Селектор"
                  value={step.selector}
                  onChange={(selector) =>
                    updateStep(index, stepIndex, { selector })
                  }
                />
                <TextField
                  label="Текст"
                  value={step.text}
                  onChange={(text) => updateStep(index, stepIndex, { text })}
                />
                <TextField
                  label="Клавиша"
                  value={step.key}
                  onChange={(key) => updateStep(index, stepIndex, { key })}
                />
                <TextField
                  label="Таймаут, мс"
                  value={step.timeoutMs}
                  onChange={(timeoutMs) =>
                    updateStep(index, stepIndex, { timeoutMs })
                  }
                />
                <button
                  type="button"
                  className="ghost"
                  onClick={() =>
                    update(index, {
                      interaction: page.interaction.filter(
                        (_, item) => item !== stepIndex,
                      ),
                    })
                  }
                >
                  Удалить шаг
                </button>
              </div>
            ))}
          </div>
        </article>
      ))}
      <button
        type="button"
        onClick={() => props.onChange([...pages, emptyPage(pages.length)])}
      >
        Добавить страницу
      </button>
    </section>
  );
}
