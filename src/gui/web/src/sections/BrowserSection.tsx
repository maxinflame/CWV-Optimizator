import { SelectField, TextField } from "../components/Fields.tsx";
import type { GuiFormBody } from "../draft.ts";

export function BrowserSection(props: {
  form: GuiFormBody;
  onChange: (patch: Partial<GuiFormBody>) => void;
}) {
  return (
    <section className="card">
      <h2>Браузер</h2>
      <div className="grid">
        <TextField
          label="Ширина"
          required
          value={props.form.viewportWidth}
          onChange={(viewportWidth) => props.onChange({ viewportWidth })}
        />
        <TextField
          label="Высота"
          required
          value={props.form.viewportHeight}
          onChange={(viewportHeight) => props.onChange({ viewportHeight })}
        />
        <TextField
          label="Масштаб"
          required
          value={props.form.deviceScaleFactor}
          onChange={(deviceScaleFactor) =>
            props.onChange({ deviceScaleFactor })
          }
        />
        <SelectField
          label="Профиль"
          required
          value={props.form.profile}
          onChange={(value) =>
            props.onChange({ profile: value as GuiFormBody["profile"] })
          }
          options={[
            { value: "mobile", label: "телефон" },
            { value: "desktop", label: "компьютер" },
          ]}
        />
        <TextField
          label="Замедление CPU"
          value={props.form.cpuSlowdownMultiplier}
          onChange={(cpuSlowdownMultiplier) =>
            props.onChange({ cpuSlowdownMultiplier })
          }
        />
        <SelectField
          label="Сеть"
          value={props.form.networkPreset}
          onChange={(value) =>
            props.onChange({
              networkPreset: value as GuiFormBody["networkPreset"],
            })
          }
          options={[
            { value: "", label: "по умолчанию пайплайна" },
            { value: "NoThrottling", label: "без ограничений" },
            { value: "Slow4G", label: "медленный 4G" },
            { value: "Fast4G", label: "быстрый 4G" },
          ]}
        />
        <TextField
          label="Наблюдение, мс"
          value={props.form.observationMs}
          onChange={(observationMs) => props.onChange({ observationMs })}
        />
      </div>
    </section>
  );
}
