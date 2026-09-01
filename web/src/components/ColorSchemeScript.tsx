"use client";

// Sets the MUI color-scheme attribute on <html> before first paint, so a
// saved light/dark preference never flashes the default scheme. This is a
// hand-rolled replacement for @mui/material's InitColorSchemeScript for one
// reason: React dev-warns whenever it client-renders an executable <script>
// element (e.g. during hydration recovery), and per the Next.js guide
// "preventing-flash-before-hydration" the cure is a script that is
// type="text/javascript" in the server-rendered HTML (so the browser runs it
// while parsing) but type="text/plain" on any client render (so React never
// sees an executable script). MUI's component doesn't expose the type flip.
//
// Must stay in lockstep with the theme config: the attribute matches
// `colorSchemeSelector` in src/theme/muiTheme.ts, `mui-mode` is MUI's
// default modeStorageKey (written by useColorScheme's setMode), and the
// fallback mode mirrors defaultMode="system". Both schemes are named exactly
// "light"/"dark", so mode resolves to the scheme name directly.
const INIT_COLOR_SCHEME = `(function(){try{
var mode=localStorage.getItem('mui-mode')||'system';
var scheme='';
if(mode==='system'){scheme=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}
else if(mode==='light'||mode==='dark'){scheme=mode;}
if(scheme){document.documentElement.setAttribute('data-mui-color-scheme',scheme);}
}catch(e){}})();`;

export default function ColorSchemeScript() {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: INIT_COLOR_SCHEME }}
    />
  );
}
