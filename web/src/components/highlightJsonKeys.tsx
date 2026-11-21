import Box from "@mui/material/Box";

// Shared by the replay inspector and the dashboard's span inspector, both
// switched by the replay inspector's "Highlight keys" setting.

// Matches a JSON string token immediately followed by a colon, i.e. an object
// key — not a string value. `\\.` absorbs escaped characters (including `\"`)
// so it can't be fooled by quotes nested inside a value string.
const JSON_KEY_PATTERN = /"(?:[^"\\]|\\.)*"(?=\s*:)/g;

export function renderWithHighlightedKeys(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  JSON_KEY_PATTERN.lastIndex = 0;
  while ((match = JSON_KEY_PATTERN.exec(text))) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(
      <Box key={match.index} component="span" sx={{ color: "primary.main" }}>
        {match[0]}
      </Box>
    );
    lastIndex = match.index + match[0].length;
  }
  parts.push(text.slice(lastIndex));
  return parts;
}
