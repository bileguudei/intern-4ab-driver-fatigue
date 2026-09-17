export type TabName = 'home' | 'history' | 'settings';
export type FlowScreen = 'camera' | 'calibration' | 'driving' | 'summary';
export type Route = { kind: 'tabs'; tab: TabName } | { kind: 'flow'; screen: FlowScreen };

export type SessionSummary = {
  durationSeconds: number;
  warningCount: number;
  criticalCount: number;
  maxScore: number;
  avgScore: number;
};

export type FatigueState = 'normal' | 'warning' | 'critical';
