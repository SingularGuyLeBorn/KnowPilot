/** CLI：pnpm --filter @knowpilot/server exec tsx src/scripts/feishu-authorize.ts */
import { loadRootEnv } from "../infra/config.js";
import { authorizeUserViaBrowser } from "../infra/external/larkTokenManager.js";

loadRootEnv();
const result = await authorizeUserViaBrowser({ timeoutSec: 180 });
console.log(JSON.stringify(result, null, 2));
process.exit(result.success ? 0 : 1);
