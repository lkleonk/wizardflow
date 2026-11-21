"use client";

import { isHostedWizardFlow } from "@/utils/deploymentTarget";
import OtelHeader, { executionCrumbs } from "./OtelHeader";

const noop = () => {};

/**
 * The header while a replay or span page loads, so moving between the two
 * doesn't blink it away. These are separate static pages, so React knows
 * nothing yet: this is the real header with empty slots, and the pre-paint
 * script in TracePendingScript.tsx fills them through CSS and shows it. It
 * goes away when the page's own header is ready.
 */
export default function OtelCrumbsFirstFrame() {
  if (isHostedWizardFlow) return null;
  return (
    <div className="wf-crumbs-first-frame" aria-hidden inert>
      <OtelHeader
        route={{ view: "trace", project: " " }}
        projects={[]}
        live
        projectLabel={<span className="wf-crumb-project" />}
        trail={executionCrumbs({
          conversation: <span className="wf-crumb-conversation" />,
          execution: {
            position: 1,
            total: 2,
            label: <span className="wf-crumb-execution" />,
            onPrev: noop,
            onNext: noop,
            picker: { onJump: noop }, // so the arrow is already in place
          },
        })}
      />
    </div>
  );
}
