"use client";

import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Snackbar from "@mui/material/Snackbar";
import Typography from "@mui/material/Typography";
import CloseIcon from "@mui/icons-material/Close";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";

/**
 * State of the explainer toast shown over a freshly started demo replay.
 * Owned by the page (which arms it from the demo entry points and clears it
 * when the flow changes); this component only renders it and reports changes.
 */
export type DemoToastState = {
  step: 1 | 2;
  // Doctor-specific wording for the flagship demo, generic otherwise
  // (a deep link can point at any bundled example).
  flagship: boolean;
  // The welcome dialog and `?example=` deep links show both parts; the
  // tutorial's demo button only part 1 (its viewer just came from the
  // tutorial the SDK pitch links to).
  withSdkPitch: boolean;
  // Set once the user pages manually (Next or a dot): from then on nothing
  // auto-advances or auto-hides.
  pinned?: boolean;
};

type DemoExplainerToastProps = {
  toast: DemoToastState | null;
  onChange: (toast: DemoToastState | null) => void;
  onOpenTutorial: () => void;
};

/**
 * Two-part onboarding toast for demo replays. Part 1 says what's playing and
 * points at the inspector; part 2 pitches recording your own agent with the
 * SDK. Part 1 auto-advances after 9s; part 2 stays until dismissed.
 */
export default function DemoExplainerToast({
  toast,
  onChange,
  onOpenTutorial,
}: DemoExplainerToastProps) {
  // Timeout advances part 1 → part 2 (when armed); X, Escape, and the
  // Tutorial button dismiss outright. Clicking around the app deliberately
  // does not — the toast invites exploring the graph while it's up.
  const handleClose = (_: React.SyntheticEvent | Event, reason?: string) => {
    if (reason === "clickaway") return;
    if (!toast) return;
    if (reason === "timeout" && toast.step === 1 && toast.withSdkPitch) {
      onChange({ ...toast, step: 2 });
      return;
    }
    onChange(null);
  };

  return (
    // Keyed on the step so part 2 re-runs the grow transition. Anchored below
    // the header so it floats over the graph, away from the transport and
    // inspector.
    <Snackbar
      key={toast?.step ?? 0}
      open={toast !== null}
      anchorOrigin={{ vertical: "top", horizontal: "center" }}
      autoHideDuration={toast?.step === 1 && !toast.pinned ? 9000 : null}
      onClose={handleClose}
      sx={{ top: { xs: 104, sm: 76 } }}
    >
      <Alert
        severity="info"
        sx={{
          maxWidth: 480,
          alignItems: "flex-start",
          // Let the message column (and the pager row inside it) take the
          // full width next to the icon and the close button.
          "& .MuiAlert-message": { flex: 1, minWidth: 0 },
        }}
        action={
          <IconButton
            size="small"
            color="inherit"
            aria-label="Dismiss"
            onClick={() => onChange(null)}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        }
      >
        {toast?.step === 2 ? (
          <>
            <AlertTitle>Record your own agent</AlertTitle>
            Building your own agent or multi-agent flow in Python? A few{" "}
            <Box
              component="code"
              sx={{
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: "0.85em",
              }}
            >
              wizardflow.log()
            </Box>{" "}
            calls produce a trace like this one. Upload it here or open it
            straight from the CLI.
            {/* The privacy note rides on the upload pitch: this is the moment
                the "where does my trace go?" question forms, and deep-link
                visitors never saw the welcome dialog's longer version. */}
            <Typography
              variant="caption"
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.5,
                mt: 1,
                opacity: 0.8,
              }}
            >
              <LockOutlinedIcon sx={{ fontSize: 14 }} />
              Traces stay on your device and are never sent to a server.
            </Typography>
          </>
        ) : (
          <>
            <AlertTitle>Demo replay</AlertTitle>
            {toast?.flagship
              ? "You're watching a recorded run of a doctor-consultation agent."
              : "You're watching a recorded agent run."}{" "}
            Click any node in the graph and the inspector panel shows exactly
            what that node logged at each step.
          </>
        )}
        {/* Footer only when both parts exist. Wizard-style navigation:
            part 1 has just Next on the right (no back from the first step),
            part 2 has Back left and Tutorial right. Any manual step change
            pins the toast open. */}
        {toast?.withSdkPitch && (
          <Box
            sx={{
              mt: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: toast.step === 2 ? "space-between" : "flex-end",
              gap: 1,
            }}
          >
            {toast.step === 2 && (
              <Button
                color="inherit"
                size="small"
                onClick={() => onChange({ ...toast, step: 1, pinned: true })}
              >
                Back
              </Button>
            )}
            {toast.step === 1 ? (
              <Button
                color="inherit"
                size="small"
                onClick={() => onChange({ ...toast, step: 2, pinned: true })}
              >
                Next
              </Button>
            ) : (
              <Button
                color="inherit"
                size="small"
                onClick={() => {
                  onChange(null);
                  onOpenTutorial();
                }}
              >
                Tutorial
              </Button>
            )}
          </Box>
        )}
      </Alert>
    </Snackbar>
  );
}
