import { runProviderCompatibilitySmoke } from "../src/lib/provider-compatibility-smoke";

const successful = await runProviderCompatibilitySmoke();
process.exitCode = successful ? 0 : 1;
