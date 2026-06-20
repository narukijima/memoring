// Connector registry. The AI tool's local accumulation is reached through one
// of these. v0 initial connectors are added here as they are implemented.
import { claudeCodeConnector, CLAUDE_CODE_CONNECTOR_ID } from '@integrations/claude-code/index';
import type { Connector } from './types';

const REGISTRY: Record<string, Connector> = {
  [CLAUDE_CODE_CONNECTOR_ID]: claudeCodeConnector,
};

export function getConnector(connectorId: string): Connector | undefined {
  return REGISTRY[connectorId];
}

export function listConnectors(): Connector[] {
  return Object.values(REGISTRY);
}
