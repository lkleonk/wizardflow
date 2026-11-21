import { useState } from "react";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import Popover from "@mui/material/Popover";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import type { ExecutionChoice } from "@/utils/traceSelectors";

export type ExecutionPickerProps = {
  /** Undefined while the list is still loading. */
  choices?: ExecutionChoice[];
  /** The popup opened: the moment to load the list, if it isn't here yet. */
  onOpen?: () => void;
  onJump: (index: number) => void;
};

function clock(iso?: string): string {
  if (!iso) return "";
  const time = new Date(iso);
  return Number.isNaN(time.getTime())
    ? ""
    : time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** "Execution 2 of 5" as a button: type a number or words to jump to another. */
export default function ExecutionPicker({
  position,
  label,
  choices,
  onOpen,
  onJump,
}: ExecutionPickerProps & { position: number; label: React.ReactNode }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [query, setQuery] = useState("");

  const needle = query.trim().toLowerCase();
  const number = /^\d+$/.test(needle) ? Number(needle) - 1 : null;
  const matches = (choices ?? [])
    .map((choice, index) => ({ choice, index }))
    .filter(({ choice, index }) => !needle || index === number || choice.title.toLowerCase().includes(needle))
    // The execution with that number first, ahead of titles containing the digit.
    .sort((a, b) => Number(b.index === number) - Number(a.index === number));

  const close = () => setAnchor(null);
  const jump = (index: number) => {
    close();
    if (index !== position - 1) onJump(index);
  };

  return (
    <>
      <Tooltip title="Jump to an execution">
        <ButtonBase
          onClick={(event) => {
            setQuery("");
            setAnchor(event.currentTarget);
            onOpen?.();
          }}
          aria-haspopup="dialog"
          sx={{ borderRadius: 1, font: "inherit", "&:hover": { bgcolor: "action.hover" } }}
        >
          <Typography component="span" sx={{ fontWeight: 650 }}>
            {label}
          </Typography>
          <ArrowDropDownIcon fontSize="small" sx={{ color: "text.secondary" }} />
        </ButtonBase>
      </Tooltip>
      <Popover
        open={anchor !== null}
        anchorEl={anchor}
        onClose={close}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        slotProps={{ paper: { sx: { width: 400, maxWidth: "calc(100vw - 32px)", mt: 0.5 } } }}
      >
        <Box sx={{ p: 1 }}>
          <TextField
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoFocus
            fullWidth
            size="small"
            placeholder="Go to number or search"
            onKeyDown={(event) => {
              if (event.key !== "Enter" || matches.length === 0) return;
              event.preventDefault();
              jump(matches[0].index);
            }}
          />
        </Box>
        {!choices && <Typography sx={{ px: 2, pb: 1.5, fontSize: 13, color: "text.secondary" }}>Loading…</Typography>}
        {choices && matches.length === 0 && (
          <Typography sx={{ px: 2, pb: 1.5, fontSize: 13, color: "text.secondary" }}>No matching execution.</Typography>
        )}
        {matches.length > 0 && (
          <List dense disablePadding sx={{ maxHeight: 340, overflowY: "auto", pb: 0.5 }}>
            {matches.map(({ choice, index }) => (
              <ListItemButton
                key={index}
                selected={index === position - 1}
                onClick={() => jump(index)}
                sx={{ gap: 1, py: 0.5 }}
              >
                <Typography sx={{ width: 26, flex: "none", textAlign: "right", fontSize: 12.5, color: "text.secondary" }}>
                  {index + 1}
                </Typography>
                <Typography noWrap title={choice.title} sx={{ flex: 1, minWidth: 0, fontSize: 13 }}>
                  {choice.title}
                </Typography>
                {choice.failed && (
                  <Box
                    role="img"
                    aria-label="Failed"
                    title="Failed"
                    sx={{ width: 8, height: 8, flex: "none", borderRadius: "50%", bgcolor: "error.main" }}
                  />
                )}
                <Typography sx={{ flex: "none", fontSize: 11.5, color: "text.secondary" }}>
                  {clock(choice.startedAt)}
                </Typography>
              </ListItemButton>
            ))}
          </List>
        )}
      </Popover>
    </>
  );
}
