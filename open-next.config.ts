import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Default config: in-memory incremental cache. Adding r2IncrementalCache would
// require an R2 bucket binding; ISR/SSG revalidation is not used by this app
// (every page is dynamic), so the extra bucket would buy nothing.
export default defineCloudflareConfig({});
