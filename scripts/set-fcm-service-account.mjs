import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const filePath = process.argv[2];

if (!filePath) {
  console.error('Usage: npm run fcm:service-account -- /path/to/firebase-service-account.json');
  process.exit(1);
}

const raw = await readFile(resolve(filePath), 'utf8');
let json;
try {
  json = JSON.parse(raw);
} catch (error) {
  console.error(`Invalid JSON: ${error.message}`);
  process.exit(1);
}

const missing = ['project_id', 'client_email', 'private_key'].filter((key) => !json[key]);
if (missing.length) {
  console.error(`Missing required service account fields: ${missing.join(', ')}`);
  process.exit(1);
}

function putSecret(name, value) {
  return new Promise((resolveSecret, rejectSecret) => {
    const child = spawn('npx', ['wrangler', 'secret', 'put', name], {
      stdio: ['pipe', 'inherit', 'inherit']
    });
    child.stdin.end(value);
    child.on('close', (code) => {
      if (code === 0) resolveSecret();
      else rejectSecret(new Error(`wrangler secret put ${name} failed with code ${code}`));
    });
  });
}

await putSecret('FCM_SERVICE_ACCOUNT_JSON', JSON.stringify(json));
await putSecret('FCM_PROJECT_ID', json.project_id);

console.log(`FCM service account configured for project ${json.project_id}. Run: npm run deploy`);
