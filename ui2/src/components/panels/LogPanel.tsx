/**
 * LogPanel — fills the bottom dock's `log` slot.
 *
 * Reads structured entries from `useLogStore`. The bus → log mapping is
 * owned by `LogService.bootstrapLogService()`; this component is purely
 * presentation: level filter, search, clear, scroll-to-latest.
 *
 * Conforms to mockup-7 / Design.md §11.2 (`Log` = detailed chronological
 * event log). The Activity panel covers in-flight loads; the Log panel
 * covers terminal events users may want to re-read.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Trash2, ArrowDownToLine } from "lucide-react";

import { useLogStore, type LogEntry, type LogLevel } from "@/stores/logStore";
import { PanelErrorBoundary } from "../common/PanelErrorBoundary";

const containerStyle: React.CSSProperties = {
  height: "100%",
  width: "100%",
  display: "flex",
  flexDirection: "column",
  background: "var(--app-surface-panel-raised)",
  color: "var(--app-text-primary)",
};

const TOOLBAR_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "6px",
  padding: "4px 8px",
  borderBottom: "1px solid var(--app-border-subtle)",
  flex: "0 0 auto",
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  info: "var(--app-text-muted)",
  warn: "var(--app-warning, #f59e0b)",
  error: "var(--app-danger, #ef4444)",
};

const ROW_STYLE: React.CSSProperties = {
  display: "grid",
  // minmax(0, …) lets every track shrink below its intrinsic width so the
  // message column never gets squeezed to min-content (which would wrap the
  // text one character per line when the panel is narrow).
  gridTemplateColumns:
    "minmax(0, 52px) minmax(0, 44px) minmax(0, 64px) minmax(0, 1fr)",
  gap: "6px",
  alignItems: "baseline",
  padding: "2px 8px",
  fontFamily: "var(--app-font-mono, monospace)",
  fontSize: "var(--app-role-section-size)",
  lineHeight: 1.45,
  color: "var(--app-text-primary)",
};

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

interface LogRowProps {
  entry: LogEntry;
}

const LogRow: React.FC<LogRowProps> = ({ entry }) => {
  return (
    <div
      data-testid={`log-panel-entry-${entry.id}`}
      data-level={entry.level}
      data-source={entry.source}
      style={ROW_STYLE}
    >
      <span style={{ color: "var(--app-text-muted)" }}>
        {formatTimestamp(entry.timestamp)}
      </span>
      <span
        style={{
          textTransform: "uppercase",
          letterSpacing: "var(--app-role-section-tracking)",
          color: LEVEL_COLORS[entry.level],
          fontWeight: 600,
        }}
      >
        {entry.level}
      </span>
      <span style={{ color: "var(--app-text-muted)" }}>{entry.source}</span>
      <span
        style={{
          color:
            entry.level === "error"
              ? "var(--app-danger, #ef4444)"
              : "var(--app-text-primary)",
          minWidth: 0,
          whiteSpace: "pre-wrap",
          // Wrap at word boundaries first; only break genuinely long unbreakable
          // tokens as a last resort. Avoids the one-character-per-line column.
          overflowWrap: "anywhere",
        }}
      >
        {entry.message}
      </span>
    </div>
  );
};

const LEVELS: ReadonlyArray<LogLevel> = ["info", "warn", "error"];

const LogPanelContent: React.FC = () => {
  const entries = useLogStore((s) => s.entries);
  const clear = useLogStore((s) => s.clear);

  const [activeLevels, setActiveLevels] = useState<ReadonlySet<LogLevel>>(
    () => new Set(LEVELS),
  );
  const [query, setQuery] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);

  const bodyRef = useRef<HTMLDivElement>(null);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return entries.filter((entry) => {
      if (!activeLevels.has(entry.level)) return false;
      if (!needle) return true;
      return (
        entry.message.toLowerCase().includes(needle) ||
        entry.source.toLowerCase().includes(needle)
      );
    });
  }, [entries, activeLevels, query]);

  // Auto-scroll to newest when enabled and entries change.
  useEffect(() => {
    if (!autoScroll) return;
    const el = bodyRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [filtered, autoScroll]);

  const toggleLevel = (level: LogLevel) => {
    setActiveLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) {
        // Don't allow turning off all three — keep the panel useful.
        if (next.size === 1) return prev;
        next.delete(level);
      } else {
        next.add(level);
      }
      return next;
    });
  };

  return (
    <div data-testid="log-panel" style={containerStyle}>
      <div style={TOOLBAR_STYLE}>
        <div
          role="group"
          aria-label="Filter log levels"
          style={{ display: "inline-flex", gap: "2px" }}
        >
          {LEVELS.map((level) => {
            const isActive = activeLevels.has(level);
            return (
              <button
                key={level}
                type="button"
                role="checkbox"
                aria-checked={isActive}
                data-testid={`log-panel-level-${level}`}
                data-active={isActive ? "true" : "false"}
                onClick={() => toggleLevel(level)}
                style={{
                  appearance: "none",
                  padding: "0 8px",
                  height: "20px",
                  background: isActive ? "var(--app-bg-active)" : "transparent",
                  border: "1px solid var(--app-border)",
                  borderColor: isActive
                    ? "var(--app-border-active, var(--app-border))"
                    : "var(--app-border)",
                  color: isActive
                    ? LEVEL_COLORS[level]
                    : "var(--app-text-muted)",
                  cursor: "pointer",
                  fontSize: "var(--app-role-section-size)",
                  letterSpacing: "var(--app-role-section-tracking)",
                  textTransform: "uppercase",
                  borderRadius: "2px",
                }}
              >
                {level}
              </button>
            );
          })}
        </div>

        <input
          type="search"
          aria-label="Filter log entries"
          placeholder="Filter…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          data-testid="log-panel-search"
          style={{
            flex: "1 1 auto",
            minWidth: 0,
            height: "20px",
            padding: "0 6px",
            background: "var(--app-bg-input, transparent)",
            border: "1px solid var(--app-border-subtle)",
            color: "var(--app-text-primary)",
            borderRadius: "2px",
            fontSize: "var(--app-role-section-size)",
            outline: "none",
          }}
        />

        <button
          type="button"
          aria-label={autoScroll ? "Disable autoscroll" : "Enable autoscroll"}
          aria-pressed={autoScroll}
          data-testid="log-panel-autoscroll"
          onClick={() => setAutoScroll((v) => !v)}
          title={
            autoScroll
              ? "Auto-scroll on (click to pause)"
              : "Auto-scroll off (click to resume)"
          }
          style={{
            appearance: "none",
            background: autoScroll ? "var(--app-bg-active)" : "transparent",
            border: "1px solid var(--app-border)",
            color: autoScroll
              ? "var(--app-text-primary)"
              : "var(--app-text-muted)",
            padding: "0 6px",
            height: "20px",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
            fontSize: "var(--app-role-section-size)",
            borderRadius: "2px",
          }}
        >
          <ArrowDownToLine width={12} height={12} aria-hidden="true" />
        </button>

        <button
          type="button"
          aria-label="Clear log"
          data-testid="log-panel-clear"
          onClick={clear}
          disabled={entries.length === 0}
          style={{
            appearance: "none",
            background: "transparent",
            border: "none",
            padding: "0 4px",
            cursor: entries.length === 0 ? "not-allowed" : "pointer",
            color:
              entries.length === 0
                ? "var(--app-text-disabled)"
                : "var(--app-text-muted)",
            display: "inline-flex",
            alignItems: "center",
            height: "20px",
          }}
        >
          <Trash2 width={12} height={12} aria-hidden="true" />
        </button>
      </div>

      <div
        ref={bodyRef}
        data-testid="log-panel-body"
        style={{
          flex: "1 1 auto",
          minWidth: 0,
          minHeight: 0,
          overflow: "auto",
          padding: "4px 0",
        }}
      >
        {filtered.length === 0 ? (
          <div
            data-testid="log-panel-empty"
            style={{
              fontSize: "var(--app-role-section-size)",
              color: "var(--app-text-disabled)",
              textAlign: "center",
              padding: "14px 12px",
            }}
          >
            {entries.length === 0
              ? "No log entries yet. Loads, errors, and warnings appear here."
              : "No entries match the current filter."}
          </div>
        ) : (
          filtered.map((entry) => <LogRow key={entry.id} entry={entry} />)
        )}
      </div>
    </div>
  );
};

export const LogPanel: React.FC = () => (
  <PanelErrorBoundary panelName="LogPanel">
    <LogPanelContent />
  </PanelErrorBoundary>
);

export default LogPanel;
