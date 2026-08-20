import Box from "@mui/material/Box";

// The WizardFlow mark: a hat over a drifting glow. Static art with no props —
// it lives in its own file because it is 100 lines of SVG, not because it
// varies.
export default function WizardHatMark() {
  return (
    <Box
      aria-hidden
      component="svg"
      viewBox="0 0 72 72"
      sx={{
        display: "block",
        width: 72,
        height: 72,
        // Soft halo that drifts and breathes behind the hat. The orbit and the
        // pulse live on separate elements with different durations so the
        // motion never settles into an obvious repeating beat. transform-box
        // keeps each transform centered on the glow, not the SVG origin.
        "@keyframes wizardGlowPulse": {
          "0%, 100%": { opacity: 0.3, transform: "scale(0.88)" },
          "50%": { opacity: 0.85, transform: "scale(1.12)" },
        },
        "@keyframes wizardGlowOrbit": {
          "0%": { transform: "translate(-3px, -2px)" },
          "25%": { transform: "translate(3px, -3px)" },
          "50%": { transform: "translate(4px, 2px)" },
          "75%": { transform: "translate(-3px, 3px)" },
          "100%": { transform: "translate(-3px, -2px)" },
        },
        "& .wizard-glow-orbit": {
          transformBox: "fill-box",
          transformOrigin: "center",
          animation: "wizardGlowOrbit 5s ease-in-out infinite",
        },
        "& .wizard-glow": {
          transformBox: "fill-box",
          transformOrigin: "center",
          animation: "wizardGlowPulse 2.4s ease-in-out infinite",
        },
        "@media (prefers-reduced-motion: reduce)": {
          "& .wizard-glow-orbit, & .wizard-glow": { animation: "none" },
          "& .wizard-glow": { opacity: 0.55 },
        },
      }}
    >
      <defs>
        <radialGradient id="wizardGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#A78BFA" stopOpacity="0.75" />
          <stop offset="55%" stopColor="#60A5FA" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#22D3EE" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="wizardCone" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#C4B5FD" />
          <stop offset="100%" stopColor="#6D28D9" />
        </linearGradient>
        <linearGradient id="wizardBrim" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#67E8F9" />
          <stop offset="100%" stopColor="#0E7490" />
        </linearGradient>
        <clipPath id="wizardClip">
          <rect width="72" height="72" rx="18" />
        </clipPath>
      </defs>

      <rect width="72" height="72" rx="18" fill="var(--mui-palette-background-paper)" />

      <g clipPath="url(#wizardClip)">
        <g className="wizard-glow-orbit">
          <circle className="wizard-glow" cx="36" cy="33" r="27" fill="url(#wizardGlow)" />
        </g>
      </g>

      {/* Brim: full ellipse; the cone sits on top so only the sides and front
          edge show, like a real hat. */}
      <ellipse
        cx="36"
        cy="50"
        rx="22"
        ry="6"
        fill="url(#wizardBrim)"
        stroke="#155E75"
        strokeWidth="1.5"
      />

      {/* Cone with a slightly bent tip and concave edges for a softer,
          more believable wizard-hat silhouette. */}
      <path
        d="M27 49 C 29 37, 32 23, 40 13 C 43 22, 45 37, 45 50 C 39 53, 33 53, 27 49 Z"
        fill="url(#wizardCone)"
        stroke="#5B21B6"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />

      {/* Gold hatband nestled where the cone meets the brim. */}
      <path
        d="M27.5 48 C 33 51, 39 51, 44.5 48 L 45 50.5 C 39 53, 33 53, 27 50.5 Z"
        fill="#FBBF24"
        stroke="#B45309"
        strokeWidth="0.75"
        strokeLinejoin="round"
      />

      {/* Sparkle near the tip plus a couple of faint stars on the cone. */}
      <path
        d="M50 14L52 18.5L56.5 20.5L52 22.5L50 27L48 22.5L43.5 20.5L48 18.5L50 14Z"
        fill="#F0ABFC"
      />
      <circle cx="34" cy="34" r="2.4" fill="#FFFFFF" fillOpacity="0.9" />
      <circle cx="39" cy="42" r="2" fill="#FFFFFF" fillOpacity="0.85" />
    </Box>
  );
}
