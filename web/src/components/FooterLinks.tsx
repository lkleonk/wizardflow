import { Fragment, useState } from "react";
import Box from "@mui/material/Box";
import LocalDataDialog from "@/components/LocalDataDialog";
import { isHostedWizardFlow } from "@/utils/deploymentTarget";

const footerLinks = [
  {
    href: isHostedWizardFlow ? "/why-wizardflow" : "/why-wizardflow.html",
    label: "Why WizardFlow?",
    external: false,
  },
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

export default function FooterLinks() {
  const [localDataOpen, setLocalDataOpen] = useState(false);

  return (
    <>
      {isHostedWizardFlow && (
        <Box
          component="nav"
          aria-label="Legal links"
          sx={{
            display: { xs: "flex", sm: "none" },
            alignItems: "center",
            justifyContent: "center",
            gap: 0.75,
            px: 1,
            pb: 0.5,
            color: "text.secondary",
            fontSize: 11,
            lineHeight: 1.4,
          }}
        >
          <Box component="a" href="/impressum" sx={linkButtonSx}>
            Impressum
          </Box>
          <Separator />
          <Box component="a" href="/datenschutz" sx={linkButtonSx}>
            Datenschutz
          </Box>
        </Box>
      )}

      <Box
        component="nav"
        aria-label="Project links"
        sx={{
          display: { xs: "none", sm: "flex" },
          alignItems: "center",
          justifyContent: "center",
          gap: 1.5,
          px: 2,
          pb: 0.75,
          color: "text.secondary",
          fontSize: 12,
          lineHeight: 1.4,
        }}
      >
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
        <LocalDataDialog
          open={localDataOpen}
          onClose={() => setLocalDataOpen(false)}
        />
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
    </>
  );
}
