"use client";

import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import CloseIcon from "@mui/icons-material/Close";
import { exampleFlows } from "@/data";
import type { AgentTraceFile } from "@/types/agenttrace";
import { visibleGraph } from "@/utils/traceSelectors";

type ExampleGalleryProps = {
  open: boolean;
  onClose: () => void;
  onSelect: (trace: AgentTraceFile) => void;
  /** Name of the currently-loaded trace, used to highlight its card. */
  currentName?: string;
};

export default function ExampleGallery({
  open,
  onClose,
  onSelect,
  currentName,
}: ExampleGalleryProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      aria-labelledby="example-gallery-title"
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle
        id="example-gallery-title"
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1,
          pb: 1,
        }}
      >
        Example flows
        <IconButton size="small" onClick={onClose} aria-label="Close">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ pb: 3 }}>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
            gap: 1.5,
          }}
        >
          {exampleFlows.map((flow) => {
            const isCurrent = !!currentName && flow.trace.name === currentName;
            const nodeCount = visibleGraph(flow.trace).nodes.length;
            const messageCount = flow.trace.messages.length;
            return (
              <ButtonBase
                key={flow.id}
                onClick={() => {
                  onSelect(flow.trace);
                  onClose();
                }}
                aria-current={isCurrent || undefined}
                sx={{
                  display: "block",
                  textAlign: "left",
                  borderRadius: 2,
                  p: 1.5,
                  height: "100%",
                  border: 1,
                  borderColor: isCurrent ? "primary.main" : "divider",
                  bgcolor: isCurrent ? "action.selected" : "background.paper",
                  transition: "border-color 150ms, background-color 150ms",
                  "&:hover": {
                    borderColor: isCurrent ? "primary.main" : "text.disabled",
                    bgcolor: "action.hover",
                  },
                }}
              >
                <Typography
                  variant="subtitle2"
                  sx={{ fontWeight: 600, mb: 0.25 }}
                >
                  {flow.title}
                  {isCurrent && (
                    <Typography
                      component="span"
                      variant="caption"
                      color="primary"
                      sx={{ ml: 0.75, fontWeight: 600 }}
                    >
                      • current
                    </Typography>
                  )}
                </Typography>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ lineHeight: 1.45, mb: 1 }}
                >
                  {flow.summary}
                </Typography>
                <Typography
                  variant="caption"
                  color="text.disabled"
                  sx={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {flow.pattern} · {messageCount} msg · {nodeCount} nodes
                </Typography>
              </ButtonBase>
            );
          })}
        </Box>
      </DialogContent>
    </Dialog>
  );
}
