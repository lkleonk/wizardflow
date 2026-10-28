import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import SearchIcon from "@mui/icons-material/Search";
import AccountTreeOutlinedIcon from "@mui/icons-material/AccountTreeOutlined";
import { TraceFlag, type ApiTrace, type Page } from "@/types/otelstore";
import { apiPath, formatNsDateTime, formatNsDuration, useApi } from "@/utils/otelApi";
import { goTo, otelHref, replayHref, type OtelRoute, type TraceKind } from "@/utils/otelRoute";
import { EmptyState, LoadError, Loading, Mono, TraceBadges } from "./OtelBits";

const PAGE = 50;

/** Keeps the search box responsive and only writes the URL (→ refetch) after
 * typing pauses. */
export function useDebouncedQuery(route: OtelRoute): [string, (value: string) => void] {
  const [text, setText] = useState(route.q ?? "");
  useEffect(() => {
    if (text === (route.q ?? "")) return;
    const timer = window.setTimeout(() => goTo({ ...route, q: text || undefined }, { replace: true }), 300);
    return () => window.clearTimeout(timer);
  }, [text, route]);
  return [text, setText];
}

export default function TracesView({ route }: { route: OtelRoute & { project: string } }) {
  const filterKey = otelHref(route);
  const [paging, setPaging] = useState({ key: filterKey, limit: PAGE });
  const limit = paging.key === filterKey ? paging.limit : PAGE;
  const { data, error, loading } = useApi<Page<ApiTrace>>(
    apiPath("traces", {
      project: route.project,
      kind: route.kind,
      errors: route.errors ? 1 : undefined,
      q: route.q,
      limit,
    })
  );
  const [query, setQuery] = useDebouncedQuery(route);
  // Keep showing the previous page while the next, longer one loads.
  const [shown, setShown] = useState<{ key: string; items: ApiTrace[] } | null>(null);
  if (data && shown?.items !== data.items) setShown({ key: filterKey, items: data.items });
  const items = data?.items ?? (shown?.key === filterKey ? shown.items : undefined);

  const anyGenAI = items?.some((t) => t.flags & TraceFlag.GENAI) ?? false;
  const maxDuration = Math.max(1, ...(items ?? []).map((t) => Number(t.durationNs)));
  const back = filterKey;

  return (
    <Box sx={{ p: { xs: 1.5, sm: 2 }, display: "flex", flexDirection: "column", gap: 1.5 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={route.kind ?? "all"}
          onChange={(_, kind: TraceKind | null) => kind && goTo({ ...route, kind })}
          aria-label="Trace kind"
        >
          <ToggleButton value="all">All</ToggleButton>
          <ToggleButton value="wizardflow">WizardFlow</ToggleButton>
          <ToggleButton value="genai">GenAI</ToggleButton>
          <ToggleButton value="otel">Plain OTel</ToggleButton>
        </ToggleButtonGroup>
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={!!route.errors}
              onChange={(e) => goTo({ ...route, errors: e.target.checked || undefined })}
            />
          }
          label="Errors only"
        />
        <TextField
          size="small"
          placeholder="Name, trace id, conversation, model"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          sx={{ flex: "1 1 220px", maxWidth: 380 }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
        />
      </Box>

      {error && <LoadError error={error} />}
      {!items && !error && <Loading />}
      {items && items.length === 0 && (
        <EmptyState title="No traces match">Try another filter, or clear the search.</EmptyState>
      )}
      {items && items.length > 0 && (
        <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
          <Table size="small" aria-label="Traces">
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox" />
                <TableCell>Root span</TableCell>
                <TableCell>Started</TableCell>
                <TableCell>Duration</TableCell>
                <TableCell align="right">Spans</TableCell>
                {anyGenAI && <TableCell align="right">Tokens in / out</TableCell>}
                {anyGenAI && <TableCell>Model</TableCell>}
                <TableCell align="right">Logs</TableCell>
                <TableCell>Conversation</TableCell>
                <TableCell padding="checkbox" />
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((trace) => (
                <TableRow
                  key={trace.traceId}
                  hover
                  sx={{ cursor: "pointer" }}
                  onClick={() =>
                    goTo({
                      view: "trace",
                      project: route.project,
                      trace: trace.traceId,
                      span: trace.rootSpanId ?? undefined,
                    })
                  }
                >
                  <TableCell padding="checkbox">
                    <Box
                      title={trace.errorCount ? `${trace.errorCount} error span(s)` : "no errors"}
                      sx={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        mx: "auto",
                        bgcolor: trace.errorCount ? "error.main" : "success.main",
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                      <Typography component="span" sx={{ fontWeight: 600, fontSize: 13 }}>
                        {trace.name ?? "(no name)"}
                      </Typography>
                      <TraceBadges flags={trace.flags} />
                    </Box>
                    <Mono sx={{ fontSize: 11, color: "text.secondary" }}>{trace.traceId.slice(0, 16)}…</Mono>
                  </TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{formatNsDateTime(trace.startNs)}</TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <Box
                        sx={{
                          height: 5,
                          borderRadius: 1,
                          width: Math.max(3, (Number(trace.durationNs) / maxDuration) * 80),
                          bgcolor: trace.errorCount ? "error.main" : "primary.main",
                          opacity: 0.7,
                        }}
                      />
                      <Mono>{formatNsDuration(Number(trace.durationNs))}</Mono>
                    </Box>
                  </TableCell>
                  <TableCell align="right">{trace.spanCount}</TableCell>
                  {anyGenAI && (
                    <TableCell align="right">
                      <Mono>
                        {trace.inputTokens != null || trace.outputTokens != null
                          ? `${trace.inputTokens ?? 0} / ${trace.outputTokens ?? 0}`
                          : "–"}
                      </Mono>
                    </TableCell>
                  )}
                  {anyGenAI && (
                    <TableCell>
                      <Mono sx={{ fontSize: 12 }}>{trace.model ?? "–"}</Mono>
                    </TableCell>
                  )}
                  <TableCell align="right">{trace.logCount || "–"}</TableCell>
                  <TableCell>
                    <Mono sx={{ fontSize: 12 }}>{trace.conversationId ?? "–"}</Mono>
                  </TableCell>
                  <TableCell padding="checkbox">
                    {(trace.flags & TraceFlag.WIZARDFLOW) !== 0 && (
                      <Tooltip
                        title={
                          trace.conversationId
                            ? `Replay conversation ${trace.conversationId} in WizardFlow`
                            : "Replay this execution in WizardFlow"
                        }
                      >
                        <IconButton
                          size="small"
                          color="secondary"
                          aria-label="Replay in WizardFlow"
                          href={replayHref({
                            project: route.project,
                            traceId: trace.traceId,
                            conversationId: trace.conversationId,
                            name: trace.conversationId ?? trace.name,
                            back,
                          })}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <AccountTreeOutlinedIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      {data?.nextCursor && (
        <Box sx={{ display: "flex", justifyContent: "center" }}>
          <Button
            variant="outlined"
            size="small"
            disabled={loading}
            onClick={() => setPaging({ key: filterKey, limit: limit + PAGE })}
          >
            {loading ? "Loading…" : "Load more"}
          </Button>
        </Box>
      )}
    </Box>
  );
}
