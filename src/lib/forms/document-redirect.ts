"use client";

import type { FormState } from "./state";

type FormAction = (prev: FormState, formData: FormData) => Promise<FormState>;

function isAppPath(path: string | undefined): path is string {
  return typeof path === "string" && path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/\\");
}

/**
 * Wraps a Server Action for useActionState: when it answers with
 * `redirectTo`, the browser opens that app path with a full page load (not a
 * client-side navigation), so the next page starts with an empty client router
 * cache. It happens as soon as the result arrives, independent of rendering:
 * the action's response may re-render the current page without the form
 * (e.g. "invitation already used").
 */
export function withDocumentRedirect(action: FormAction): FormAction {
  return async (prev, formData) => {
    const state = await action(prev, formData);
    if (isAppPath(state.redirectTo)) window.location.assign(state.redirectTo);
    return state;
  };
}

/** True once the action asked to leave: keep the submit button disabled. */
export function isLeaving(state: FormState): boolean {
  return isAppPath(state.redirectTo);
}
