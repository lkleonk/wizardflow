import { Fragment, useState } from "react";
import Box from "@mui/material/Box";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import CloseIcon from "@mui/icons-material/Close";
import { LocalDataDetails } from "@/components/TutorialDialog";
import { isHostedWizardFlow } from "@/utils/deploymentTarget";

const footerLinks = [
  ...(isHostedWizardFlow
    ? [
        { href: "/impressum", label: "Impressum", external: false },
        { href: "/datenschutz", label: "Datenschutz", external: false },
      ]
    : []),
  { href: "https://github.com/lkleonk/wizardflow", label: "GitHub", external: true },
] as const;

// The two footer entries that are buttons rather than links (Tutorial, Data
// stays local) have to be un-styled back into looking like the anchors beside
// them.
const linkButtonSx = {
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
} as const;

function Separator() {
  return (
    <Box component="span" aria-hidden sx={{ opacity: 0.55 }}>
      /
    </Box>
  );
}

type FooterLinksProps = {
  onOpenTutorial: () => void;
};

export default function FooterLinks({ onOpenTutorial }: FooterLinksProps) {
  const [localDataOpen, setLocalDataOpen] = useState(false);

  return (
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
        onClick={onOpenTutorial}
        sx={linkButtonSx}
      >
        Tutorial
      </Box>
      <Separator />
      {/* Persistent home of the privacy message: always visible, so the
          reassurance is one click away at the moment someone hesitates
          over the Upload button. */}
      <Box
        component="button"
        type="button"
        onClick={() => setLocalDataOpen(true)}
        sx={linkButtonSx}
      >
        Data stays local
      </Box>
      <Dialog
        open={localDataOpen}
        onClose={() => setLocalDataOpen(false)}
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
          <IconButton
            size="small"
            onClick={() => setLocalDataOpen(false)}
            aria-label="Close"
          >
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
                WizardFlow records agent runs as plain JSONL files. You can
                send them to a teammate, attach them to a bug report, commit
                them, diff them, and replay them locally or in this browser. No
                account, trace server, or database is required.
              </Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ lineHeight: 1.7 }}
              >
                Observability platforms are designed for centralized
                monitoring, team dashboards, and hosted evaluations.
                WizardFlow focuses on portable traces and replaying individual
                runs, making it ideal for prototyping agent flows.
              </Typography>
            </Box>
          </Box>
        </DialogContent>
      </Dialog>
      {footerLinks.map((link) => (
        <Fragment key={link.href}>
          <Separator />
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
  );
}
