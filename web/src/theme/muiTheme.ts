import { createTheme } from "@mui/material/styles";

// Default accent palette used to color nodes that don't specify their own color.
// No red/orange/green defaults — these read as "status" colors and would be misleading.
// These mid-tones read acceptably on both light and dark surfaces.
export const NODE_PALETTE = [
  "#60A5FA", // blue
  "#22D3EE", // cyan
  "#A78BFA", // violet
  "#C084FC", // purple
  "#F0ABFC", // pink
  "#818CF8", // indigo
] as const;

/** Deterministically pick a palette color for a node by index. */
export function nodeColorAt(index: number): string {
  return NODE_PALETTE[index % NODE_PALETTE.length];
}

// CSS-variables theme with both color schemes. The active scheme is switched by
// the `data-mui-color-scheme` attribute on <html> (set pre-hydration by
// InitColorSchemeScript), so toggling never re-renders styles — no flash.
export const theme = createTheme({
  cssVariables: {
    colorSchemeSelector: "data-mui-color-scheme",
  },
  defaultColorScheme: "dark",
  colorSchemes: {
    dark: {
      palette: {
        mode: "dark",
        background: { default: "#0B0D10", paper: "#15181D" },
        primary: { main: "#60A5FA" },
        // `info` drives `severity="info"` alerts (MUI derives their text and
        // tinted background from it). Left at MUI's stock blue it sits in a
        // different hue family than our primary, which reads as a subtly
        // wrong blue next to everything else — so it tracks primary here.
        info: { main: "#60A5FA" },
        divider: "rgba(255, 255, 255, 0.08)",
        text: { primary: "#E6E8EB", secondary: "#9AA1AB" },
      },
    },
    light: {
      palette: {
        mode: "light",
        background: { default: "#F6F7F9", paper: "#FFFFFF" },
        primary: { main: "#2563EB" },
        info: { main: "#2563EB" },
        divider: "rgba(0, 0, 0, 0.10)",
        text: { primary: "#1A1D21", secondary: "#5B636E" },
      },
    },
  },
  shape: {
    borderRadius: 8,
  },
  typography: {
    fontFamily:
      'var(--font-geist-sans), system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    fontSize: 13,
  },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: "none",
          border: "1px solid var(--mui-palette-divider)",
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        // A dialog takes focus on open (MUI puts `tabIndex={-1}` on the paper)
        // so keyboard and screen readers land inside it. MUI means to suppress
        // the browser's focus ring for that — its own comment says so — but the
        // `outline: 0` reset sits on the container slot while the focus target
        // is the paper, so Chrome draws a bright ring around the whole dialog.
        // It only shows when the last input was the keyboard (Ctrl+R yes, click
        // reload no), which reads as a rendering glitch. Ringing the box itself
        // marks nothing actionable anyway — the first Tab moves focus to a real
        // control, and those keep their own rings.
        paper: { outline: 0 },
      },
    },
  },
});
