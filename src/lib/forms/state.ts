import { z } from "zod";

/** State returned by Server Actions used with React's useActionState. */
export type FormState = {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Partial<Record<string, string[]>>;
  /** Echo of submitted text values so the form keeps them after an error. */
  values?: Record<string, string>;
  /**
   * App path to open with a full page load after success (withDocumentRedirect).
   * For actions that change what the whole private area renders (first store,
   * joining a store): a client-side redirect could replay a stale cached
   * redirect of /app to /onboarding.
   */
  redirectTo?: string;
};

export const initialFormState: FormState = { status: "idle" };

export function formValues(formData: FormData, keys: string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const key of keys) {
    const value = formData.get(key);
    if (typeof value === "string") values[key] = value;
  }
  return values;
}


/** Field errors from a failed Zod parse, keyed by field name. */
export function zodFieldErrors(error: z.ZodError): FormState["fieldErrors"] {
  return z.flattenError(error).fieldErrors as FormState["fieldErrors"];
}
