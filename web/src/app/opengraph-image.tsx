import { ImageResponse } from "next/og";

// Generated social-share card (used for Open Graph and, via the metadata
// fallback, Twitter). Kept to flexbox + basic CSS — that's all `next/og`'s
// Satori renderer supports. Palette mirrors the app icon (icon.svg).
//
// Rendered once at build into a static PNG — required so the route is compatible
// with `output: "export"` (see next.config.ts).
export const dynamic = "force-static";

export const alt = "WizardFlow — Replay and inspect agent flows";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 80,
          background:
            "radial-gradient(900px 600px at 80% -10%, #1e1b4b 0%, #0B0D10 55%)",
          color: "#F8FAFC",
          fontFamily: "sans-serif",
        }}
      >
        {/* Node-graph glyph echoing the favicon */}
        <svg width="120" height="120" viewBox="0 0 64 64">
          <path
            d="M19 39L31 24L45 36"
            fill="none"
            stroke="#60A5FA"
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="19" cy="39" r="8" fill="#22D3EE" />
          <circle cx="31" cy="24" r="8" fill="#A78BFA" />
          <circle cx="45" cy="36" r="8" fill="#60A5FA" />
          <path
            d="M48 13L50.2 18.1L55.5 20.2L50.2 22.4L48 27.5L45.8 22.4L40.5 20.2L45.8 18.1L48 13Z"
            fill="#F0ABFC"
          />
        </svg>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 76, fontWeight: 700, letterSpacing: -2 }}>
            WizardFlow
          </div>
          <div
            style={{
              fontSize: 36,
              lineHeight: 1.3,
              color: "#94A3B8",
              maxWidth: 860,
            }}
          >
            Replay and inspect agent flows — message timeline, node steps, live
            graph activity, and payload inspection.
          </div>
        </div>
      </div>
    ),
    size,
  );
}
