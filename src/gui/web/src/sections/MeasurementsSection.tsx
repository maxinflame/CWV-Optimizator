import { SelectField, TextField } from "../components/Fields.tsx";
import type { GuiFormBody } from "../draft.ts";

export function MeasurementsSection(props: {
  form: GuiFormBody;
  onChange: (patch: Partial<GuiFormBody>) => void;
}) {
  const batches = props.form.confirmationBatches;
  return (
    <section className="card">
      <h2>Замеры и бюджет</h2>
      <div className="grid">
        <TextField
          label="Повторы базового замера"
          required
          value={props.form.baselineRepeats}
          onChange={(baselineRepeats) => props.onChange({ baselineRepeats })}
        />
        <TextField
          label="Быстрые повторы"
          required
          value={props.form.quickRepeats}
          onChange={(quickRepeats) => props.onChange({ quickRepeats })}
        />
        <TextField
          label="Лимит минут"
          required
          value={props.form.maxDurationMinutes}
          onChange={(maxDurationMinutes) =>
            props.onChange({ maxDurationMinutes })
          }
        />
        <TextField
          label="Лимит итераций"
          required
          value={props.form.maxIterations}
          onChange={(maxIterations) => props.onChange({ maxIterations })}
        />
      </div>
      <div className="steps">
        <div className="row-title">
          <h3>Пакеты подтверждения</h3>
          <button
            type="button"
            onClick={() =>
              props.onChange({
                confirmationBatches: [
                  ...batches,
                  { role: "candidate", repeats: "3" },
                ],
              })
            }
          >
            Добавить пакет
          </button>
        </div>
        {batches.map((batch, index) => (
          <div className="grid step" key={index}>
            <SelectField
              label="Роль"
              required
              value={batch.role}
              onChange={(value) =>
                props.onChange({
                  confirmationBatches: batches.map((item, itemIndex) =>
                    itemIndex === index
                      ? { ...item, role: value as "candidate" | "reference" }
                      : item,
                  ),
                })
              }
              options={[
                { value: "candidate", label: "кандидат" },
                { value: "reference", label: "опора" },
              ]}
            />
            <TextField
              label="Повторы"
              required
              value={batch.repeats}
              onChange={(repeats) =>
                props.onChange({
                  confirmationBatches: batches.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, repeats } : item,
                  ),
                })
              }
            />
            <button
              type="button"
              className="ghost"
              disabled={batches.length === 1}
              onClick={() =>
                props.onChange({
                  confirmationBatches: batches.filter(
                    (_, itemIndex) => itemIndex !== index,
                  ),
                })
              }
            >
              Удалить пакет
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
