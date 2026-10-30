// Cross-client e2e runner for the JS client (built dist/). Driven by
// figchain-clients/e2e/run.py; prints one `E2E-RESULT {json}` line.
const { FigChainClient, BootstrapStrategy } = require('../dist');

const STRATEGIES = {
  'server-first': BootstrapStrategy.SERVER_FIRST,
  hybrid: BootstrapStrategy.HYBRID,
  'backup-only': BootstrapStrategy.S3_BACKUP_ONLY,
  listen: BootstrapStrategy.SERVER_FIRST,
};

function emit(result) {
  console.log('E2E-RESULT ' + JSON.stringify(result));
}

// JS has no generated types, so "typed" means the decoded record has the schema's field types.
function describe(mode, value) {
  if (!value || typeof value.currency !== 'string' || !Number.isInteger(value.maxItems)) {
    return { mode, ok: false, error: `not a CheckoutSettings: ${JSON.stringify(value)}` };
  }
  return { mode, ok: true, value: { currency: value.currency, maxItems: value.maxItems }, type: 'CheckoutSettings' };
}

async function main() {
  const mode = process.argv[2];
  const env = process.env;
  const client = new FigChainClient({
    baseUrl: env.FC_BASE_URL,
    clientSecret: env.FC_CLIENT_SECRET,
    environmentId: env.FC_ENVIRONMENT_ID,
    tenantId: env.FC_TENANT_ID,
    namespaces: [env.FC_NAMESPACE],
    bootstrapStrategy: STRATEGIES[mode],
    pollInterval: 1,
    maxRetries: 1,
    retryDelayMs: 100,
    s3BackupEnabled: true,
    s3BackupBucket: env.FC_S3_BUCKET,
    s3BackupPrefix: env.FC_S3_PREFIX,
    s3BackupEndpoint: env.FC_S3_ENDPOINT,
    s3BackupRegion: env.AWS_REGION,
    s3BackupPathStyleAccess: true,
    encryptionPrivateKey: env.FC_ENCRYPTION_PRIVATE_KEY,
  });
  const key = env.FC_FIG_KEY;
  try {
    await client.init();
    if (mode !== 'listen') {
      emit(describe(mode, await client.getFig(key)));
      return;
    }
    const initial = JSON.stringify(await client.getFig(key));
    const changed = new Promise((resolve) => {
      client.on(key, (v) => {
        if (JSON.stringify(v) !== initial) resolve(v);
      });
    });
    console.log('E2E-READY');
    const timeout = new Promise((resolve) => setTimeout(resolve, 1000 * Number(env.FC_LISTEN_TIMEOUT || 60), null));
    const v = await Promise.race([changed, timeout]);
    emit(v ? describe(mode, v) : { mode, ok: false, error: 'listener saw no change' });
  } finally {
    client.close();
  }
}

main().then(() => process.exit(0), (e) => {
  emit({ ok: false, error: String(e && e.stack || e) });
  process.exit(1);
});
