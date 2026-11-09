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
// That sidebar's fold and labels are set here too, before React is up, and
// for /otel's first frame as well (see OtelSidebar.tsx); the storage keys are
// otelDisplay.ts's and OtelSidebar's. The header's first frame likewise (see
// OtelCrumbsFirstFrame.tsx): the project comes from the URL, the rest from what
// the page we came from remembered, if that was showing this same execution.
const MARK_PENDING_TRACE = `(function(){try{
var p=window.location.pathname,q=new URLSearchParams(window.location.search),h=document.documentElement;
function rail(pr){try{var db=localStorage.getItem('wf-otel-db-label');
if(pr)h.style.setProperty('--wf-rail-project',JSON.stringify(pr));else h.setAttribute('data-rail-no-project','');
if(db)h.style.setProperty('--wf-rail-db',JSON.stringify(db));
if(localStorage.getItem('wf-otel-receiver')==='1')h.setAttribute('data-rail-live','');
if(JSON.parse(localStorage.getItem('wf-otel-display')||'{}').sidebarFolded)h.setAttribute('data-sidebar-folded','');}catch(e){}}
function crumbs(id,pr){if(!pr)return;
function slot(n,v){h.style.setProperty('--wf-crumb-'+n,JSON.stringify(v));}
slot('project',pr);h.setAttribute('data-crumbs','');
try{var s=JSON.parse(sessionStorage.getItem('wf-otel-crumbs')||'{}');if(!id||s.traceId!==id)return;
if(s.conversation){slot('conversation',s.conversation);h.setAttribute('data-crumb-conversation','');}
if(s.total>1){slot('execution','Execution '+s.position+' of '+s.total);h.setAttribute('data-crumb-execution','');
if(s.position<=1)h.setAttribute('data-crumb-first','');
if(s.position>=s.total)h.setAttribute('data-crumb-last','');}}catch(e){}}
if(p==='/otel'||p==='/otel/'||p==='/otel.html'){rail(q.get('project'));
if(q.get('view')==='trace'&&q.get('trace'))crumbs(q.get('trace'),q.get('project'));return;}
if(p!=='/'&&p!=='/index.html')return;
if(q.get('from')==='otel'){h.setAttribute('data-from-dashboard','');
var pr=new URLSearchParams((q.get('back')||'').split('?')[1]||'').get('project');rail(pr);
if(q.get('trace'))crumbs(q.get('otelTrace'),pr);}
if(q.get('trace'))h.setAttribute('data-trace-pending','');
}catch(e){}})();`;

/** What the next page's first-frame header shows, if it opens this execution. */
export function rememberCrumbs(crumbs: {
  traceId: string;
  conversation?: string;
  position?: number;
  total?: number;
}): void {
  try {
    sessionStorage.setItem("wf-otel-crumbs", JSON.stringify(crumbs));
  } catch {
    // storage unavailable: the first frame just shows fewer crumbs
  }
}

/** The page's own header is ready: the first-frame one steps aside. */
export function clearCrumbsFirstFrame(): void {
  document.documentElement.removeAttribute("data-crumbs");
}

/** The `?trace=` load is over (shown or failed): the cover fades out. */
export function clearTracePending(): void {
  document.documentElement.removeAttribute("data-trace-pending");
  clearCrumbsFirstFrame();
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
