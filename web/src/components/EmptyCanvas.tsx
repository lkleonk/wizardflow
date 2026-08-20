import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import GridViewOutlinedIcon from "@mui/icons-material/GridViewOutlined";
import TraceDropTarget from "@/components/TraceDropTarget";
import TraceUploader from "@/components/TraceUploader";
import type { AgentTraceFile } from "@/types/agenttrace";

type EmptyCanvasProps = {
  onUploadLoad: (trace: AgentTraceFile) => void;
  onOpenGallery: () => void;
};

// What fills the graph pane when no flow is loaded: the same two ways in as
// the welcome dialog, and the whole area is a drop target.
export default function EmptyCanvas({
  onUploadLoad,
  onOpenGallery,
}: EmptyCanvasProps) {
  return (
    <TraceDropTarget
      onLoad={onUploadLoad}
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
          onClick={onOpenGallery}
          sx={{ width: { xs: "100%", sm: "auto" } }}
        >
          Browse examples
        </Button>
        <TraceUploader
          onLoad={onUploadLoad}
          sx={{ width: { xs: "100%", sm: "auto" } }}
        />
      </Box>
    </TraceDropTarget>
  );
}
