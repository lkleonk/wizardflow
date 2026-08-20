"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Box from "@mui/material/Box";
import Backdrop from "@mui/material/Backdrop";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import Paper from "@mui/material/Paper";
import { useColorScheme } from "@mui/material/styles";
import AppHeader from "@/components/AppHeader";
import DemoExplainerToast, {
  type DemoToastState,
} from "@/components/DemoExplainerToast";
import EmptyCanvas from "@/components/EmptyCanvas";
import ExampleGallery from "@/components/ExampleGallery";
import FooterLinks from "@/components/FooterLinks";
import GraphCanvas from "@/components/GraphCanvas";
import InspectorPanel from "@/components/InspectorPanel";
import LoadNotices from "@/components/LoadNotices";
import MessageTimeline from "@/components/MessageTimeline";
import PlaybackControls, {
  type PlaybackMode,
  type PlaybackSpeed,
} from "@/components/PlaybackControls";
import ReplaceFlowDialog from "@/components/ReplaceFlowDialog";
import SearchDialog, { type SearchHit } from "@/components/SearchDialog";
import TutorialDialog from "@/components/TutorialDialog";
import WelcomeDialog from "@/components/WelcomeDialog";
import { emptyTrace, exampleFlows, type ExampleFlow } from "@/data";
import type { AgentTraceFile } from "@/types/agenttrace";
import {
  getSavedFlow,
  getServerSavedFlow,
  getWelcomeDismissed,
  getServerWelcomeDismissed,
  setSavedFlow,
  setWelcomeDismissed,
  subscribeSavedFlow,
  subscribeWelcomeDismissed,
} from "@/utils/flowSession";
import {
  deltaMsAtStep,
  elapsedMsAtStep,
  getPayloadsForNode,
  orderedSteps,
  visibleGraph,
} from "@/utils/traceSelectors";
import { useInspectorPanel } from "@/hooks/useInspectorPanel";
import {
  useSearchHotkey,
  useTransportKeys,
} from "@/hooks/useKeyboardShortcuts";
import { withUniqueLabels } from "@/utils/payloadLabels";
import { parseAgentTrace } from "@/utils/agentTraceFile";
import {
  isTraceExtension,
  watchTrace,
  type TraceWatcher,
} from "@/utils/traceWatcher";

const PLAYBACK_INTERVAL_MS = 1200;

const MOBILE_FOOTER_RESERVED_HEIGHT = "168px";
const MOBILE_GRAPH_CHROME_HEIGHT = "274px";

// The flow behind "Watch a demo replay" (welcome + tutorial) and the default
// the docs deep-link to: the most approachable bundled example — a simulated
// doctor's visit whose story (interview, diagnosis, allergy-checked
// prescription, overnight lab results) needs no developer vocabulary.
const FLAGSHIP_EXAMPLE_ID = "doctor-consultation";
const flagshipExample =
  exampleFlows.find((flow) => flow.id === FLAGSHIP_EXAMPLE_ID) ?? exampleFlows[0];

// An example load in flight or awaiting confirmation. Carries the toast its
// entry point wants armed afterwards, so the request survives the round trip
// through the confirm dialog without the caller holding a callback.
type PendingExample = {
  flow: ExampleFlow;
  options?: { autoplay?: boolean; playThrough?: boolean };
  toast?: DemoToastState;
};

export default function Home() {
  // The active flow comes from the per-tab session store: `null` on the server
  // and the first client render (so hydration matches), then the user's saved
  // upload right after, falling back to the empty placeholder when nothing is
  // saved. See `@/utils/flowSession`.
  const savedFlow = useSyncExternalStore(
    subscribeSavedFlow,
    getSavedFlow,
    getServerSavedFlow
  );
  const trace = savedFlow ?? emptyTrace;
  const hasFlow = trace.graph.nodes.length > 0;

  // The graph the canvas renders: drops structural-only nodes (e.g. LangGraph's
  // virtual __start__/__end__) that never log anything. Everything else still
  // reads the full `trace` — only the canvas hides these.
  const graph = useMemo(() => visibleGraph(trace), [trace]);

  const [selectedMessageId, setSelectedMessageId] = useState(
    trace.messages[0]?.id
  );
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(
    orderedSteps(trace.messages[0])[0]?.nodeId
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackMode, setPlaybackMode] =
    useState<PlaybackMode>("stop-at-message-end");
  const [playbackSpeed, setPlaybackSpeed] = useState<PlaybackSpeed>(1);
  const [searchOpen, setSearchOpen] = useState(false);
  const [graphArrangeMode, setGraphArrangeMode] = useState(false);
  const [isLoadingUrlTrace, setIsLoadingUrlTrace] = useState(false);
  const loadedTraceUrlRef = useRef<string | null>(null);
  // Live-watch state for the SDK launcher: while the served trace is being
  // polled for updates the header shows a pulse dot, and messages that arrive
  // while the user is parked on an older one are counted for the timeline's
  // "+N new" chip. `pendingExtend` tells the render-time reset below that the
  // next trace change is a live extension (keep the view) rather than a new
  // flow (reset the view) — state, not a ref, so it can be consumed during
  // render like `pendingAutoplay`. `stopLiveWatchRef` lets user-initiated
  // loads end the watch, so a later poll never overwrites an upload.
  const [isLiveWatching, setIsLiveWatching] = useState(false);
  const [newLiveMessageCount, setNewLiveMessageCount] = useState(0);
  const [pendingExtend, setPendingExtend] = useState<{
    prevLastMessageId?: string;
    prevMessageCount: number;
  } | null>(null);
  const stopLiveWatchRef = useRef<(() => void) | null>(null);
  // Part navigation for a rotated trace. The launcher opens exactly one part;
  // `partRequest` is the neighbour the user stepped to (null = whatever
  // `?trace=` names), and `activeTraceHref` is the URL the loaded trace
  // actually came from — the base that `meta.prevPart` / `meta.nextPart`
  // resolve against, and the reason an *uploaded* part file shows no
  // navigation: it carries the neighbour names but no URL to walk.
  const [partRequest, setPartRequest] = useState<{
    href: string;
    name: string;
  } | null>(null);
  const [activeTraceHref, setActiveTraceHref] = useState<string | null>(null);
  // Set when a flow is loaded with `autoplay` (examples); consumed by the
  // render-time reset below so playback starts the moment the flow lands.
  const [pendingAutoplay, setPendingAutoplay] = useState(false);
  const exampleParamHandledRef = useRef(false);

  const disableGraphArrangeMode = useCallback(() => {
    setGraphArrangeMode(false);
  }, []);

  const pausePlayback = useCallback(() => setIsPlaying(false), []);

  // The inspector panel's own frame state (shown, width, maximized). It
  // depends on nothing in the trace, so it lives entirely on its own.
  const inspector = useInspectorPanel(disableGraphArrangeMode);

  // The welcome dialog shows until the user makes their first choice this
  // session (then it's remembered), and never while a saved flow is loaded.
  const welcomeDismissed = useSyncExternalStore(
    subscribeWelcomeDismissed,
    getWelcomeDismissed,
    getServerWelcomeDismissed
  );

  // The example-flow picker (a gallery dialog opened from the header).
  const [galleryOpen, setGalleryOpen] = useState(false);

  // Gallery id of the bundled example currently loaded, or undefined for an
  // upload / served trace / empty canvas. Drives the gallery's "current" badge.
  const [currentExampleId, setCurrentExampleId] = useState<string | undefined>(
    undefined
  );

  // Bundled example traces are fetched on demand (see `loadTrace` in
  // src/data/index.ts), so a demo entry point has to await a chunk before the
  // replay can start. This holds the id being fetched so the triggering control
  // can show progress instead of appearing dead for a beat.
  const [loadingExampleId, setLoadingExampleId] = useState<string | null>(null);
  const isFlagshipLoading = loadingExampleId === FLAGSHIP_EXAMPLE_ID;

  // Whether this tab was opened on an `?example=` deep link that still has to
  // resolve. Read during the first render, not from the effect that performs
  // the load: the effect runs after hydration, and by then useSyncExternalStore
  // has already swapped in the real (undismissed) welcome flag and painted the
  // dialog. Deciding here means it never opens in the first place.
  //
  // Safe for hydration — the server renders the welcome closed anyway, and
  // this only ever keeps it closed. Cleared once the load settles so a failed
  // fetch still lands on the normal welcome screen.
  const [exampleDeepLinkPending, setExampleDeepLinkPending] = useState(() => {
    if (typeof window === "undefined") return false;
    const params = new URLSearchParams(window.location.search);
    if (params.get("trace")) return false;
    const id = params.get("example");
    return !!id && exampleFlows.some((flow) => flow.id === id);
  });

  // A flow arriving in a moment counts as "a flow is loaded" here, or the
  // welcome dialog flashes in front of it while it lands: a fresh tab has an
  // empty session store, so the dialog would otherwise open on hydration and
  // stay up for the whole fetch. `isLoadingUrlTrace` covers `?trace=`; the
  // other two cover `?example=`, whose trace is now a separate chunk fetched
  // on demand rather than part of the entry bundle.
  const welcomeOpen =
    !welcomeDismissed &&
    !savedFlow &&
    !isLoadingUrlTrace &&
    !loadingExampleId &&
    !exampleDeepLinkPending;
  const [tutorialOpen, setTutorialOpen] = useState(false);

  // Explainer toast shown over a freshly started demo replay (see
  // DemoExplainerToast). Armed by the demo entry points: the welcome dialog
  // and `?example=` deep links show both parts, the tutorial's demo button
  // only part 1. Gallery picks and uploads show nothing.
  const [demoToast, setDemoToast] = useState<DemoToastState | null>(null);

  // Post-load confirmation for user-file loads (upload button, drag & drop):
  // doubles as load feedback and as the "nothing was uploaded" reassurance at
  // the moment it matters. Example/SDK-launcher loads don't show it.
  const [uploadNoticeOpen, setUploadNoticeOpen] = useState(false);

  // Shown when a bundled example's chunk can't be fetched (see loadExample).
  const [exampleErrorOpen, setExampleErrorOpen] = useState(false);

  // An example the user picked while their own flow was open, held until they
  // confirm replacing it (see requestExample).
  const [pendingExample, setPendingExample] = useState<PendingExample | null>(
    null
  );

  // Re-seed the viewing position whenever the active flow changes: a saved flow
  // restored just after hydration, a fresh upload, or dropping back to the
  // empty state. Done during render (tracking the previous flow) rather than in an
  // effect, per React guidance.
  const [lastFlow, setLastFlow] = useState(trace);
  if (trace !== lastFlow) {
    setLastFlow(trace);
    const extend = pendingExtend;
    if (extend) setPendingExtend(null);
    if (extend && trace.messages.some((m) => m.id === selectedMessageId)) {
      // Live extension of the flow being viewed: keep the view (selection,
      // step, playback, arrange mode) intact. On the previous *last* message
      // the view follows the run to the newest one — tail -f behavior;
      // anywhere earlier nothing moves and the arrivals are counted for the
      // timeline's "+N new" chip instead.
      if (selectedMessageId === extend.prevLastMessageId) {
        const tail = trace.messages[trace.messages.length - 1];
        setSelectedMessageId(tail.id);
        setCurrentStepIndex(0);
        setSelectedNodeId(orderedSteps(tail)[0]?.nodeId);
      } else {
        setNewLiveMessageCount(
          (count) => count + trace.messages.length - extend.prevMessageCount
        );
      }
    } else {
      setSelectedMessageId(trace.messages[0]?.id);
      setCurrentStepIndex(0);
      setSelectedNodeId(orderedSteps(trace.messages[0])[0]?.nodeId);
      setIsPlaying(pendingAutoplay);
      if (pendingAutoplay) setPendingAutoplay(false);
      setGraphArrangeMode(false);
      setNewLiveMessageCount(0);
    }
  }

  const { mode, systemMode, setMode } = useColorScheme();
  // mode is undefined on the server / first client render; treat that as dark
  // (the default scheme) so SSR and hydration agree.
  const isDarkMode = (mode === "system" ? systemMode : mode) !== "light";
  const toggleColorMode = () => setMode(isDarkMode ? "light" : "dark");

  const currentMessageIndex = useMemo(
    () => trace.messages.findIndex((m) => m.id === selectedMessageId),
    [trace.messages, selectedMessageId]
  );
  const currentMessage =
    currentMessageIndex >= 0 ? trace.messages[currentMessageIndex] : undefined;

  // The "+N new" counter clears once the user reaches the newest message —
  // whether via the chip itself, arrow keys, or live tail-follow. Adjusted
  // during render (like the flow reset above) rather than in an effect.
  if (
    newLiveMessageCount > 0 &&
    currentMessageIndex === trace.messages.length - 1
  ) {
    setNewLiveMessageCount(0);
  }

  // The replay sequence — steps sorted by timestamp. Everything downstream
  // (active node, recent glow, scrubber, deltas) reads from this, not raw order.
  const steps = useMemo(() => orderedSteps(currentMessage), [currentMessage]);
  const stepCount = steps.length;
  const activeNodeId = steps[currentStepIndex]?.nodeId;
  const currentDeltaMs = deltaMsAtStep(steps, currentStepIndex);
  const currentElapsedMs = elapsedMsAtStep(steps, currentStepIndex);
  const playbackIntervalMs = PLAYBACK_INTERVAL_MS / playbackSpeed;

  // Nodes visited before the current step, most-recent first and de-duplicated,
  // so the graph can render a fading "recently active" glow.
  const recentNodeIds = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (let i = currentStepIndex - 1; i >= 0; i--) {
      const nodeId = steps[i]?.nodeId;
      if (!nodeId || nodeId === activeNodeId || seen.has(nodeId)) continue;
      seen.add(nodeId);
      result.push(nodeId);
    }
    return result;
  }, [steps, currentStepIndex, activeNodeId]);

  // Move to a step and sync the inspector to the node active at that step.
  const goToStep = useCallback(
    (index: number) => {
      if (steps.length === 0) return;
      const clamped = Math.max(0, Math.min(index, steps.length - 1));
      setCurrentStepIndex(clamped);
      setSelectedNodeId(steps[clamped]?.nodeId);
    },
    [steps]
  );

  const goToMessageStart = useCallback(
    (messageIndex: number) => {
      const message = trace.messages[messageIndex];
      if (!message) return false;

      setSelectedMessageId(message.id);
      setCurrentStepIndex(0);
      setSelectedNodeId(orderedSteps(message)[0]?.nodeId);
      return true;
    },
    [trace.messages]
  );

  const handleSelectMessage = useCallback(
    (messageId: string) => {
      disableGraphArrangeMode();
      setIsPlaying(false);
      const messageIndex = trace.messages.findIndex((m) => m.id === messageId);
      goToMessageStart(messageIndex);
    },
    [disableGraphArrangeMode, goToMessageStart, trace.messages]
  );

  const goToAdjacentMessage = useCallback(
    (direction: -1 | 1) => {
      const nextMessageIndex = currentMessageIndex + direction;
      if (nextMessageIndex < 0 || nextMessageIndex >= trace.messages.length) {
        return;
      }

      disableGraphArrangeMode();
      setIsPlaying(false);
      goToMessageStart(nextMessageIndex);
    },
    [
      currentMessageIndex,
      disableGraphArrangeMode,
      goToMessageStart,
      trace.messages.length,
    ]
  );

  // Jump the whole view to a search hit: message, playhead step, node — and,
  // for payload hits, ask the inspector to focus that payload's tab. Opens the
  // inspector if it was hidden, since the payload is the point of the jump.
  const handleSearchJump = useCallback(
    (hit: SearchHit) => {
      const message = trace.messages[hit.messageIndex];
      if (!message || message.id !== hit.messageId) return;
      disableGraphArrangeMode();
      setIsPlaying(false);
      setSelectedMessageId(message.id);
      const messageSteps = orderedSteps(message);
      const stepIndex = Math.max(
        0,
        Math.min(hit.stepIndex ?? 0, messageSteps.length - 1)
      );
      setCurrentStepIndex(stepIndex);
      setSelectedNodeId(hit.nodeId ?? messageSteps[stepIndex]?.nodeId);
      const payloadIndex = hit.payloadIndex;
      if (payloadIndex !== undefined) inspector.revealPayload(payloadIndex);
    },
    [disableGraphArrangeMode, inspector, trace.messages]
  );

  const openSearch = useCallback(() => setSearchOpen(true), []);
  useSearchHotkey(hasFlow, openSearch);

  // Clicking a node pauses a running replay before selecting it. Playback
  // re-selects the active node on every tick, so without pausing a mid-replay
  // click is overridden within a step and nodes feel unclickable — exactly
  // while the demo toast invites clicking them. Space / play resumes.
  const handleSelectNode = useCallback((nodeId: string) => {
    setIsPlaying(false);
    setSelectedNodeId(nodeId);
  }, []);

  // Keep `?example=` in the address bar in sync with what's actually loaded:
  // set it when a bundled example is active (so the URL is always a shareable
  // deep link), remove it when anything else is (so a copied URL doesn't send
  // a colleague to a demo the user no longer sees). `?trace=` is deliberately
  // left alone — the SDK launcher relies on it surviving refreshes to re-read
  // a still-running trace. replaceState: no navigation, no history entry.
  const syncExampleParam = useCallback((exampleId?: string) => {
    const url = new URL(window.location.href);
    if (exampleId) {
      if (url.searchParams.get("example") === exampleId) return;
      url.searchParams.set("example", exampleId);
    } else {
      if (!url.searchParams.has("example")) return;
      url.searchParams.delete("example");
    }
    window.history.replaceState(null, "", url);
  }, []);

  // `autoplay` starts playback as soon as the flow lands (examples; honors
  // prefers-reduced-motion by loading paused). `playThrough` additionally
  // switches to play-next-message so a demo runs every message — reserved for
  // the demo entry points, so it never overrides a mode the user picked while
  // browsing the gallery. `exampleId` identifies a bundled example so its
  // deep link lands in the address bar.
  const handleLoadTrace = useCallback(
    (
      next: AgentTraceFile,
      options?: {
        autoplay?: boolean;
        playThrough?: boolean;
        exampleId?: string;
      }
    ) => {
      // Loading a flow ends any live watch — a poll must never overwrite what
      // the user just loaded. (The launcher's own initial load runs before the
      // watch starts, so this is a no-op there.)
      stopLiveWatchRef.current?.();
      // Whatever is being loaded is not a served part until the launcher says
      // so — it re-sets this right after this call, so a part switch keeps its
      // navigation while an upload drops it.
      setActiveTraceHref(null);
      disableGraphArrangeMode();
      syncExampleParam(options?.exampleId);
      setCurrentExampleId(options?.exampleId);
      // A newly loaded flow invalidates the demo explainer; demo entry points
      // re-arm it right after this call (same batch, so the later write wins).
      setDemoToast(null);
      const autoplay =
        !!options?.autoplay &&
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (options?.playThrough && autoplay) {
        setPlaybackMode("play-next-message");
      }
      setPendingAutoplay(autoplay);
      // Persist to the session store; the render-time reset above re-seeds the
      // view (selection, step, playback). Marking the welcome dismissed means
      // dropping the flow later lands on the empty canvas without re-prompting.
      setWelcomeDismissed();
      setSavedFlow(next);
    },
    [disableGraphArrangeMode, syncExampleParam]
  );

  // Every bundled-example entry point (welcome demo button, gallery, tutorial,
  // `?example=` deep link) routes through here: fetch the flow's chunk, then
  // hand the trace to handleLoadTrace. The await is normally instant — the
  // effect below prefetches the flagship, and any chunk already fetched is
  // cached — but a cold click resolves over the network, so `loadingExampleId`
  // lets the triggering control show progress rather than look dead.
  const loadExample = useCallback(
    async (
      flow: ExampleFlow,
      options?: { autoplay?: boolean; playThrough?: boolean }
    ): Promise<boolean> => {
      setLoadingExampleId(flow.id);
      try {
        const next = await flow.loadTrace();
        handleLoadTrace(next, { ...options, exampleId: flow.id });
        return true;
      } catch {
        // Only realistic cause is a failed chunk fetch (offline, or a deploy
        // that rotated the hashed file names under a long-open tab).
        setExampleErrorOpen(true);
        return false;
      } finally {
        setLoadingExampleId(null);
      }
    },
    [handleLoadTrace]
  );

  // Load an example and arm whatever toast belongs to that entry point.
  const runExample = useCallback(
    async (request: PendingExample) => {
      const loaded = await loadExample(request.flow, request.options);
      if (loaded && request.toast) setDemoToast(request.toast);
    },
    [loadExample]
  );

  // Every example entry point goes through here rather than calling
  // loadExample directly, so the one destructive case is caught in one place:
  // loading an example replaces whatever flow is open, and if that flow is the
  // user's own it cannot be recovered from inside the app — an upload would
  // have to be re-picked from disk. Confirm first in that case. Replacing one
  // example with another costs nothing, so it goes straight through.
  const requestExample = useCallback(
    (request: PendingExample) => {
      if (savedFlow && !currentExampleId) {
        setPendingExample(request);
        return;
      }
      void runExample(request);
    },
    [savedFlow, currentExampleId, runExample]
  );

  // Show an example in a second tab, leaving the user's flow untouched here.
  // The whole query string is dropped rather than just swapping `?example=`:
  // `?trace=` wins over `?example=` in the deep-link effect below, so a CLI
  // session would otherwise reopen the served trace instead of the example.
  // `noopener` is what keeps the new tab's session storage empty — a tab that
  // keeps its opener inherits a copy, and the deep-link effect refuses to
  // clobber an already-saved flow, which would swallow the example.
  const openExampleInNewTab = useCallback((flow: ExampleFlow) => {
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("example", flow.id);
    window.open(url.toString(), "_blank", "noopener");
  }, []);

  // The confirm dialog's two ways forward. Both drop the pending request
  // before acting, so the dialog closes on the click rather than waiting on
  // the example's chunk to arrive.
  const handleReplaceInNewTab = useCallback(() => {
    const request = pendingExample;
    setPendingExample(null);
    if (request) openExampleInNewTab(request.flow);
  }, [pendingExample, openExampleInNewTab]);

  const handleReplaceHere = useCallback(() => {
    const request = pendingExample;
    setPendingExample(null);
    if (request) void runExample(request);
  }, [pendingExample, runExample]);

  // Warm the flagship's chunk once the page is idle. It's the one example most
  // visitors open ("Watch a demo replay" is the welcome screen's main action),
  // so fetching it early makes that click instant — but doing it after paint
  // instead of bundling it keeps ~37 KB of trace data off the critical path.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const warm = () => {
      void flagshipExample.loadTrace().catch(() => {
        // A failed prefetch is harmless: the click retries and reports.
      });
    };
    if (typeof window.requestIdleCallback !== "function") {
      const timer = window.setTimeout(warm, 1500);
      return () => window.clearTimeout(timer);
    }
    const handle = window.requestIdleCallback(warm, { timeout: 3000 });
    return () => window.cancelIdleCallback(handle);
  }, []);

  // User-file entry points (upload buttons, drop targets) route through this
  // instead of handleLoadTrace directly, so only real uploads trigger the
  // local-processing confirmation.
  const handleUploadLoad = useCallback(
    (next: AgentTraceFile) => {
      handleLoadTrace(next);
      setUploadNoticeOpen(true);
    },
    [handleLoadTrace]
  );

  // Clear the current flow. trace is `savedFlow ?? emptyTrace`, so dropping the
  // saved flow leaves the empty canvas with upload, example, and drop targets.
  // Also forgets `?example=` so a refresh doesn't resurrect the demo the user
  // just dismissed.
  const handleDropFlow = useCallback(() => {
    stopLiveWatchRef.current?.();
    disableGraphArrangeMode();
    syncExampleParam(undefined);
    setCurrentExampleId(undefined);
    setPendingAutoplay(false);
    setDemoToast(null);
    setSavedFlow(null);
  }, [disableGraphArrangeMode, syncExampleParam]);

  // A rotated run is split across numbered part files, and the viewer holds one
  // part at a time — that is the point of rotating. The chain is walkable
  // without a manifest: a part's header carries `meta.prevPart`, and the seal
  // record that closed it carries `meta.nextPart`. Resolving those bare file
  // names against the URL this part was served from gives the neighbours.
  const partLinks = useMemo(() => {
    if (!activeTraceHref) return null;
    const meta = trace.meta;
    const prev = typeof meta?.prevPart === "string" ? meta.prevPart : undefined;
    const next = typeof meta?.nextPart === "string" ? meta.nextPart : undefined;
    if (!prev && !next) return null;
    // Part 1's header omits `part` (an unrotated trace stays clean), so a
    // trace that has neighbours but no index is the first one.
    return { prev, next, index: typeof meta?.part === "number" ? meta.part : 1 };
  }, [activeTraceHref, trace.meta]);

  // A trace loaded from a URL (the SDK launcher) is the only kind that can be
  // watched or walked part by part, so it's also the only one that gets the
  // status slot and the divider before the action icons.
  const isServedTrace = activeTraceHref !== null;

  const goToPart = useCallback(
    (name: string) => {
      if (!activeTraceHref) return;
      setPartRequest({ href: new URL(name, activeTraceHref).href, name });
    },
    [activeTraceHref]
  );

  // The timeline's "+N new" chip jumps to the newest live message; the counter
  // clears via the tail-reached effect above.
  const handleJumpToNewest = useCallback(() => {
    const tail = trace.messages[trace.messages.length - 1];
    if (tail) handleSelectMessage(tail.id);
  }, [trace.messages, handleSelectMessage]);

  // Local SDK launcher support: `wizardflow ui trace.json` serves the bundled
  // static app and opens `/?trace=/__wizardflow_trace.json&traceName=...`.
  // Keep this same-origin only; the hosted website should not become a generic
  // cross-origin JSON fetcher just because a query string says so.
  //
  // After the initial load the URL keeps being polled — the file may still be
  // written to by a running agent. Each poll revalidates with If-None-Match
  // (the launcher's trace route answers 304 from a stat() when unchanged, and
  // static hosts do the same natively), slows down once the trace goes quiet,
  // and stops for good when the part rotates away (`meta.nextPart`).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // A part switch re-runs this effect with the neighbour's URL; everything
    // below (load, watch, cleanup) is the same either way.
    const traceParam = partRequest?.href ?? params.get("trace");
    if (!traceParam) return;

    const traceUrl = new URL(traceParam, window.location.href);
    if (traceUrl.origin !== window.location.origin) {
      alert("Trace URLs must be served from the same origin as WizardFlow.");
      return;
    }
    const traceHref = traceUrl.href;
    if (loadedTraceUrlRef.current === traceHref) return;
    loadedTraceUrlRef.current = traceHref;
    const traceName = partRequest?.name ?? params.get("traceName");
    const withName = (parsed: AgentTraceFile): AgentTraceFile =>
      traceName ? { ...parsed, name: traceName } : parsed;

    let cancelled = false;
    let watcher: TraceWatcher | null = null;

    function stopWatching() {
      watcher?.stop();
      watcher = null;
    }

    // Swap in a newer snapshot of the same run without resetting the view. A
    // snapshot that is not an extension (the file was replaced by a new run)
    // gets new-flow semantics from the render-time reset instead. Returns
    // whether anything was applied, so the watcher's backoff only counts real
    // changes.
    function applyLiveSnapshot(parsed: AgentTraceFile): boolean {
      const next = withName(parsed);
      const current = getSavedFlow();
      if (current && isTraceExtension(current, next)) {
        // Equal length with matching edge ids: nothing new. (An in-place
        // amend of an existing message isn't detectable by ids — rare enough
        // to ride along with the next append.)
        if (next.messages.length === current.messages.length) return false;
        setPendingExtend({
          prevLastMessageId: current.messages[current.messages.length - 1]?.id,
          prevMessageCount: current.messages.length,
        });
      } else {
        setPendingExtend(null);
      }
      setSavedFlow(next);
      return true;
    }

    function startWatching(initialEtag: string | null) {
      // Published so a user-initiated load can end the watch before it
      // overwrites what they just loaded.
      stopLiveWatchRef.current = stopWatching;
      setIsLiveWatching(true);
      watcher = watchTrace({
        href: traceHref,
        initialEtag,
        onSnapshot: applyLiveSnapshot,
        onStopped: () => {
          if (stopLiveWatchRef.current === stopWatching) {
            stopLiveWatchRef.current = null;
          }
          setIsLiveWatching(false);
        },
      });
    }

    async function loadTraceFromUrl() {
      setIsLoadingUrlTrace(true);
      try {
        const response = await fetch(traceHref, {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        // The SDK launcher serves assembled JSON, but accept JSONL too so any
        // same-origin trace file works.
        const parsed = parseAgentTrace(await response.text());
        if (!parsed) {
          throw new Error("invalid trace shape");
        }
        if (cancelled) return;

        handleLoadTrace(withName(parsed));
        // Remember where it came from, so `meta.prevPart` / `meta.nextPart`
        // can be resolved into sibling URLs for the header's part controls.
        setActiveTraceHref(traceHref);
        // Once the user has stepped to another part, keep `?trace=` pointing
        // at it: a refresh should come back to the part on screen, not to the
        // one the launcher happened to open.
        if (partRequest) {
          const url = new URL(window.location.href);
          url.searchParams.set("trace", traceUrl.pathname);
          url.searchParams.set("traceName", partRequest.name);
          window.history.replaceState(null, "", url);
        }
        // Watch for the file to grow — unless this part already rotated away
        // (a sealed part never changes).
        if (!parsed.meta?.nextPart) {
          startWatching(response.headers.get("ETag"));
        }
      } catch {
        if (!cancelled) {
          alert("Could not load the WizardFlow trace file from the URL.");
          loadedTraceUrlRef.current = null;
        }
      } finally {
        if (!cancelled) {
          setIsLoadingUrlTrace(false);
        }
      }
    }

    loadTraceFromUrl();
    return () => {
      cancelled = true;
      stopWatching();
      if (loadedTraceUrlRef.current === traceHref) {
        loadedTraceUrlRef.current = null;
      }
    };
  }, [handleLoadTrace, partRequest]);

  // Shareable demo deep link: `/?example=<gallery id>` loads a bundled example
  // and autoplays it, so a link in a post lands on a running replay with no
  // welcome dialog in between. `?trace=` (the SDK launcher) wins if both are
  // present; an unknown id falls back to the normal welcome flow; and a flow
  // already saved in this tab (e.g. an upload, surviving a refresh) is never
  // clobbered by the query string.
  useEffect(() => {
    // Deferred to a microtask so the effect body itself doesn't set state;
    // the handled-ref is only claimed inside it so a StrictMode double-mount
    // (queue → cancel → queue) still performs the load exactly once.
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled || exampleParamHandledRef.current) return;
      exampleParamHandledRef.current = true;

      const params = new URLSearchParams(window.location.search);
      if (params.get("trace")) return;
      const exampleParam = params.get("example");
      if (!exampleParam || getSavedFlow()) return;

      const example = exampleFlows.find((flow) => flow.id === exampleParam);
      if (!example) {
        setExampleDeepLinkPending(false);
        return;
      }
      void loadExample(example, { autoplay: true, playThrough: true }).then(
        (loaded) => {
          // Released either way: on success the loaded flow keeps the welcome
          // closed, on failure the user should get the welcome screen back
          // rather than an empty canvas with no way forward.
          setExampleDeepLinkPending(false);
          if (cancelled || !loaded) return;
          // A deep-link visitor skipped the welcome dialog entirely, so they
          // get the full explainer toast.
          setDemoToast({
            step: 1,
            flagship: example.id === FLAGSHIP_EXAMPLE_ID,
            withSdkPitch: true,
          });
        }
      );
    });
    return () => {
      cancelled = true;
    };
  }, [loadExample]);

  // A bundled example restored from the session store on refresh never goes
  // through loadExample, so recover which one it is from the `?example=` param
  // that syncExampleParam left in the address bar — otherwise the gallery would
  // stop badging it as current. Runs after hydration so SSR sees no window.
  // Deferred to a microtask for the same reason as the deep-link effect above:
  // the effect body itself must not set state.
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled || !getSavedFlow()) return;
      const id = new URLSearchParams(window.location.search).get("example");
      if (id && exampleFlows.some((flow) => flow.id === id)) {
        setCurrentExampleId((prev) => prev ?? id);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Toggle play/pause. Pressing play while parked at the last step either
  // advances to the next message or restarts the selected message.
  const handleTogglePlay = useCallback(() => {
    disableGraphArrangeMode();
    if (isPlaying) {
      setIsPlaying(false);
      return;
    }
    if (stepCount === 0) return;
    if (currentStepIndex >= stepCount - 1) {
      const hasNextMessage =
        currentMessageIndex >= 0 && currentMessageIndex < trace.messages.length - 1;
      if (playbackMode === "play-next-message" && hasNextMessage) {
        goToMessageStart(currentMessageIndex + 1);
      } else {
        goToStep(0);
      }
    }
    setIsPlaying(true);
  }, [
    isPlaying,
    stepCount,
    currentStepIndex,
    currentMessageIndex,
    disableGraphArrangeMode,
    trace.messages.length,
    playbackMode,
    goToMessageStart,
    goToStep,
  ]);

  const handleTogglePlaybackMode = useCallback(() => {
    disableGraphArrangeMode();
    setPlaybackMode((mode) => {
      if (mode === "stop-at-message-end") return "play-next-message";
      if (mode === "play-next-message") return "repeat-message";
      return "stop-at-message-end";
    });
  }, [disableGraphArrangeMode]);

  const handleCyclePlaybackSpeed = useCallback(() => {
    disableGraphArrangeMode();
    setPlaybackSpeed((speed) => {
      if (speed === 0.5) return 1;
      if (speed === 1) return 1.5;
      if (speed === 1.5) return 2;
      return 0.5;
    });
  }, [disableGraphArrangeMode]);

  // Auto-advance during playback. At a message boundary, stop, replay the
  // current message, or continue through the message list.
  useEffect(() => {
    if (!isPlaying) return;
    if (currentStepIndex >= stepCount - 1) {
      const timer = setTimeout(() => {
        if (playbackMode === "repeat-message") {
          goToStep(0);
          return;
        }

        const hasNextMessage =
          currentMessageIndex >= 0 && currentMessageIndex < trace.messages.length - 1;
        if (playbackMode === "play-next-message" && hasNextMessage) {
          goToMessageStart(currentMessageIndex + 1);
          return;
        }

        setIsPlaying(false);
      }, playbackIntervalMs);
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(() => goToStep(currentStepIndex + 1), playbackIntervalMs);
    return () => clearTimeout(timer);
  }, [
    isPlaying,
    stepCount,
    currentStepIndex,
    playbackIntervalMs,
    playbackMode,
    currentMessageIndex,
    trace.messages.length,
    goToMessageStart,
    goToStep,
  ]);

  useTransportKeys({
    stepIndex: currentStepIndex,
    stepCount,
    onTogglePlay: handleTogglePlay,
    onPause: pausePlayback,
    onGoToStep: goToStep,
    onGoToAdjacentMessage: goToAdjacentMessage,
    onInteract: disableGraphArrangeMode,
  });

  const payloads = useMemo(
    () => withUniqueLabels(getPayloadsForNode(currentMessage, selectedNodeId)),
    [currentMessage, selectedNodeId]
  );

  // The "current visit" of the selected node: the latest step for that node at
  // or before the playhead. Drives which payload tabs the inspector auto-selects
  // and tints — so revisiting a node in a loop surfaces that visit's newer logs
  // rather than freezing on the first visit. Falls back to the node's first
  // visit when the playhead hasn't reached it yet.
  const currentVisitStepId = useMemo(() => {
    if (!selectedNodeId) return undefined;
    for (let i = Math.min(currentStepIndex, steps.length - 1); i >= 0; i--) {
      if (steps[i]?.nodeId === selectedNodeId) return steps[i].id;
    }
    return steps.find((s) => s.nodeId === selectedNodeId)?.id;
  }, [steps, currentStepIndex, selectedNodeId]);
  const selectedNode = trace.graph.nodes.find((n) => n.id === selectedNodeId);
  const selectedNodeLabel = selectedNode?.label;

  return (
    <Box
      sx={{
        minHeight: "100dvh",
        height: { xs: "auto", md: "100%" },
        width: "100%",
        maxWidth: "100vw",
        overflowX: "hidden",
        display: "flex",
        flexDirection: "column",
        pb: {
          xs: `calc(${MOBILE_FOOTER_RESERVED_HEIGHT} + env(safe-area-inset-bottom))`,
          sm: 0,
        },
      }}
    >
      <Backdrop
        open={isLoadingUrlTrace}
        sx={{
          zIndex: (theme) => theme.zIndex.modal + 1,
          color: "primary.contrastText",
        }}
      >
        <CircularProgress aria-label="Loading trace" color="inherit" />
      </Backdrop>

      <WelcomeDialog
        open={welcomeOpen}
        onDismiss={() => setWelcomeDismissed()}
        onUploadLoad={handleUploadLoad}
        onWatchDemo={() =>
          requestExample({
            flow: flagshipExample,
            options: { autoplay: true, playThrough: true },
            toast: { step: 1, flagship: true, withSdkPitch: true },
          })
        }
        watchDemoLoading={isFlagshipLoading}
        onOpenTutorial={() => {
          setWelcomeDismissed();
          setTutorialOpen(true);
        }}
        onBrowseExamples={() => {
          setWelcomeDismissed();
          setGalleryOpen(true);
        }}
      />

      <SearchDialog
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        trace={trace}
        onJump={handleSearchJump}
      />

      <ExampleGallery
        open={galleryOpen}
        onClose={() => setGalleryOpen(false)}
        onSelect={(flow) => {
          requestExample({ flow, options: { autoplay: true } });
        }}
        currentExampleId={currentExampleId}
      />

      <ReplaceFlowDialog
        open={pendingExample !== null}
        incomingTitle={pendingExample?.flow.title}
        openFlowName={trace.name}
        onCancel={() => setPendingExample(null)}
        onOpenInNewTab={handleReplaceInNewTab}
        onOpenHere={handleReplaceHere}
      />

      <TutorialDialog
        open={tutorialOpen}
        onClose={() => setTutorialOpen(false)}
        onWatchDemo={() => {
          setTutorialOpen(false);
          requestExample({
            flow: flagshipExample,
            options: { autoplay: true, playThrough: true },
            toast: { step: 1, flagship: true, withSdkPitch: false },
          });
        }}
      />

      <DemoExplainerToast
        toast={demoToast}
        onChange={setDemoToast}
        onOpenTutorial={() => setTutorialOpen(true)}
      />

      <LoadNotices
        uploadNoticeOpen={uploadNoticeOpen}
        onCloseUploadNotice={() => setUploadNoticeOpen(false)}
        exampleErrorOpen={exampleErrorOpen}
        onCloseExampleError={() => setExampleErrorOpen(false)}
      />

      <AppHeader
        trace={trace}
        hasFlow={hasFlow}
        canClearFlow={!!savedFlow}
        isServedTrace={isServedTrace}
        isLiveWatching={isLiveWatching}
        partLinks={partLinks}
        onGoToPart={goToPart}
        onClearFlow={handleDropFlow}
        onOpenGallery={() => setGalleryOpen(true)}
        onUploadLoad={handleUploadLoad}
        onOpenTutorial={() => setTutorialOpen(true)}
        onOpenSearch={openSearch}
        isDarkMode={isDarkMode}
        onToggleColorMode={toggleColorMode}
        inspectorOpen={inspector.open}
        onToggleInspector={inspector.toggle}
        onInteract={disableGraphArrangeMode}
      />

      {/* Main area: graph + inspector. No gap — the resize handle is the
          separator, so it stays slim. */}
      <Box
        sx={{
          flex: { xs: "0 0 auto", md: 1 },
          display: "flex",
          flexDirection: { xs: "column", md: "row" },
          minHeight: 0,
          p: { xs: 1, sm: 1.5 },
          gap: { xs: 1, md: 0 },
        }}
      >
        <Paper
          sx={{
            flex: { xs: "0 0 auto", md: 1 },
            minWidth: 0,
            minHeight: { xs: 320, md: 0 },
            height: {
              xs: inspector.open
                ? "clamp(320px, 52dvh, 520px)"
                : `clamp(320px, calc(100dvh - ${MOBILE_GRAPH_CHROME_HEIGHT} - env(safe-area-inset-bottom)), 720px)`,
              md: "auto",
            },
            overflow: "hidden",
          }}
        >
          {hasFlow ? (
            <GraphCanvas
              nodes={graph.nodes}
              edges={graph.edges}
              activeNodeId={activeNodeId}
              selectedNodeId={selectedNodeId}
              recentNodeIds={recentNodeIds}
              onSelectNode={handleSelectNode}
              isPlaying={isPlaying}
              arrangeMode={graphArrangeMode}
              onArrangeModeChange={setGraphArrangeMode}
            />
          ) : (
            <EmptyCanvas
              onUploadLoad={handleUploadLoad}
              onOpenGallery={() => setGalleryOpen(true)}
            />
          )}
        </Paper>
        {inspector.open && (
          <>
            <Box
              onMouseDown={inspector.startResize}
              sx={{
                display: { xs: "none", md: "block" },
                width: 6,
                flexShrink: 0,
                alignSelf: "stretch",
                cursor: "col-resize",
                borderRadius: 1,
                bgcolor: "transparent",
                transition: "background-color 120ms",
                "&:hover": { bgcolor: "primary.main" },
              }}
            />
            <Paper
              onClickCapture={disableGraphArrangeMode}
              sx={{
                width: { xs: "100%", md: inspector.width },
                height: { xs: 320, md: "auto" },
                flexShrink: 0,
                overflow: "hidden",
              }}
            >
              {/* While maximized the panel lives in the fullscreen Dialog
                  below instead — rendering it in both places would fork its
                  internal tab state. */}
              {!inspector.maximized && (
                <InspectorPanel
                  selectedNodeId={selectedNodeId}
                  selectedNodeLabel={selectedNodeLabel}
                  selectedNodeDescription={selectedNode?.description}
                  payloads={payloads}
                  currentVisitStepId={currentVisitStepId}
                  maximized={false}
                  onMaximizedChange={inspector.setMaximized}
                  focusPayload={inspector.focus}
                />
              )}
            </Paper>
            <Dialog
              fullScreen
              open={inspector.maximized}
              onClose={() => inspector.setMaximized(false)}
            >
              <InspectorPanel
                selectedNodeId={selectedNodeId}
                selectedNodeLabel={selectedNodeLabel}
                selectedNodeDescription={selectedNode?.description}
                payloads={payloads}
                currentVisitStepId={currentVisitStepId}
                maximized
                onMaximizedChange={inspector.setMaximized}
                focusPayload={inspector.focus}
              />
            </Dialog>
          </>
        )}
      </Box>

      {/* Footer: timeline + playback */}
      <Paper
        square
        onClickCapture={disableGraphArrangeMode}
        sx={{
          borderTop: 1,
          borderColor: "divider",
          position: { xs: "fixed", sm: "static" },
          right: { xs: 0, sm: "auto" },
          bottom: { xs: 0, sm: "auto" },
          left: { xs: 0, sm: "auto" },
          width: { xs: "100vw", sm: "auto" },
          maxWidth: "100vw",
          overflowX: "hidden",
          zIndex: (theme) => theme.zIndex.appBar,
          pb: { xs: "env(safe-area-inset-bottom)", sm: 0 },
        }}
      >
        <MessageTimeline
          messages={trace.messages}
          selectedMessageId={selectedMessageId}
          onSelectMessage={handleSelectMessage}
          newMessageCount={newLiveMessageCount}
          onJumpToNewest={handleJumpToNewest}
        />
        <PlaybackControls
          stepIndex={currentStepIndex}
          stepCount={stepCount}
          isPlaying={isPlaying}
          playbackMode={playbackMode}
          playbackSpeed={playbackSpeed}
          deltaMs={currentDeltaMs}
          elapsedMs={currentElapsedMs}
          onPrev={() => {
            disableGraphArrangeMode();
            goToStep(currentStepIndex - 1);
          }}
          onNext={() => {
            disableGraphArrangeMode();
            goToStep(currentStepIndex + 1);
          }}
          onTogglePlay={handleTogglePlay}
          onTogglePlaybackMode={handleTogglePlaybackMode}
          onCyclePlaybackSpeed={handleCyclePlaybackSpeed}
          onSeek={(index) => {
            disableGraphArrangeMode();
            setIsPlaying(false);
            goToStep(index);
          }}
        />
        <FooterLinks onOpenTutorial={() => setTutorialOpen(true)} />
      </Paper>
    </Box>
  );
}
