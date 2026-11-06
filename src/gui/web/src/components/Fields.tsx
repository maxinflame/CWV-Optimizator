import { useId, type ReactNode } from "react";

export function Field(props: {
  label: string;
  required?: boolean;
  hint?: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <label className="field" htmlFor={id}>
      <span className="field-label">
        {props.label}
        {props.required ? (
          <em>Обязательно</em>
        ) : (
          <em className="optional">Необязательно</em>
        )}
      </span>
      {props.children(id)}
      {props.hint ? <small>{props.hint}</small> : null}
    </label>
  );
}

export function TextField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  hint?: string;
  testId?: string;
  readOnly?: boolean;
}) {
  return (
    <Field label={props.label} required={props.required} hint={props.hint}>
      {(id) => (
        <input
          id={id}
          value={props.value}
          readOnly={props.readOnly}
          data-testid={props.testId}
          onChange={(event) => props.onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

export function SelectField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  testId?: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <Field label={props.label} required={props.required}>
      {(id) => (
        <select
          id={id}
          value={props.value}
          data-testid={props.testId}
          onChange={(event) => props.onChange(event.target.value)}
        >
          {props.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

export function CheckField(props: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="check">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(event) => props.onChange(event.target.checked)}
      />
      <span>{props.label}</span>
    </label>
  );
}
