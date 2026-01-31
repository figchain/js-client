
export class FigChainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FigChainError";
  }
}

export class SchemaNotFoundError extends FigChainError {
  constructor(message: string) {
    super(message);
    this.name = "SchemaNotFoundError";
  }
}

export class ConfigError extends FigChainError {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export class CryptoError extends FigChainError {
  constructor(message: string) {
    super(message);
    this.name = "CryptoError";
  }
}
