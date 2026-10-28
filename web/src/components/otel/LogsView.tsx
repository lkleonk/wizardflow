import { useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import InputAdornment from "@mui/material/InputAdornment";
import Link from "@mui/material/Link";
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
import Typography from "@mui/material/Typography";
import SearchIcon from "@mui/icons-material/Search";
import type { ApiLog, Page } from "@/types/otelstore";
import { apiPath, formatNsDateTime, useApi } from "@/utils/otelApi";
import { goTo, otelHref, type LogCorrelation, type OtelRoute } from "@/utils/otelRoute";
import { EmptyState, LoadError, Loading, Mono, SeverityChip } from "./OtelBits";
import { useDebouncedQuery } from "./TracesView";

const PAGE = 100;
const SEVERITIES: [number, string][] = [
  [0, "All"],
  [9, "≥ Info"],
  [13, "≥ Warn"],
  [17, "≥ Error"],
];

export default function LogsView({ route }: { route: OtelRoute & { project: string } }) {
  const filterKey = otelHref(route);
  const [paging, setPaging] = useState({ key: filterKey, limit: PAGE });
  const limit = paging.key === filterKey ? paging.limit : PAGE;
  const { data, error, loading } = useApi<Page<ApiLog>>(
    apiPath("logs", {
      project: route.project,
      minSeverity: route.sev,
      correlation: route.corr,
      q: route.q,
      limit,
    })
  );
  const [query, setQuery] = useDebouncedQuery(route);
  const [shown, setShown] = useState<{ key: string; items: ApiLog[] } | null>(null);
  if (data && shown?.items !== data.items) setShown({ key: filterKey, items: data.items });
  const items = data?.items ?? (shown?.key === filterKey ? shown.items : undefined);

  return (
    <Box sx={{ p: { xs: 1.5, sm: 2 }, display: "flex", flexDirection: "column", gap: 1.5 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={route.sev ?? 0}
          onChange={(_, sev: number | null) => sev !== null && goTo({ ...route, sev: sev || undefined })}
          aria-label="Minimum severity"
        >
          {SEVERITIES.map(([value, label]) => (
            <ToggleButton key={value} value={value}>
              {label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={route.corr ?? "all"}
          onChange={(_, corr: LogCorrelation | null) => corr && goTo({ ...route, corr })}
          aria-label="Trace correlation"
        >
          <ToggleButton value="all">All</ToggleButton>
          <ToggleButton value="with">With trace</ToggleButton>
          <ToggleButton value="without">Without trace</ToggleButton>
        </ToggleButtonGroup>
        <TextField
          size="small"
          placeholder="Search message"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          sx={{ flex: "1 1 200px", maxWidth: 340 }}
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
        <EmptyState title="No logs match">
          Only the OTel Logs signal shows here. Span events are in each trace&apos;s Events tab.
        </EmptyState>
      )}
      {items && items.length > 0 && (
        <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
          <Table size="small" aria-label="Logs">
            <TableHead>
              <TableRow>
                <TableCell>Time</TableCell>
                <TableCell>Severity</TableCell>
                <TableCell>Message</TableCell>
                <TableCell>Trace</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((log) => (
                <TableRow key={log.id} hover>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>
                    <Mono sx={{ fontSize: 12 }}>{formatNsDateTime(log.tsNs)}</Mono>
                  </TableCell>
                  <TableCell>
                    <SeverityChip number={log.severityNumber} label={log.severityText ?? undefined} />
                  </TableCell>
                  <TableCell sx={{ maxWidth: 640 }}>
                    <Typography sx={{ fontSize: 13, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                      {log.bodyText ?? (log.body === null ? "" : JSON.stringify(log.body))}
                    </Typography>
                    {log.eventName && <Mono sx={{ fontSize: 11, color: "text.secondary" }}>{log.eventName}</Mono>}
                  </TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>
                    {log.traceId ? (
                      <Link
                        component="button"
                        onClick={() =>
                          goTo({
                            view: "trace",
                            project: route.project,
                            trace: log.traceId!,
                            span: log.spanId ?? undefined,
                            tab: "logs",
                          })
                        }
                        sx={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 12 }}
                      >
                        {log.traceId.slice(0, 8)}…
                      </Link>
                    ) : (
                      <Typography component="span" title="This log record has no trace id" sx={{ color: "text.disabled" }}>
                        –
                      </Typography>
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
