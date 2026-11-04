---
name: Connector runtime access
description: A connected integration may not be usable from the running application's identity.
---

Verify a new connector from application code, not only from the integration's ready status.

**Why:** Firecrawl showed ready after connection, while the application proxy returned “No firecrawl connection found for this customer” and sandbox credentials were withheld. This was an access-context mismatch, not evidence of an expired key.

**How to apply:** Do not repeatedly ask the user to reconnect a ready integration or extract its credentials. Report the runtime access problem, use an explicitly disclosed independent fallback if suitable, and keep failed retrieval visible.

A connector-proxy 404 can mean that the application's identity has no customer connection, rather than an incorrect upstream API path.

**Why:** Firecrawl returned the same missing-customer-connection error across valid API paths. Changing endpoint versions cannot repair that access-context mismatch.

**How to apply:** Inspect the sanitized error category before changing endpoint paths; never log identity tokens or raw credential-bearing responses.
