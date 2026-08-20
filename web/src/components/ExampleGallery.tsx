"use client";

import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import CloseIcon from "@mui/icons-material/Close";
import { exampleFlows, type ExampleFlow } from "@/data";

type ExampleGalleryProps = {
  open: boolean;
  onClose: () => void;
  /** Receives the whole flow so callers can use its id (e.g. deep links). */
  onSelect: (flow: ExampleFlow) => void;
  /**
   * Gallery id of the currently-loaded example, used to highlight its card.
   * Matched by id rather than by trace name so an upload that happens to share
   * a bundled flow's file name can't light up the wrong card.
   */
  currentExampleId?: string;
};

export default function ExampleGallery({
  open,
  onClose,
  onSelect,
  currentExampleId,
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
            const isCurrent = flow.id === currentExampleId;
            return (
              <ButtonBase
                key={flow.id}
                onClick={() => {
                  onSelect(flow);
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
                  {flow.pattern} · {flow.messageCount} msg · {flow.nodeCount} nodes
                </Typography>
              </ButtonBase>
            );
          })}
        </Box>
      </DialogContent>
    </Dialog>
  );
}
