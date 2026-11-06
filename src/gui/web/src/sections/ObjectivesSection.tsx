import { CheckField, SelectField, TextField } from "../components/Fields.tsx";
import { metricLabels, metricOrder, type GuiFormBody } from "../draft.ts";
import type { CwvMetric } from "../../../../website/config.ts";

export function ObjectivesSection(props: {
  form: GuiFormBody;
  onChange: (patch: Partial<GuiFormBody>) => void;
}) {
  return (
    <section className="card">
      <h2>Цели, проверка и Lighthouse</h2>
      <div className="grid">
        {metricOrder.map((metric) => (
          <TextField
            key={metric}
            label={metricLabels[metric]}
            value={props.form.thresholds[metric]}
            onChange={(value) =>
              props.onChange({
                thresholds: { ...props.form.thresholds, [metric]: value },
              })
            }
          />
        ))}
        <TextField
          label="Запас порога, %"
          required
          value={props.form.safetyMarginPercent}
          onChange={(safetyMarginPercent) =>
            props.onChange({ safetyMarginPercent })
          }
        />
        <TextField
          label="Минимальное улучшение, %"
          required
          value={props.form.minImprovementPercent}
          onChange={(minImprovementPercent) =>
            props.onChange({ minImprovementPercent })
          }
        />
        <TextField
          label="Допустимая регрессия, %"
          required
          value={props.form.maxRegressionPercent}
          onChange={(maxRegressionPercent) =>
            props.onChange({ maxRegressionPercent })
          }
        />
      </div>
      <div className="checks">
        {metricOrder.map((metric) => (
          <CheckField
            key={metric}
            label={`Защитить ${metricLabels[metric]}`}
            checked={props.form.protectedMetrics.includes(metric)}
            onChange={(checked) => {
              const next = checked
                ? [...props.form.protectedMetrics, metric]
                : props.form.protectedMetrics.filter((item) => item !== metric);
              props.onChange({ protectedMetrics: next as CwvMetric[] });
            }}
          />
        ))}
      </div>
      <div className="grid">
        <CheckField
          label="Визуальная регрессия"
          checked={props.form.visualRegression}
          onChange={(visualRegression) => props.onChange({ visualRegression })}
        />
        <TextField
          label="Порог визуального отличия"
          value={props.form.screenshotDiffThreshold}
          onChange={(screenshotDiffThreshold) =>
            props.onChange({ screenshotDiffThreshold })
          }
        />
        <CheckField
          label="Lighthouse"
          checked={props.form.lighthouseEnabled}
          onChange={(lighthouseEnabled) =>
            props.onChange({ lighthouseEnabled })
          }
        />
        <SelectField
          label="Форм-фактор Lighthouse"
          value={props.form.lighthouseFormFactor}
          onChange={(value) =>
            props.onChange({
              lighthouseFormFactor:
                value as GuiFormBody["lighthouseFormFactor"],
            })
          }
          options={[
            { value: "mobile", label: "телефон" },
            { value: "desktop", label: "компьютер" },
          ]}
        />
      </div>
    </section>
  );
}
