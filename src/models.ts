
export enum Operator {
  EQUALS = "EQUALS",
  NOT_EQUALS = "NOT_EQUALS",
  GREATER_THAN = "GREATER_THAN",
  LESS_THAN = "LESS_THAN",
  CONTAINS = "CONTAINS",
  IN = "IN",
  NOT_IN = "NOT_IN",
  SPLIT = "SPLIT"
}

export interface Condition {
  variable: string;
  operator: Operator;
  values: string[];
}

export interface Rule {
  description?: string;
  conditions: Condition[];
  targetVersion: string; // UUID
}

export interface FigDefinition {
  namespace: string;
  key: string;
  figId: string; // UUID
  schemaUri: string;
  schemaVersion: string;
  createdAt: string; // ISO Date
  updatedAt: string; // ISO Date
}

export interface Fig {
  figId: string; // UUID
  version: string; // UUID
  payload: Buffer | string; // Bytes or Base64 string
  isEncrypted?: boolean;
  wrappedDek?: Buffer | string;
  encryptionAlgorithm?: string;
  keyId?: string;
}

export interface FigFamily {
  definition: FigDefinition;
  figs: Fig[];
  rules?: Rule[];
  defaultVersion?: string; // UUID
}

export interface InitialFetchRequest {
  namespace: string;
  environmentId: string; // UUID
  asOfTimestamp?: string; // ISO Date
}

export interface InitialFetchResponse {
  figFamilies: FigFamily[];
  cursor: string;
  environmentId: string; // UUID
  schemas?: Record<string, string>;
}

export interface UpdateFetchRequest {
  namespace: string;
  cursor: string;
  environmentId: string; // UUID
}

export interface UpdateFetchResponse {
  figFamilies: FigFamily[];
  cursor: string;
  schemas?: Record<string, string>;
}
