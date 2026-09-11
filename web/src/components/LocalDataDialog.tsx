"use client";

import Box from "@mui/material/Box";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import CloseIcon from "@mui/icons-material/Close";
import { LocalDataDetails } from "@/components/TutorialDialog";

type LocalDataDialogProps = {
  open: boolean;
  onClose: () => void;
};

export default function LocalDataDialog({ open, onClose }: LocalDataDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      aria-labelledby="local-data-dialog-title"
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle
        id="local-data-dialog-title"
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1,
          pb: 1,
        }}
      >
        Your data stays local
        <IconButton size="small" onClick={onClose} aria-label="Close">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ pb: 3 }}>
        <Box sx={{ display: "grid", gap: 3 }}>
          <LocalDataDetails />
          <Box sx={{ display: "grid", gap: 1.5 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              The trace is just a file
            </Typography>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ lineHeight: 1.7 }}
            >
              WizardFlow records agent runs as plain JSONL files. You can send
              them to a teammate, attach them to a bug report, commit them,
              diff them, and replay them locally or in this browser. No
              account, trace server, or database is required.
            </Typography>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ lineHeight: 1.7 }}
            >
              Observability platforms are designed for centralized monitoring,
              team dashboards, and hosted evaluations. WizardFlow focuses on
              portable traces and replaying individual runs, making it ideal
              for prototyping agent flows.
            </Typography>
          </Box>
        </Box>
      </DialogContent>
    </Dialog>
  );
}
