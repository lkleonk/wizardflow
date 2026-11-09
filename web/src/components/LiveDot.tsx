import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";

/** The pulsing green dot for "data is arriving live". */
export function LivePulse() {
  return (
    <Box
      sx={{
        width: 8,
        height: 8,
        borderRadius: "50%",
        bgcolor: "success.main",
        "@keyframes livePulse": {
          "0%": {
            boxShadow: "0 0 0 0 rgba(102, 187, 106, 0.55)",
          },
          "70%": {
            boxShadow: "0 0 0 6px rgba(102, 187, 106, 0)",
          },
          "100%": {
            boxShadow: "0 0 0 0 rgba(102, 187, 106, 0)",
          },
        },
        animation: "livePulse 2s ease-out infinite",
        "@media (prefers-reduced-motion: reduce)": {
          animation: "none",
        },
      }}
    />
  );
}

// The live indicator, next to the name it describes: is this still growing?
// The slot is kept even when the dot is out, so a rotation does not shift
// everything beside it sideways.
export function LiveStatusDot({ watching, title }: { watching: boolean; title: string }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", px: 0.75 }}>
      {watching ? (
        <Tooltip title={title}>
          <Box role="status" aria-label="Watching for updates" sx={{ display: "flex" }}>
            <LivePulse />
          </Box>
        </Tooltip>
      ) : (
        <Box sx={{ width: 8, height: 8 }} />
      )}
    </Box>
  );
}
