import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

const CONTROL =
  "block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm " +
  "placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 " +
  "aria-[invalid=true]:border-red-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100";

type FieldProps = {
  id: string;
  label: string;
  errors?: string[] | undefined;
  hint?: string;
  children: (describedBy: string | undefined, invalid: boolean) => ReactNode;
};

/** Label + control + hint + error, wired with aria-describedby / aria-invalid. */
export function Field({ id, label, errors, hint, children }: FieldProps) {
  const invalid = Boolean(errors && errors.length > 0);
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = invalid ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium text-slate-800 dark:text-slate-200">
        {label}
      </label>
      {children(describedBy, invalid)}
      {hint ? (
        <p id={hintId} className="text-xs text-slate-500 dark:text-slate-400">
          {hint}
        </p>
      ) : null}
      {invalid ? (
        <p id={errorId} className="text-sm text-red-600 dark:text-red-400">
          {errors?.join(" ")}
        </p>
      ) : null}
    </div>
  );
}

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "name"> & {
  name: string;
  label: string;
  errors?: string[] | undefined;
  hint?: string;
};

export function TextField({ name, label, errors, hint, ...input }: TextFieldProps) {
  const id = `field-${name}`;
  return (
    <Field id={id} label={label} errors={errors} {...(hint ? { hint } : {})}>
      {(describedBy, invalid) => (
        <input
          id={id}
          name={name}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={CONTROL}
          {...input}
        />
      )}
    </Field>
  );
}

type SelectFieldProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "id" | "name"> & {
  name: string;
  label: string;
  options: { value: string; label: string }[];
  errors?: string[] | undefined;
  hint?: string;
};

export function SelectField({ name, label, options, errors, hint, ...select }: SelectFieldProps) {
  const id = `field-${name}`;
  return (
    <Field id={id} label={label} errors={errors} {...(hint ? { hint } : {})}>
      {(describedBy, invalid) => (
        <select
          id={id}
          name={name}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={CONTROL}
          {...select}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

type CheckboxFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "name" | "type"> & {
  name: string;
  label: string;
  hint?: string;
};

export function CheckboxField({ name, label, hint, ...input }: CheckboxFieldProps) {
  const id = `field-${name}`;
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        name={name}
        type="checkbox"
        aria-describedby={hintId}
        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus-visible:ring-2 focus-visible:ring-indigo-500"
        {...input}
      />
      <div>
        <label htmlFor={id} className="text-sm font-medium text-slate-800 dark:text-slate-200">
          {label}
        </label>
        {hint ? (
          <p id={hintId} className="text-xs text-slate-500 dark:text-slate-400">
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}
