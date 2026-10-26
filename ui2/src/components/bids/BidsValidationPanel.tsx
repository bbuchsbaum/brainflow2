import React from 'react';
import { useBidsStore } from '@/stores/bidsStore';
import type { BidsValidationIssue } from '@/stores/bidsStore';
import { getEventBus } from '@/events/EventBus';
import { Button, Notice, Section, StatusPill, type NoticeSeverity } from '@/components/ui/bf';

type Severity = 'critical' | 'high' | 'medium' | 'low';

const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low'];

const SEVERITY_NOTICE: Record<Severity, NoticeSeverity> = {
  critical: 'danger',
  high: 'danger',
  medium: 'warning',
  low: 'neutral',
};

const SEVERITY_LABELS: Record<Severity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

function IssueItem({ issue, severity }: { issue: BidsValidationIssue; severity: Severity }) {
  const handleFileClick = () => {
    if (issue.file) {
      getEventBus().emit('filebrowser.file.open', { path: issue.file, intent: 'default' });
    }
  };

  return (
    <Notice severity={SEVERITY_NOTICE[severity]} role={undefined}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-bf-sm text-foreground">{issue.description}</span>
        {issue.file && (
          <Button
            variant="link"
            size="sm"
            wrap
            className="min-h-6 font-mono"
            onClick={handleFileClick}
          >
            {issue.file}
          </Button>
        )}
        <span className="font-mono text-bf-2xs text-muted-foreground">[{issue.rule}]</span>
      </div>
    </Notice>
  );
}

function SeverityGroup({
  severity,
  issues,
  divider,
}: {
  severity: Severity;
  issues: BidsValidationIssue[];
  divider: boolean;
}) {
  return (
    <Section
      divider={divider}
      title={`${SEVERITY_LABELS[severity]} (${issues.length})`}
      defaultOpen={severity === 'critical'}
    >
      <div className="flex flex-col gap-2">
        {issues.map((issue, idx) => (
          <IssueItem key={idx} issue={issue} severity={severity} />
        ))}
      </div>
    </Section>
  );
}

export function BidsValidationPanel() {
  const summary = useBidsStore(state => state.summary);
  if (!summary) return null;

  const { validation } = summary;

  if (validation.passed) {
    // The pill carries the status word; the sentence is plain text beside it.
    return (
      <div className="flex items-center gap-2 text-bf-xs text-muted-foreground" data-testid="bids-validation-passed">
        <StatusPill status="success">Passed</StatusPill>
        <span>No issues found.</span>
      </div>
    );
  }

  const grouped = SEVERITY_ORDER.reduce<Record<Severity, BidsValidationIssue[]>>((acc, sev) => {
    acc[sev] = validation.issues.filter(issue => issue.severity === sev);
    return acc;
  }, { critical: [], high: [], medium: [], low: [] });

  const visible = SEVERITY_ORDER.filter(sev => grouped[sev].length > 0);
  return (
    <div className="flex flex-col">
      {visible.map((sev, i) => (
        <SeverityGroup key={sev} severity={sev} issues={grouped[sev]} divider={i > 0} />
      ))}
    </div>
  );
}
