export type LinkKind = 'flow' | 'data';

export interface VisualScriptNode {
  id: string;
  type: string;
  x: number;
  y: number;
  params: Record<string, unknown>;
}

export interface VisualScriptLink {
  from: string;
  fromPort: string;
  to: string;
  toPort: string;
  kind: LinkKind;
}

export interface VisualScriptGraph {
  version: string;
  name: string;
  enabled: boolean;
  idleFailSafeSec: number;
  nodes: VisualScriptNode[];
  links: VisualScriptLink[];
}

export type PortValueType = 'flow' | 'number' | 'boolean' | 'string' | 'position' | 'positionList' | 'object' | 'any';

export interface PortDef {
  name: string;
  type: PortValueType;
  label?: string;
}

export interface NodeParamDef {
  key: string;
  label: string;
  type: 'number' | 'boolean' | 'select' | 'text';
  value: unknown;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
}

export interface NodeDef {
  type: string;
  label: string;
  category: 'entry' | 'control' | 'data' | 'action';
  inputs: PortDef[];
  outputs: PortDef[];
  params: NodeParamDef[];
  description?: string;
}

export interface VisualScriptInfo {
  id: string;
  name: string;
  enabled: boolean;
  idleFailSafeSec: number;
  nodeCount: number;
  status: 'idle' | 'running' | 'error';
  error?: string;
  activeNodeId?: string;
  hotkey?: string;
}
