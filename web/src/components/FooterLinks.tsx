import { Fragment, useState } from "react";
import Box from "@mui/material/Box";
import Popover from "@mui/material/Popover";
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
  // Anchor for the "Data stays local" popover (LocalDataDetails).
  const [localDataAnchor, setLocalDataAnchor] = useState<HTMLElement | null>(
    null
  );

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
          over the Upload button. Same popover affordance as TraceInfo. */}
      <Box
        component="button"
        type="button"
        onClick={(e: React.MouseEvent<HTMLElement>) =>
          setLocalDataAnchor(e.currentTarget)
        }
        sx={linkButtonSx}
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
