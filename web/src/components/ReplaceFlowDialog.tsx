import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Typography from "@mui/material/Typography";
import OpenInNewRoundedIcon from "@mui/icons-material/OpenInNewRounded";

type ReplaceFlowDialogProps = {
  open: boolean;
  /** Title of the example the user picked. */
  incomingTitle?: string;
  /** Name of the flow that would be closed, if it has one. */
  openFlowName?: string;
  onCancel: () => void;
  onOpenInNewTab: () => void;
  onOpenHere: () => void;
};

// Guard for the one destructive thing the gallery does. The session store
// holds a single flow, so an example overwrites whatever is open, and the app
// can't put a user's own trace back — the file it came from isn't readable
// again without the user picking it. The caller only opens this when the flow
// on screen is theirs; swapping one example for another is free.
export default function ReplaceFlowDialog({
  open,
  incomingTitle,
  openFlowName,
  onCancel,
  onOpenInNewTab,
  onOpenHere,
}: ReplaceFlowDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      maxWidth="xs"
      fullWidth
      aria-labelledby="replace-trace-title"
    >
      <DialogTitle id="replace-trace-title">Replace the open trace?</DialogTitle>
      <DialogContent>
        <Typography color="text.secondary" sx={{ lineHeight: 1.7 }}>
          Opening{" "}
          <Box component="span" sx={{ color: "text.primary", fontWeight: 600 }}>
            {incomingTitle}
          </Box>{" "}
          closes{" "}
          <Box component="span" sx={{ color: "text.primary", fontWeight: 600 }}>
            {openFlowName || "your trace"}
          </Box>
          . WizardFlow holds one flow at a time, so you would have to open
          your trace again — or open the example in a new tab and keep both.
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, flexWrap: "wrap", gap: 1 }}>
        <Button
          size="small"
          color="inherit"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button
          size="small"
          variant="outlined"
          startIcon={<OpenInNewRoundedIcon />}
          onClick={onOpenInNewTab}
        >
          New tab
        </Button>
        <Button
          size="small"
          variant="contained"
          onClick={onOpenHere}
        >
          Open here
        </Button>
      </DialogActions>
    </Dialog>
  );
}
