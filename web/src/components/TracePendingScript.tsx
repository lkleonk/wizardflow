"use client";

// Marks <html> with `data-trace-pending` before first paint when the URL asks
// for a trace (`?trace=`, from `wizardflow ui` or the OTel dashboard). The
// viewer is a static page rendered without a query string, so its HTML always
// holds the empty "No flow loaded" viewer; with the mark, CSS in globals.css
// shows a full-screen loading cover over it from the very first frame, and
// nothing of the viewer is seen until the trace is on screen. page.tsx removes
// the mark once the graph has rendered, or the load failed.
//
// Same executable-only-in-server-HTML trick as ColorSchemeScript.tsx (see
// there for why).
// Only on the viewer: the dashboard's trace page (/otel?view=trace&trace=…)
// has a `trace` param too, and nothing there would ever lift the cover. A
// replay opened from the dashboard (`from=otel`) is marked too, so its
// sidebar shows and the cover leaves it uncovered, both from the first frame.
// That sidebar's fold and labels are set here too, before React is up (see
// OtelSidebar.tsx); the storage keys are otelDisplay.ts's and OtelSidebar's.
const MARK_PENDING_TRACE = `(function(){try{
var p=window.location.pathname,q=new URLSearchParams(window.location.search),h=document.documentElement;
if(p!=='/'&&p!=='/index.html')return;
if(q.get('from')==='otel'){h.setAttribute('data-from-dashboard','');
try{var b=q.get('back')||'',pr=new URLSearchParams(b.split('?')[1]||'').get('project'),db=localStorage.getItem('wf-otel-db-label');
if(pr)h.style.setProperty('--wf-rail-project',JSON.stringify(pr));
if(db)h.style.setProperty('--wf-rail-db',JSON.stringify(db));
if(JSON.parse(localStorage.getItem('wf-otel-display')||'{}').sidebarFolded)h.setAttribute('data-sidebar-folded','');}catch(e){}}
if(q.get('trace'))h.setAttribute('data-trace-pending','');
}catch(e){}})();`;

/** The `?trace=` load is over (shown or failed): the cover fades out. */
export function clearTracePending(): void {
  document.documentElement.removeAttribute("data-trace-pending");
}

/** Whether the first-paint cover is still up. */
export function isTracePending(): boolean {
  return document.documentElement.hasAttribute("data-trace-pending");
}

export default function TracePendingScript() {
  return (
    <>
      <script
        type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: MARK_PENDING_TRACE }}
      />
      {/* Plain markup and CSS, no MUI: it has to look right before any
          JavaScript runs. Styled by `.wf-trace-cover` in globals.css. */}
      <div className="wf-trace-cover" role="status" aria-live="polite">
        <div className="wf-trace-cover-brand">WizardFlow</div>
        <div className="wf-trace-cover-spinner" aria-hidden />
        <div className="wf-trace-cover-label">Opening graph replay…</div>
      </div>
    </>
  );
}
