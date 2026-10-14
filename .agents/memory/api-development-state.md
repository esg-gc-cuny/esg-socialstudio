---
name: API development state
description: Source and campaign persistence during local API workflow restarts.
---

The development API's saved source and campaign state may disappear when its workflow restarts. Do not assume a source ID remains valid across restarts.

**Why:** Generation testing returned “Source not found” for a source that had been created successfully before the API workflow restarted.

**How to apply:** After restarting the API, extract and save the article again before testing generation. Use a fresh source ID.
