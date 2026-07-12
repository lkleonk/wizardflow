"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Box from "@mui/material/Box";
import Backdrop from "@mui/material/Backdrop";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Collapse from "@mui/material/Collapse";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Paper from "@mui/material/Paper";
import Popover from "@mui/material/Popover";
import Snackbar from "@mui/material/Snackbar";
import Alert from "@mui/material/Alert";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import ViewSidebarOutlinedIcon from "@mui/icons-material/ViewSidebarOutlined";
import GridViewOutlinedIcon from "@mui/icons-material/GridViewOutlined";
import MenuBookOutlinedIcon from "@mui/icons-material/MenuBookOutlined";
import LightModeOutlinedIcon from "@mui/icons-material/LightModeOutlined";
import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined";
import CloseIcon from "@mui/icons-material/Close";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import { useColorScheme } from "@mui/material/styles";
import GraphCanvas from "@/components/GraphCanvas";
import InspectorPanel from "@/components/InspectorPanel";
import MessageTimeline from "@/components/MessageTimeline";
import PlaybackControls, {
  type PlaybackMode,
  type PlaybackSpeed,
} from "@/components/PlaybackControls";
import TraceDropTarget from "@/components/TraceDropTarget";
import TraceUploader from "@/components/TraceUploader";
import TraceInfo from "@/components/TraceInfo";
import ExampleGallery from "@/components/ExampleGallery";
import TutorialDialog, { LocalDataDetails } from "@/components/TutorialDialog";
import DemoExplainerToast, {
  type DemoToastState,
} from "@/components/DemoExplainerToast";
import { emptyTrace, exampleFlows } from "@/data";
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
import { withUniqueLabels } from "@/utils/payloadLabels";
import { isHostedWizardFlow } from "@/utils/deploymentTarget";
import { parseAgentTrace } from "@/utils/agentTraceFile";

const PLAYBACK_INTERVAL_MS = 1200;
const MOBILE_FOOTER_RESERVED_HEIGHT = "168px";
const MOBILE_GRAPH_CHROME_HEIGHT = "274px";
const PYTHON_SDK_QUICKSTART_URL =
  "https://github.com/lkleonk/wizardflow/tree/main/sdk/python#quickstart";

// The flow behind "Watch a demo replay" (welcome + tutorial) and the default
// the docs deep-link to: the most approachable bundled example — a simulated
// doctor's visit whose story (interview, diagnosis, allergy-checked
// prescription, overnight lab results) needs no developer vocabulary.
const FLAGSHIP_EXAMPLE_ID = "doctor-consultation";
const flagshipExample =
  exampleFlows.find((flow) => flow.id === FLAGSHIP_EXAMPLE_ID) ?? exampleFlows[0];

const footerLinks = [
  ...(isHostedWizardFlow
    ? [
        { href: "/impressum", label: "Impressum", external: false },
        { href: "/datenschutz", label: "Datenschutz", external: false },
      ]
    : []),
  { href: "https://github.com/lkleonk/wizardflow", label: "GitHub", external: true },
] as const;

function WizardHatMark() {
  return (
    <Box
      aria-hidden
      component="svg"
      viewBox="0 0 72 72"
      sx={{
        display: "block",
        width: 72,
        height: 72,
        // Soft halo that drifts and breathes behind the hat. The orbit and the
        // pulse live on separate elements with different durations so the
        // motion never settles into an obvious repeating beat. transform-box
        // keeps each transform centered on the glow, not the SVG origin.
        "@keyframes wizardGlowPulse": {
          "0%, 100%": { opacity: 0.3, transform: "scale(0.88)" },
          "50%": { opacity: 0.85, transform: "scale(1.12)" },
        },
        "@keyframes wizardGlowOrbit": {
          "0%": { transform: "translate(-3px, -2px)" },
          "25%": { transform: "translate(3px, -3px)" },
          "50%": { transform: "translate(4px, 2px)" },
          "75%": { transform: "translate(-3px, 3px)" },
          "100%": { transform: "translate(-3px, -2px)" },
        },
        "& .wizard-glow-orbit": {
          transformBox: "fill-box",
          transformOrigin: "center",
          animation: "wizardGlowOrbit 5s ease-in-out infinite",
        },
        "& .wizard-glow": {
          transformBox: "fill-box",
          transformOrigin: "center",
          animation: "wizardGlowPulse 2.4s ease-in-out infinite",
        },
        "@media (prefers-reduced-motion: reduce)": {
          "& .wizard-glow-orbit, & .wizard-glow": { animation: "none" },
          "& .wizard-glow": { opacity: 0.55 },
        },
      }}
    >
      <defs>
        <radialGradient id="wizardGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#A78BFA" stopOpacity="0.75" />
          <stop offset="55%" stopColor="#60A5FA" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#22D3EE" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="wizardCone" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#C4B5FD" />
          <stop offset="100%" stopColor="#6D28D9" />
        </linearGradient>
        <linearGradient id="wizardBrim" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#67E8F9" />
          <stop offset="100%" stopColor="#0E7490" />
        </linearGradient>
        <clipPath id="wizardClip">
          <rect width="72" height="72" rx="18" />
        </clipPath>
      </defs>

      <rect width="72" height="72" rx="18" fill="var(--mui-palette-background-paper)" />

      <g clipPath="url(#wizardClip)">
        <g className="wizard-glow-orbit">
          <circle className="wizard-glow" cx="36" cy="33" r="27" fill="url(#wizardGlow)" />
        </g>
      </g>

      {/* Brim: full ellipse; the cone sits on top so only the sides and front
          edge show, like a real hat. */}
      <ellipse
        cx="36"
        cy="50"
        rx="22"
        ry="6"
        fill="url(#wizardBrim)"
        stroke="#155E75"
        strokeWidth="1.5"
      />

      {/* Cone with a slightly bent tip and concave edges for a softer,
          more believable wizard-hat silhouette. */}
      <path
        d="M27 49 C 29 37, 32 23, 40 13 C 43 22, 45 37, 45 50 C 39 53, 33 53, 27 49 Z"
        fill="url(#wizardCone)"
        stroke="#5B21B6"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />

      {/* Gold hatband nestled where the cone meets the brim. */}
      <path
        d="M27.5 48 C 33 51, 39 51, 44.5 48 L 45 50.5 C 39 53, 33 53, 27 50.5 Z"
        fill="#FBBF24"
        stroke="#B45309"
        strokeWidth="0.75"
        strokeLinejoin="round"
      />

      {/* Sparkle near the tip plus a couple of faint stars on the cone. */}
      <path
        d="M50 14L52 18.5L56.5 20.5L52 22.5L50 27L48 22.5L43.5 20.5L48 18.5L50 14Z"
        fill="#F0ABFC"
      />
      <circle cx="34" cy="34" r="2.4" fill="#FFFFFF" fillOpacity="0.9" />
      <circle cx="39" cy="42" r="2" fill="#FFFFFF" fillOpacity="0.85" />
    </Box>
  );
}

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
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [inspectorWidth, setInspectorWidth] = useState(360);
  const [graphArrangeMode, setGraphArrangeMode] = useState(false);
  const [isLoadingUrlTrace, setIsLoadingUrlTrace] = useState(false);
  const loadedTraceUrlRef = useRef<string | null>(null);
  // Set when a flow is loaded with `autoplay` (examples); consumed by the
  // render-time reset below so playback starts the moment the flow lands.
  const [pendingAutoplay, setPendingAutoplay] = useState(false);
  const exampleParamHandledRef = useRef(false);

  const disableGraphArrangeMode = useCallback(() => {
    setGraphArrangeMode(false);
  }, []);

  // The welcome dialog shows until the user makes their first choice this
  // session (then it's remembered), and never while a saved flow is loaded.
  const welcomeDismissed = useSyncExternalStore(
    subscribeWelcomeDismissed,
    getWelcomeDismissed,
    getServerWelcomeDismissed
  );
  const welcomeOpen = !welcomeDismissed && !savedFlow && !isLoadingUrlTrace;

  // The example-flow picker (a gallery dialog opened from the header).
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [offlineTipOpen, setOfflineTipOpen] = useState(false);

  // Explainer toast shown over a freshly started demo replay (see
  // DemoExplainerToast). Armed by the demo entry points: the welcome dialog
  // and `?example=` deep links show both parts, the tutorial's demo button
  // only part 1. Gallery picks and uploads show nothing.
  const [demoToast, setDemoToast] = useState<DemoToastState | null>(null);

  // Post-load confirmation for user-file loads (upload button, drag & drop):
  // doubles as load feedback and as the "nothing was uploaded" reassurance at
  // the moment it matters. Example/SDK-launcher loads don't show it.
  const [uploadNoticeOpen, setUploadNoticeOpen] = useState(false);

  // Anchor for the footer "Data stays local" popover (LocalDataDetails).
  const [localDataAnchor, setLocalDataAnchor] = useState<HTMLElement | null>(
    null
  );

  // Re-seed the viewing position whenever the active flow changes: a saved flow
  // restored just after hydration, a fresh upload, or dropping back to the
  // empty state. Done during render (tracking the previous flow) rather than in an
  // effect, per React guidance.
  const [lastFlow, setLastFlow] = useState(trace);
  if (trace !== lastFlow) {
    setLastFlow(trace);
    setSelectedMessageId(trace.messages[0]?.id);
    setCurrentStepIndex(0);
    setSelectedNodeId(orderedSteps(trace.messages[0])[0]?.nodeId);
    setIsPlaying(pendingAutoplay);
    if (pendingAutoplay) setPendingAutoplay(false);
    setGraphArrangeMode(false);
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
      disableGraphArrangeMode();
      syncExampleParam(options?.exampleId);
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
    disableGraphArrangeMode();
    syncExampleParam(undefined);
    setPendingAutoplay(false);
    setDemoToast(null);
    setSavedFlow(null);
  }, [disableGraphArrangeMode, syncExampleParam]);

  // Local SDK launcher support: `wizardflow ui trace.json` serves the bundled
  // static app and opens `/?trace=/__wizardflow_trace.json&traceName=...`.
  // Keep this same-origin only; the hosted website should not become a generic
  // cross-origin JSON fetcher just because a query string says so.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const traceParam = params.get("trace");
    if (!traceParam) return;

    const traceUrl = new URL(traceParam, window.location.href);
    if (traceUrl.origin !== window.location.origin) {
      alert("Trace URLs must be served from the same origin as WizardFlow.");
      return;
    }
    const traceHref = traceUrl.href;
    if (loadedTraceUrlRef.current === traceHref) return;
    loadedTraceUrlRef.current = traceHref;

    let cancelled = false;
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

        const traceName = params.get("traceName");
        handleLoadTrace(traceName ? { ...parsed, name: traceName } : parsed);
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
      if (loadedTraceUrlRef.current === traceHref) {
        loadedTraceUrlRef.current = null;
      }
    };
  }, [handleLoadTrace]);

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
      if (!example) return;
      handleLoadTrace(example.trace, {
        autoplay: true,
        playThrough: true,
        exampleId: example.id,
      });
      // A deep-link visitor skipped the welcome dialog entirely, so they get
      // the full explainer toast.
      setDemoToast({
        step: 1,
        flagship: example.id === FLAGSHIP_EXAMPLE_ID,
        withSdkPitch: true,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [handleLoadTrace]);

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

  // Keyboard transport: Space = play/pause, ←/→ = step, Home/End = jump.
  // Up/down switches to the previous/next message.
  // Ignored while typing or when a button/input is focused (so it doesn't
  // double-fire with the focused control or hijack text entry).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "BUTTON" ||
          target.isContentEditable)
      ) {
        return;
      }
      switch (e.key) {
        case " ":
          e.preventDefault();
          handleTogglePlay();
          break;
        case "ArrowLeft":
          e.preventDefault();
          disableGraphArrangeMode();
          goToStep(currentStepIndex - 1);
          break;
        case "ArrowRight":
          e.preventDefault();
          disableGraphArrangeMode();
          goToStep(currentStepIndex + 1);
          break;
        case "ArrowUp":
          e.preventDefault();
          goToAdjacentMessage(-1);
          break;
        case "ArrowDown":
          e.preventDefault();
          goToAdjacentMessage(1);
          break;
        case "Home":
          e.preventDefault();
          disableGraphArrangeMode();
          setIsPlaying(false);
          goToStep(0);
          break;
        case "End":
          e.preventDefault();
          disableGraphArrangeMode();
          setIsPlaying(false);
          goToStep(stepCount - 1);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    handleTogglePlay,
    disableGraphArrangeMode,
    goToStep,
    goToAdjacentMessage,
    currentStepIndex,
    stepCount,
  ]);

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

  // Drag the handle on the inspector's left edge to resize it (clamped).
  const startInspectorResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      disableGraphArrangeMode();
      const startX = e.clientX;
      const startWidth = inspectorWidth;
      const onMove = (ev: MouseEvent) => {
        const next = startWidth + (startX - ev.clientX); // drag left → wider
        setInspectorWidth(Math.max(280, Math.min(720, next)));
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.userSelect = "";
      };
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [disableGraphArrangeMode, inspectorWidth]
  );

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

      <Dialog
        open={welcomeOpen}
        onClose={() => setWelcomeDismissed()}
        aria-labelledby="welcome-dialog-title"
        maxWidth="sm"
        fullWidth
      >
        <TraceDropTarget onLoad={handleUploadLoad}>
        <DialogTitle id="welcome-dialog-title" sx={{ pb: 1 }}>
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 1.5,
              pt: 1,
              textAlign: "center",
            }}
          >
            <WizardHatMark />
            <Typography component="span" variant="h5" sx={{ fontWeight: 700 }}>
              WizardFlow
            </Typography>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ textAlign: "center" }}>
          <Typography color="text.secondary" sx={{ lineHeight: 1.7 }}>
            Replay recorded agent flows as messages moving through a graph,
            with node payloads and timing shown step by step.
          </Typography>
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 1,
              mt: 3,
            }}
          >
            <Button
              size="large"
              variant="contained"
              startIcon={<PlayArrowRoundedIcon />}
              onClick={() => {
                handleLoadTrace(flagshipExample.trace, {
                  autoplay: true,
                  playThrough: true,
                  exampleId: flagshipExample.id,
                });
                setDemoToast({ step: 1, flagship: true, withSdkPitch: true });
              }}
              sx={{ width: { xs: "100%", sm: 320 } }}
            >
              Watch a demo replay
            </Button>
            <Box
              sx={{
                display: "flex",
                flexDirection: { xs: "column", sm: "row" },
                gap: 1,
                width: { xs: "100%", sm: 320 },
              }}
            >
              <TraceUploader
                onLoad={handleUploadLoad}
                label="Upload trace"
                size="medium"
                variant="outlined"
                sx={{ flex: 1, width: { xs: "100%", sm: "auto" } }}
              />
              <Button
                size="medium"
                variant="outlined"
                startIcon={<MenuBookOutlinedIcon />}
                onClick={() => {
                  setWelcomeDismissed();
                  setTutorialOpen(true);
                }}
                sx={{ flex: 1, width: { xs: "100%", sm: "auto" } }}
              >
                Tutorial
              </Button>
            </Box>
            <Button
              variant="text"
              size="small"
              onClick={() => {
                setWelcomeDismissed();
                setGalleryOpen(true);
              }}
              sx={{ textTransform: "none", color: "text.secondary" }}
            >
              More demos: Browse examples →
            </Button>
          </Box>
          <Typography
            color="text.secondary"
            variant="body2"
            sx={{ lineHeight: 1.7, mt: 2.5 }}
          >
            Your flow stays in your browser. Imported traces are processed
            locally and never uploaded — and are kept only for this tab.
          </Typography>
          <Button
            variant="text"
            size="small"
            onClick={() => setOfflineTipOpen((open) => !open)}
            aria-expanded={offlineTipOpen}
            endIcon={
              <ExpandMoreIcon
                sx={{
                  transition: "transform 0.2s",
                  transform: offlineTipOpen ? "rotate(180deg)" : "none",
                }}
              />
            }
            sx={{ mt: 1, textTransform: "none", color: "text.secondary" }}
          >
            How to ensure data stays local
          </Button>
          <Collapse in={offlineTipOpen}>
            <Box sx={{ mt: 1 }}>
              <LocalDataDetails />
            </Box>
          </Collapse>
        </DialogContent>
        <DialogActions
          disableSpacing
          sx={{
            justifyContent: "center",
            flexDirection: "column",
            gap: 1,
            px: 3,
            pb: 3,
            pt: 1,
          }}
        >
          <Typography
            component="a"
            href={PYTHON_SDK_QUICKSTART_URL}
            target="_blank"
            rel="noreferrer"
            variant="body2"
            sx={{
              color: "text.secondary",
              textDecoration: "none",
              "&:hover": {
                color: "primary.main",
                textDecoration: "underline",
              },
            }}
          >
            Need a flow file? Use the Python SDK
          </Typography>
        </DialogActions>
        </TraceDropTarget>
      </Dialog>

      <ExampleGallery
        open={galleryOpen}
        onClose={() => setGalleryOpen(false)}
        onSelect={(flow) =>
          handleLoadTrace(flow.trace, { autoplay: true, exampleId: flow.id })
        }
        currentName={trace.name}
      />

      <TutorialDialog
        open={tutorialOpen}
        onClose={() => setTutorialOpen(false)}
        onWatchDemo={() => {
          setTutorialOpen(false);
          handleLoadTrace(flagshipExample.trace, {
            autoplay: true,
            playThrough: true,
            exampleId: flagshipExample.id,
          });
          setDemoToast({ step: 1, flagship: true, withSdkPitch: false });
        }}
      />

      <DemoExplainerToast
        toast={demoToast}
        onChange={setDemoToast}
        onOpenTutorial={() => setTutorialOpen(true)}
      />

      {/* Load feedback for user files, doubling as the privacy reassurance
          right after the moment of doubt. Same anchor slot as the demo toast;
          the two can't overlap since loading a file clears the demo toast. */}
      <Snackbar
        open={uploadNoticeOpen}
        anchorOrigin={{ vertical: "top", horizontal: "center" }}
        autoHideDuration={6000}
        onClose={() => setUploadNoticeOpen(false)}
        sx={{ top: { xs: 104, sm: 76 } }}
      >
        <Alert
          severity="success"
          onClose={() => setUploadNoticeOpen(false)}
          sx={{ maxWidth: 480 }}
        >
          Trace loaded. Processed locally; nothing was sent to a server.
        </Alert>
      </Snackbar>

      {/* Header */}
      <Box
        onClickCapture={disableGraphArrangeMode}
        sx={{
          display: "flex",
          flexDirection: { xs: "column", sm: "row" },
          alignItems: { xs: "stretch", sm: "center" },
          justifyContent: "space-between",
          gap: 1,
          px: { xs: 1, sm: 2 },
          py: { xs: 1, sm: 1.25 },
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: { xs: "space-between", sm: "flex-start" },
            gap: 1,
            minWidth: 0,
            width: { xs: "100%", sm: "auto" },
          }}
        >
          <Box
            sx={{
              display: "flex",
              alignItems: "baseline",
              gap: 1,
              minWidth: 0,
              overflow: "hidden",
            }}
          >
            <Typography
              variant="h6"
              sx={{ flexShrink: 0, fontWeight: 600, letterSpacing: -0.2 }}
            >
              WizardFlow
            </Typography>
            {trace.name && (
              <>
                <Typography component="span" color="text.secondary">
                  /
                </Typography>
                <Typography
                  component="span"
                  color="text.secondary"
                  noWrap
                  title={trace.name}
                  sx={{
                    minWidth: 0,
                    fontFamily: "var(--font-geist-mono), monospace",
                    fontSize: 13,
                  }}
                >
                  {trace.name}
                </Typography>
              </>
            )}
          </Box>
          {/* Flow actions sit together as a tight, center-aligned cluster so the
              info and clear icons read as a pair rather than drifting apart. */}
          <Box sx={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
            <TraceInfo trace={trace} />
            {savedFlow && (
              <Tooltip title="Clear flow">
                <IconButton
                  size="small"
                  onClick={handleDropFlow}
                  aria-label="Clear flow"
                  sx={{ color: "text.secondary" }}
                >
                  <CloseIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        </Box>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: { xs: "flex-end", sm: "flex-start" },
            gap: 1,
            flexWrap: "wrap",
            width: { xs: "100%", sm: "auto" },
          }}
        >
          <Button
            size="small"
            variant="outlined"
            startIcon={<GridViewOutlinedIcon />}
            onClick={() => setGalleryOpen(true)}
          >
            Examples
          </Button>
          <TraceUploader onLoad={handleUploadLoad} />
          <Tooltip
            title={isDarkMode ? "Switch to light mode" : "Switch to dark mode"}
          >
            <IconButton
              size="small"
              onClick={toggleColorMode}
              aria-label="Toggle color mode"
            >
              {isDarkMode ? (
                <LightModeOutlinedIcon fontSize="small" />
              ) : (
                <DarkModeOutlinedIcon fontSize="small" />
              )}
            </IconButton>
          </Tooltip>
          <Tooltip title={inspectorOpen ? "Hide inspector" : "Show inspector"}>
            <IconButton
              size="small"
              onClick={() => setInspectorOpen((open) => !open)}
              color={inspectorOpen ? "primary" : "default"}
              aria-label="Toggle inspector panel"
            >
              <ViewSidebarOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

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
              xs: inspectorOpen
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
              onSelectNode={setSelectedNodeId}
              isPlaying={isPlaying}
              arrangeMode={graphArrangeMode}
              onArrangeModeChange={setGraphArrangeMode}
            />
          ) : (
            <TraceDropTarget
              onLoad={handleUploadLoad}
              sx={{
                height: "100%",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 1.5,
                p: 3,
                textAlign: "center",
              }}
            >
              <GridViewOutlinedIcon
                sx={{ fontSize: 40, color: "text.disabled" }}
              />
              <Typography variant="h6" sx={{ fontWeight: 600 }}>
                No flow loaded
              </Typography>
              <Typography color="text.secondary" sx={{ maxWidth: 360 }}>
                Pick a bundled example or upload your own agent trace
                (.jsonl or .json) to start replaying it.
              </Typography>
              <Box
                sx={{
                  display: "flex",
                  flexDirection: { xs: "column", sm: "row" },
                  gap: 1,
                  mt: 0.5,
                  width: { xs: "100%", sm: "auto" },
                  maxWidth: 360,
                }}
              >
                <Button
                  variant="contained"
                  startIcon={<GridViewOutlinedIcon />}
                  onClick={() => setGalleryOpen(true)}
                  sx={{ width: { xs: "100%", sm: "auto" } }}
                >
                  Browse examples
                </Button>
                <TraceUploader
                  onLoad={handleUploadLoad}
                  sx={{ width: { xs: "100%", sm: "auto" } }}
                />
              </Box>
            </TraceDropTarget>
          )}
        </Paper>
        {inspectorOpen && (
          <>
            <Box
              onMouseDown={startInspectorResize}
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
                width: { xs: "100%", md: inspectorWidth },
                height: { xs: 320, md: "auto" },
                flexShrink: 0,
                overflow: "hidden",
              }}
            >
              <InspectorPanel
                selectedNodeId={selectedNodeId}
                selectedNodeLabel={selectedNodeLabel}
                selectedNodeDescription={selectedNode?.description}
                payloads={payloads}
                currentVisitStepId={currentVisitStepId}
              />
            </Paper>
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
        <Box
          component="nav"
          aria-label="Project links"
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: { xs: 0.75, sm: 1.5 },
            px: { xs: 1, sm: 2 },
            pb: { xs: 0.5, sm: 0.75 },
            color: "text.secondary",
            fontSize: { xs: 11, sm: 12 },
            lineHeight: 1.4,
          }}
        >
          <Box
            component="button"
            type="button"
            onClick={() => setTutorialOpen(true)}
            sx={{
              p: 0,
              border: 0,
              bgcolor: "transparent",
              color: "inherit",
              font: "inherit",
              lineHeight: "inherit",
              cursor: "pointer",
              textDecoration: "none",
              "&:hover": {
                color: "primary.main",
                textDecoration: "underline",
              },
              "&:focus-visible": {
                outline: "2px solid",
                outlineColor: "primary.main",
                outlineOffset: 2,
                borderRadius: 0.5,
              },
            }}
          >
            Tutorial
          </Box>
          <Box component="span" aria-hidden sx={{ opacity: 0.55 }}>
            /
          </Box>
          {/* Persistent home of the privacy message: always visible, so the
              reassurance is one click away at the moment someone hesitates
              over the Upload button. Same popover affordance as TraceInfo. */}
          <Box
            component="button"
            type="button"
            onClick={(e: React.MouseEvent<HTMLElement>) =>
              setLocalDataAnchor(e.currentTarget)
            }
            sx={{
              p: 0,
              border: 0,
              bgcolor: "transparent",
              color: "inherit",
              font: "inherit",
              lineHeight: "inherit",
              cursor: "pointer",
              textDecoration: "none",
              "&:hover": {
                color: "primary.main",
                textDecoration: "underline",
              },
              "&:focus-visible": {
                outline: "2px solid",
                outlineColor: "primary.main",
                outlineOffset: 2,
                borderRadius: 0.5,
              },
            }}
          >
            Data stays local
          </Box>
          <Popover
            open={Boolean(localDataAnchor)}
            anchorEl={localDataAnchor}
            onClose={() => setLocalDataAnchor(null)}
            anchorOrigin={{ vertical: "top", horizontal: "center" }}
            transformOrigin={{ vertical: "bottom", horizontal: "center" }}
          >
            <Box sx={{ p: 2, maxWidth: 400 }}>
              <LocalDataDetails />
            </Box>
          </Popover>
          {footerLinks.map((link) => (
            <Fragment key={link.href}>
              <Box component="span" aria-hidden sx={{ opacity: 0.55 }}>
                /
              </Box>
              <Box
                component="a"
                href={link.href}
                target={link.external ? "_blank" : undefined}
                rel={link.external ? "noreferrer" : undefined}
                sx={{
                  color: "inherit",
                  textDecoration: "none",
                  "&:hover": {
                    color: "primary.main",
                    textDecoration: "underline",
                  },
                }}
              >
                {link.label}
              </Box>
            </Fragment>
          ))}
        </Box>
      </Paper>
    </Box>
  );
}
