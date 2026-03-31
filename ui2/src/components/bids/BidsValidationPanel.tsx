import React from 'react';
import { useBidsStore } from '@/stores/bidsStore';
import type { BidsValidationIssue } from '@/stores/bidsStore';
import { CollapsibleSection } from '@/components/ui/CollapsibleSection';
import { getEventBus } from '@/events/EventBus';

type Severity = 'critical' | 'high' | 'medium' | 'low';

const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low'];

const SEVERITY_COLORS: Record<Severity, string> = {
  critical: '#dc2626',
  high: '#ea580c',
  medium: '#f59e0b',
  low: 'hsl(var(--muted-foreground))',
};

const SEVERITY_LABELS: Record<Severity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

function SeverityDot({ severity }: { severity: Severity }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        backgroundColor: SEVERITY_COLORS[severity],
        flexShrink: 0,
      }}
    />
  );
}

function IssueItem({ issue }: { issue: BidsValidationIssue }) {
  const handleFileClick = () => {
    if (issue.file) {
      getEventBus().emit('filebrowser.file.open', { path: issue.file, intent: 'default' });
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
      <span className="bf-role-body text-foreground">{issue.description}</span>
      {issue.file && (
        <button
          onClick={handleFileClick}
          className="text-left text-muted-foreground hover:text-foreground transition-colors"
          style={{ fontFamily: 'monospace', fontSize: '0.75rem', background: 'none', border: 'none', padding: 0, cursor: 'pointer', wordBreak: 'break-all' }}
        >
          {issue.file}
        </button>
      )}
      <span className="bf-role-body text-muted-foreground" style={{ fontSize: '0.7rem' }}>
        [{issue.rule}]
      </span>
    </div>
  );
}

function SeverityGroup({ severity, issues }: { severity: Severity; issues: BidsValidationIssue[] }) {
  const label = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
      <SeverityDot severity={severity} />
      {SEVERITY_LABELS[severity]} ({issues.length})
    </span>
  );

  return (
    <CollapsibleSection
      title={`${SEVERITY_LABELS[severity]} (${issues.length})`}
      defaultExpanded={severity === 'critical'}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingLeft: '4px' }}>
        {issues.map((issue, idx) => (
          <IssueItem key={idx} issue={issue} />
        ))}
      </div>
    </CollapsibleSection>
  );
}

export function BidsValidationPanel() {
  const summary = useBidsStore(state => state.summary);
  if (!summary) return null;

  const { validation } = summary;

  if (validation.passed) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span
          style={{
            display: 'inline-block',
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: '#16a34a',
            flexShrink: 0,
          }}
        />
        <span className="bf-role-body text-foreground">Passed — No issues found</span>
      </div>
    );
  }

  const grouped = SEVERITY_ORDER.reduce<Record<Severity, BidsValidationIssue[]>>((acc, sev) => {
    acc[sev] = validation.issues.filter(issue => issue.severity === sev);
    return acc;
  }, { critical: [], high: [], medium: [], low: [] });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      {SEVERITY_ORDER.filter(sev => grouped[sev].length > 0).map(sev => (
        <SeverityGroup key={sev} severity={sev} issues={grouped[sev]} />
      ))}
    </div>
  );
}
