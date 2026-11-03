import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
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
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import {
  TraceFlag,
  type ApiConversation,
  type ApiConversationGroup,
  type ApiTrace,
  type Page,
} from "@/types/otelstore";
import {
  apiPath,
  formatNsAgo,
  formatNsDateTime,
  formatNsDuration,
  nsDiff,
  useApi,
} from "@/utils/otelApi";
import { RANGE_MS, useDisplayPrefs, useNow, type TimeRange } from "@/utils/otelDisplay";
import { goTo, otelHref, replayHref, type OtelRoute, type TraceKind } from "@/utils/otelRoute";
import { EmptyState, LoadError, Loading, Mono, TraceBadges, graphSource } from "./OtelBits";

const PAGE = 50;

type TracesRoute = OtelRoute & { project: string };

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

/** "from" for the API: fixed when the range is picked, so the list doesn't
 * refetch every time the clock ticks. */
function useRangeStart(range: TimeRange): string | undefined {
  const now = useNow();
  const [anchor, setAnchor] = useState({ range, now });
  if (anchor.range !== range) setAnchor({ range, now });
  const span = RANGE_MS[range];
  return span === null ? undefined : `${BigInt(anchor.now - span) * BigInt(1_000_000)}`;
}

/** Filters shared by the flat list, the groups and a group's members. */
function useFilters(route: TracesRoute) {
  const prefs = useDisplayPrefs();
  const range = route.range ?? prefs.range;
  const from = useRangeStart(range);
  return {
    range,
    params: {
      project: route.project,
      kind: route.kind,
      errors: route.errors ? 1 : undefined,
      q: route.q,
      from,
    },
  };
}

export default function TracesView({ route }: { route: TracesRoute }) {
  const { range, params } = useFilters(route);
  const [query, setQuery] = useDebouncedQuery(route);
  const back = otelHref(route);

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
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
          <Typography sx={{ fontSize: 13, color: "text.secondary" }}>Group by</Typography>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={route.group ?? "none"}
            onChange={(_, group: string | null) =>
              group && goTo({ ...route, group: group === "conversation" ? "conversation" : undefined })
            }
            aria-label="Group by"
          >
            <ToggleButton value="none">None</ToggleButton>
            <ToggleButton value="conversation">Conversation</ToggleButton>
          </ToggleButtonGroup>
        </Box>
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
        <Box sx={{ flex: 1 }} />
        <ToggleButtonGroup
          size="small"
          exclusive
          value={range}
          onChange={(_, value: TimeRange | null) => value && goTo({ ...route, range: value })}
          aria-label="Started within"
        >
          {(["1h", "24h", "7d", "all"] as const).map((value) => (
            <ToggleButton key={value} value={value}>
              {value === "all" ? "All" : value}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <ConversationPicker project={route.project} back={back} />
      </Box>
      {route.group === "conversation" ? (
        <GroupedTraces route={route} params={params} back={back} />
      ) : (
        <FlatTraces route={route} params={params} back={back} />
      )}
    </Box>
  );
}

type Params = ReturnType<typeof useFilters>["params"];

/** Grows `limit` by a page on "Load more"; resets when the filters change. */
function usePaging(key: string): [number, () => void] {
  const [paging, setPaging] = useState({ key, limit: PAGE });
  const limit = paging.key === key ? paging.limit : PAGE;
  return [limit, () => setPaging({ key, limit: limit + PAGE })];
}

/** Keep showing the previous page while the next, longer one loads. */
function useShown<T>(key: string, items: T[] | undefined): T[] | undefined {
  const [shown, setShown] = useState<{ key: string; items: T[] } | null>(null);
  if (items && shown?.items !== items) setShown({ key, items });
  return items ?? (shown?.key === key ? shown.items : undefined);
}

function FlatTraces({ route, params, back }: { route: TracesRoute; params: Params; back: string }) {
  const key = JSON.stringify(params);
  const [limit, more] = usePaging(key);
  const { data, error, loading } = useApi<Page<ApiTrace>>(apiPath("traces", { ...params, limit }));
  const items = useShown(key, data?.items);

  if (error) return <LoadError error={error} />;
  if (!items) return <Loading />;
  if (items.length === 0) return <NoMatch />;
  const anyGenAI = items.some((t) => t.flags & TraceFlag.GENAI);
  const maxDuration = Math.max(1, ...items.map((t) => Number(t.durationNs)));
  return (
    <>
      <TraceTable anyGenAI={anyGenAI}>
        {items.map((trace) => (
          <TraceRow key={trace.traceId} trace={trace} route={route} back={back} anyGenAI={anyGenAI} maxDuration={maxDuration} />
        ))}
      </TraceTable>
      {data?.nextCursor && <LoadMore loading={loading} onClick={more} />}
    </>
  );
}

function GroupedTraces({ route, params, back }: { route: TracesRoute; params: Params; back: string }) {
  const key = JSON.stringify(params);
  const [limit, more] = usePaging(key);
  const { data, error, loading } = useApi<{ items: ApiConversationGroup[]; hasMore: boolean }>(
    apiPath("traces/groups", { ...params, limit })
  );
  const items = useShown(key, data?.items);
  const [open, setOpen] = useState<Set<string>>(() => new Set());

  if (error) return <LoadError error={error} />;
  if (!items) return <Loading />;
  if (items.length === 0) return <NoMatch />;
  const anyGenAI = items.some((g) => g.flags & TraceFlag.GENAI);
  const conversations = items.filter((g) => g.conversationId !== null);
  const traces = items.reduce((sum, g) => sum + g.traceCount, 0);
  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  return (
    <>
      <Typography sx={{ fontSize: 12.5, color: "text.secondary", mt: -0.5 }}>
        {conversations.length} conversation{conversations.length === 1 ? "" : "s"} · {traces} traces
      </Typography>
      <TraceTable anyGenAI={anyGenAI}>
        {items.map((group) => {
          const id = group.conversationId ?? "";
          return (
            <GroupRows
              key={id}
              group={group}
              open={open.has(id)}
              onToggle={() => toggle(id)}
              route={route}
              params={params}
              back={back}
              anyGenAI={anyGenAI}
            />
          );
        })}
      </TraceTable>
      {data?.hasMore && <LoadMore loading={loading} onClick={more} />}
    </>
  );
}

function GroupRows({
  group,
  open,
  onToggle,
  route,
  params,
  back,
  anyGenAI,
}: {
  group: ApiConversationGroup;
  open: boolean;
  onToggle: () => void;
  route: TracesRoute;
  params: Params;
  back: string;
  anyGenAI: boolean;
}) {
  const { conversationId } = group;
  const prefs = useDisplayPrefs();
  const now = useNow();
  return (
    <>
      <TableRow
        hover
        sx={{ cursor: "pointer", "& > td": { bgcolor: "action.hover" } }}
        onClick={onToggle}
        aria-expanded={open}
      >
        <TableCell padding="checkbox">
          <StatusDot errors={group.errorTraceCount} title={`${group.errorTraceCount} trace(s) with errors`} />
        </TableCell>
        <TableCell>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
            <ChevronRightIcon
              fontSize="small"
              sx={{ color: "text.secondary", transition: "transform .15s", transform: open ? "rotate(90deg)" : "none" }}
            />
            {conversationId ? (
              <Mono sx={{ fontWeight: 600, fontSize: 13 }}>{conversationId}</Mono>
            ) : (
              <Typography component="span" sx={{ fontWeight: 600, fontSize: 13, color: "text.secondary" }}>
                No conversation
              </Typography>
            )}
            <Typography component="span" sx={{ fontSize: 11.5, color: "text.secondary" }}>
              {group.traceCount} {group.traceCount === 1 ? "execution" : "executions"}
            </Typography>
            {conversationId && <TraceBadges flags={group.flags} />}
          </Box>
        </TableCell>
        <TableCell sx={{ whiteSpace: "nowrap" }}>
          {prefs.time === "relative" ? formatNsAgo(group.lastStartNs, now) : formatNsDateTime(group.lastStartNs)}
          <Box sx={{ fontSize: 11, color: "text.secondary" }}>last activity</Box>
        </TableCell>
        <TableCell sx={{ whiteSpace: "nowrap" }}>
          {conversationId && (
            <>
              <Mono>{formatNsDuration(nsDiff(group.lastEndNs, group.firstNs))}</Mono>
              <Box sx={{ fontSize: 11, color: "text.secondary" }}>first → last</Box>
            </>
          )}
        </TableCell>
        <TableCell align="right">{group.spanCount}</TableCell>
        {anyGenAI && (
          <TableCell align="right">
            <Mono>{tokens(group.inputTokens, group.outputTokens)}</Mono>
          </TableCell>
        )}
        {anyGenAI && (
          <TableCell>
            <Mono sx={{ fontSize: 12 }}>{group.model ?? "–"}</Mono>
          </TableCell>
        )}
        <TableCell align="right">{group.logCount || "–"}</TableCell>
        <TableCell />
        <TableCell padding="checkbox">
          {conversationId && group.replayableCount > 0 && (
            <ReplayButton
              title={`Replay conversation ${conversationId} in WizardFlow (${group.replayableCount} execution${
                group.replayableCount === 1 ? "" : "s"
              }). ${graphSource(group.flags)}`}
              href={replayHref({ project: route.project, conversationId, name: conversationId, back })}
            />
          )}
        </TableCell>
      </TableRow>
      {open && <GroupMembers group={group} route={route} params={params} back={back} anyGenAI={anyGenAI} />}
    </>
  );
}

function GroupMembers({
  group,
  route,
  params,
  back,
  anyGenAI,
}: {
  group: ApiConversationGroup;
  route: TracesRoute;
  params: Params;
  back: string;
  anyGenAI: boolean;
}) {
  const key = JSON.stringify([params, group.conversationId]);
  const [limit, more] = usePaging(key);
  const { data, error, loading } = useApi<Page<ApiTrace>>(
    apiPath("traces", {
      ...params,
      conversation: group.conversationId,
      noConversation: group.conversationId === null ? 1 : undefined,
      limit,
    })
  );
  const items = useShown(key, data?.items);
  const columns = anyGenAI ? 10 : 8;
  if (error || !items) {
    return (
      <TableRow>
        <TableCell colSpan={columns} sx={{ pl: 6, color: error ? "error.main" : "text.secondary" }}>
          {error ? error.message : "Loading…"}
        </TableCell>
      </TableRow>
    );
  }
  const maxDuration = Math.max(1, ...items.map((t) => Number(t.durationNs)));
  return (
    <>
      {items.map((trace) => (
        <TraceRow key={trace.traceId} trace={trace} route={route} back={back} anyGenAI={anyGenAI} maxDuration={maxDuration} nested />
      ))}
      {data?.nextCursor && (
        <TableRow>
          <TableCell colSpan={columns} sx={{ pl: 6 }}>
            <Button size="small" disabled={loading} onClick={more}>
              {loading ? "Loading…" : "Load more of this group"}
            </Button>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function TraceTable({ anyGenAI, children }: { anyGenAI: boolean; children: React.ReactNode }) {
  return (
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
        <TableBody>{children}</TableBody>
      </Table>
    </TableContainer>
  );
}

function TraceRow({
  trace,
  route,
  back,
  anyGenAI,
  maxDuration,
  nested,
}: {
  trace: ApiTrace;
  route: TracesRoute;
  back: string;
  anyGenAI: boolean;
  maxDuration: number;
  nested?: boolean;
}) {
  const prefs = useDisplayPrefs();
  const now = useNow();
  return (
    <TableRow
      hover
      sx={{ cursor: "pointer" }}
      onClick={() =>
        goTo({ view: "trace", project: route.project, trace: trace.traceId, span: trace.rootSpanId ?? undefined })
      }
    >
      <TableCell padding="checkbox">
        <StatusDot errors={trace.errorCount} title={trace.errorCount ? `${trace.errorCount} error span(s)` : "no errors"} />
      </TableCell>
      <TableCell sx={nested ? { pl: 6 } : undefined}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
          <Typography component="span" sx={{ fontWeight: 600, fontSize: 13 }}>
            {trace.name ?? "(no name)"}
          </Typography>
          <TraceBadges flags={trace.flags} />
        </Box>
        <Mono sx={{ fontSize: 11, color: "text.secondary" }}>{trace.traceId.slice(0, 16)}…</Mono>
      </TableCell>
      <TableCell sx={{ whiteSpace: "nowrap" }}>
        {prefs.time === "relative" ? (
          <Tooltip title={formatNsDateTime(trace.startNs)} disableInteractive>
            <span>{formatNsAgo(trace.startNs, now)}</span>
          </Tooltip>
        ) : (
          formatNsDateTime(trace.startNs)
        )}
      </TableCell>
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
          <Mono>{tokens(trace.inputTokens, trace.outputTokens)}</Mono>
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
          <ReplayButton
            title={`${
              trace.conversationId
                ? `Replay conversation ${trace.conversationId} in WizardFlow`
                : "Replay this execution in WizardFlow"
            }. ${graphSource(trace.flags)}`}
            href={replayHref({
              project: route.project,
              traceId: trace.traceId,
              conversationId: trace.conversationId,
              name: trace.conversationId ?? trace.name,
              back,
            })}
          />
        )}
      </TableCell>
    </TableRow>
  );
}

/**
 * Project-level entry into the replay: the replay unit is a conversation, so
 * pick one first. Executions without a conversation replay from their row.
 */
function ConversationPicker({ project, back }: { project: string; back: string }) {
  const { data } = useApi<ApiConversation[]>(apiPath("conversations", { project }));
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const now = useNow();
  if (!data || data.length === 0) return null;
  return (
    <>
      <Button
        size="small"
        variant="outlined"
        color="secondary"
        startIcon={<AccountTreeOutlinedIcon />}
        endIcon={<ArrowDropDownIcon />}
        onClick={(e) => setAnchor(e.currentTarget)}
        aria-haspopup="menu"
      >
        Open graph replay
      </Button>
      <Menu
        anchorEl={anchor}
        open={anchor !== null}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{ paper: { sx: { maxHeight: 420, minWidth: 280 } } }}
      >
        <Typography sx={{ px: 2, py: 0.75, fontSize: 12, color: "text.secondary", maxWidth: 320 }}>
          Pick a conversation. Its executions become the replay&apos;s messages.
        </Typography>
        {data.map((conversation) => (
          <MenuItem
            key={conversation.conversationId}
            component="a"
            href={replayHref({
              project,
              conversationId: conversation.conversationId,
              name: conversation.conversationId,
              back,
            })}
          >
            <ListItemText
              primary={<Mono>{conversation.conversationId}</Mono>}
              secondary={`${conversation.executions} execution${conversation.executions === 1 ? "" : "s"} · last ${formatNsAgo(
                conversation.lastNs,
                now
              )}`}
            />
          </MenuItem>
        ))}
        <Divider />
        <Typography sx={{ px: 2, py: 0.75, fontSize: 12, color: "text.secondary", maxWidth: 320 }}>
          Executions without a conversation: replay them from their row.
        </Typography>
      </Menu>
    </>
  );
}

function ReplayButton({ title, href }: { title: string; href: string }) {
  return (
    <Tooltip title={title}>
      <IconButton
        size="small"
        color="secondary"
        aria-label="Replay in WizardFlow"
        href={href}
        onClick={(e) => e.stopPropagation()}
      >
        <AccountTreeOutlinedIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}

function StatusDot({ errors, title }: { errors: number; title: string }) {
  return (
    <Box
      title={title}
      sx={{ width: 8, height: 8, borderRadius: "50%", mx: "auto", bgcolor: errors ? "error.main" : "success.main" }}
    />
  );
}

function tokens(input: number | null, output: number | null): string {
  return input != null || output != null ? `${input ?? 0} / ${output ?? 0}` : "–";
}

function NoMatch() {
  return <EmptyState title="No traces match">Try another filter or time range, or clear the search.</EmptyState>;
}

function LoadMore({ loading, onClick }: { loading: boolean; onClick: () => void }) {
  return (
    <Box sx={{ display: "flex", justifyContent: "center" }}>
      <Button variant="outlined" size="small" disabled={loading} onClick={onClick}>
        {loading ? "Loading…" : "Load more"}
      </Button>
    </Box>
  );
}
