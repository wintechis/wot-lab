export interface PropertyCheck {
  thingId: string;
  property: string;
  actualValue: unknown;
  expectedValue: unknown;
  matches: boolean;
  timestamp: string;
}

export interface BatchCheckResult {
  thingId: string;
  results: Record<string, PropertyCheckResult>;
  allMatch: boolean;
  timestamp: string;
}

export interface PropertyCheckResult {
  actualValue?: unknown;
  expectedValue?: unknown;
  matches?: boolean;
  error?: string;
  available?: string[];
}
