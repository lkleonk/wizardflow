import { useSyncExternalStore } from "react";
import { isHostedWizardFlow } from "@/utils/deploymentTarget";

/**
 * Where the replay viewer is being used, which decides the chrome around it:
 *
 * - `website`: getwizardflow.com, a visitor exploring or dropping a file.
 * - `local-file`: `wizardflow ui run.jsonl`, a developer reading their own run.
 * - `from-dashboard`: a replay opened from the local OTel dashboard
 *   (`?from=otel`), drilling into one conversation from the database.
 */
export type ViewerContext = "website" | "local-file" | "from-dashboard";

/** Which pieces of chrome a context shows. The replay itself is always there. */
export type ViewerChrome = {
  examples: boolean;
  upload: boolean;
  tutorial: boolean;
  whyWizardFlow: boolean;
  /** The "Data stays local" menu item and its dialog. */
  localDataPromise: boolean;
  /** Welcome dialog and the demo explainer toast. */
  demoGuide: boolean;
  footer: boolean;
};

// The one place that decides what each context shows; components read this
// table instead of carrying their own conditions. A visitor needs the tour and
// the privacy promise; someone who ran `wizardflow ui` on their own machine
// came with a trace and needs neither.
const CHROME: Record<ViewerContext, ViewerChrome> = {
  website: {
    examples: true,
    upload: true,
    tutorial: true,
    whyWizardFlow: true,
    localDataPromise: true,
    demoGuide: true,
    footer: true,
  },
  "local-file": {
    examples: false,
    upload: true,
    tutorial: false,
    whyWizardFlow: false,
    localDataPromise: false,
    demoGuide: false,
    footer: true,
  },
  "from-dashboard": {
    examples: false,
    upload: false,
    tutorial: false,
    whyWizardFlow: false,
    localDataPromise: false,
    demoGuide: false,
    footer: false,
  },
};

// The build target is fixed at build time. Only the local build can be opened
// from the dashboard, and that is a query param, so it has to be read in the
// browser: the static HTML is rendered without it.
const baseContext: ViewerContext = isHostedWizardFlow ? "website" : "local-file";

function readContext(): ViewerContext {
  if (isHostedWizardFlow) return "website";
  const from = new URLSearchParams(window.location.search).get("from");
  return from === "otel" ? "from-dashboard" : "local-file";
}

// The URL's `from` param never changes while the page is open, so there is
// nothing to subscribe to.
const subscribe = () => () => {};

function readBackHref(): string | null {
  const back = new URLSearchParams(window.location.search).get("back");
  // Only ever back into our own dashboard: never an arbitrary URL from a link.
  return back && back.startsWith("/otel") && !back.startsWith("//") ? back : null;
}

/** Where "back to the dashboard" leads, for a replay opened from it. */
export function useDashboardBackHref(): string | null {
  return useSyncExternalStore(subscribe, readBackHref, () => null);
}

/**
 * The viewer's context and chrome. Renders the build target's base context on
 * the server and during hydration, then switches to the URL-derived one, so
 * the static HTML never mismatches.
 */
export function useViewerChrome(): {
  context: ViewerContext;
  chrome: ViewerChrome;
} {
  const context = useSyncExternalStore(
    subscribe,
    readContext,
    () => baseContext
  );
  return { context, chrome: CHROME[context] };
}
