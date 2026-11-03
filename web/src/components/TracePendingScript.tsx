"use client";

// Marks <html> with `data-trace-pending` before first paint when the URL asks
// for a trace (`?trace=`, from `wizardflow ui` or the OTel dashboard). The
// viewer is a static page rendered without a query string, so its HTML always
// holds the "No flow loaded" canvas; with the mark, CSS in globals.css shows
// the loading placeholder instead from the very first frame. page.tsx removes
// the mark once the trace has loaded or failed.
//
// Same executable-only-in-server-HTML trick as ColorSchemeScript.tsx (see
// there for why).
const MARK_PENDING_TRACE = `(function(){try{
if(new URLSearchParams(window.location.search).get('trace')){document.documentElement.setAttribute('data-trace-pending','');}
}catch(e){}})();`;

/** The `?trace=` load is over (loaded or failed): normal rendering resumes. */
export function clearTracePending(): void {
  document.documentElement.removeAttribute("data-trace-pending");
}

export default function TracePendingScript() {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: MARK_PENDING_TRACE }}
    />
  );
}
