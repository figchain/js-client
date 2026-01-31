# FigChain JavaScript/TypeScript Client

Official JavaScript/TypeScript client library for [FigChain](https://figchain.io) configuration management.

## Features

- **Real-time configuration updates** - Subscribe to configuration changes with background polling
- **Rule-based rollouts** - Evaluate feature flags and configurations based on user context
- **Type-safe models** - Full TypeScript support with Avro-based serialization for efficient data transfer
- **Flexible storage** - Thread-safe in-memory storage
- **Node.js & Browser** - Works in both Node.js and modern browsers
- **Encryption support** - End-to-end encryption with X25519/ChaCha20-Poly1305
- **S3 Backup** - Optional S3-based configuration backup and bootstrap

## Installation

Install using npm:

```bash
npm install figchain-client
```

Or using yarn:

```bash
yarn add figchain-client
```

## Quick Start

### 1. Create a configuration file

Create a `client-config.json` file in the same directory as your service.

### 2. Initialize and use the client

```typescript
import { FigChainClient } from 'figchain-client';

// Load configuration from client-config.json and initialize
const client = await FigChainClient.create('client-config.json');

// Define context for evaluation (e.g., user properties for traffic splitting)
const context = {
  userId: "user123",
  plan: "premium"
};

// Fetch configuration
const config = await client.getFig("your-fig-key", context);

if (config?.enabled) {
  console.log(`Feature enabled with color: ${config.backgroundColor}`);
} else {
  console.log("Feature disabled");
}

// Listen for configuration changes
client.on("your-fig-key", (newConfig) => {
  console.log("Configuration updated:", newConfig);
});

// Clean up resources when done
client.close();
```

## Configuration

### Loading from file (recommended)

Create a `client-config.json` file in the same directory as your service:

```typescript
// Loads from ./client-config.json
const client = await FigChainClient.create('client-config.json');

// Or specify a custom path
const client = await FigChainClient.create('/path/to/config.json');

// Override specific options
const client = await FigChainClient.create('client-config.json', {
  pollInterval: 30,
  namespaces: ["production"]
});
```

### Programmatic configuration

You can also configure the client entirely through code:

### Programmatic configuration

You can also configure the client entirely through code:

```typescript
const client = new FigChainClient({
  environmentId: "your-environment-id",
  credentialId: "your-credential-id",
  authPrivateKey: "hex-encoded-ed25519-private-key",
  namespaces: ["default"] // Can also pass a string or Set
});

await client.init();
```

### Environment variables

All configuration options can be set via environment variables:

```bash
# Required
export FIGCHAIN_ENVIRONMENT_ID="your-environment-id"
export FIGCHAIN_IDENTITY_PRIVATE_KEY="hex-encoded-ed25519-private-key"

# Optional
export FIGCHAIN_URL="https://app.figchain.io/api/"
export FIGCHAIN_NAMESPACES="default,production"
export FIGCHAIN_NAMESPACE="default"  # For single namespace
export FIGCHAIN_POLLING_INTERVAL_MS="60000"
export FIGCHAIN_AS_OF_TIMESTAMP="2026-01-01T00:00:00Z"

# Keys (hex-encoded)
export FIGCHAIN_IDENTITY_PRIVATE_KEY="hex-encoded-ed25519-private-key"
export FIGCHAIN_ENCRYPTION_PRIVATE_KEY="hex-encoded-x25519-private-key"

# S3 Backup
export FIGCHAIN_S3_BACKUP_ENABLED="true"
export FIGCHAIN_S3_BACKUP_BUCKET="my-config-bucket"
export FIGCHAIN_S3_BACKUP_PREFIX="figchain/"
export FIGCHAIN_S3_BACKUP_REGION="us-east-1"
export FIGCHAIN_BOOTSTRAP_STRATEGY="hybrid"
```

Configuration is loaded in this order (later sources override earlier):
1. Configuration file (e.g., `client-config.json`)
2. Environment variables
3. Programmatic options passed to constructor/create()

### All configuration options

```typescript
const client = new FigChainClient({
  // Required
  environmentId: "your-environment-id",
  authPrivateKey: "hex-encoded-ed25519-private-key", // for authentication
  credentialId: "your-credential-id", // service account ID

  // Optional
  baseUrl: "https://app.figchain.io/api/",
  namespaces: ["default"], // single string, array, or Set
  pollInterval: 60, // seconds
  asOf: "2026-01-01T00:00:00Z", // point-in-time configuration
  tenantId: "default", // tenant identifier

  // Keys (optional, hex-encoded)
  encryptionPrivateKey: "hex-encoded-x25519-private-key", // for end-to-end encryption

  // S3 Backup (optional)
  s3BackupEnabled: true,
  s3BackupBucket: "my-config-bucket",
  s3BackupPrefix: "figchain/",
  s3BackupRegion: "us-east-1",
  bootstrapStrategy: "hybrid" // 'server', 'server-first', 'hybrid', 's3_backup_only'
});
```

## API Reference

### `FigChainClient`

#### `constructor(options: ConfigOptions)`
Creates a new FigChain client instance.

#### `async init(): Promise<void>`
Initializes the client, bootstraps configuration, and starts polling for updates.

#### `async getFig<T>(key: string, context?: Context, namespace?: string, defaultValue?: T): Promise<T | undefined>`
Retrieves a configuration value by key, evaluating rules against the provided context. Returns the default value if the fig is not found or evaluation fails.

#### `on(key: string, callback: (value: unknown) => void): void`
Registers a listener for configuration changes on a specific key.

#### `close(): void`
Stops polling and cleans up resources.

## Development

1. **Setup Environment**:
    ```bash
    npm install
    ```

2. **Build**:
    ```bash
    npm run build
    ```

3. **Run Tests**:
    ```bash
    npm test
    ```

4. **Clean**:
    ```bash
    npm run clean
    ```

## TypeScript Support

This library is written in TypeScript and includes type definitions. No additional `@types` packages are needed.

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

## Support

- [Documentation](https://docs.figchain.io)
- [Issues](https://github.com/figchain/js-client/issues)
- [Contact](mailto:support@figchain.io)
