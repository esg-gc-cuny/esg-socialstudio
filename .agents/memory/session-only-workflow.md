---
name: Session-only workflow
description: User decision to remove database-backed article and post storage.
---

The tool should not require a database or retain article/post history. Article
text, generated drafts, and edits stay in the current tab and clear on refresh.
Reset posts should clear results, not the source input. Existing database
records must be left untouched.

**Why:** The user chose the simpler, database-free workflow after being told
that refreshing would clear the current work and simplify Vercel setup.

**How to apply:** Keep generation request-local and submit source content
directly. Do not reintroduce database-backed history or browser persistence
without asking. Server restarts must not require recreating source IDs.
