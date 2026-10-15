# Deploy ESG Social Studio to Vercel

The repository is configured as **one Vercel project**. It builds the React
frontend as static assets and Express as a bundled Node.js function using
[Vercel Build Output API v3](https://vercel.com/docs/build-output-api).
No long-running server, Replit proxy, or Replit AI credentials are required.

## 1. Import the repository

- Import the Git repository into Vercel.
- **Root Directory:** repository root, not an individual artifact folder.
- **Framework Preset:** Other.
- **Build Command:** `pnpm run build:vercel` (already in `vercel.json`).
- **Install Command:** `pnpm install --frozen-lockfile` (already configured).
- Leave **Output Directory** unset. The build writes `.vercel/output` directly.
- Node.js 22 is used by the generated API function.
- Allow a 300-second function duration. Enable Fluid compute and check your
  plan's duration allowance if Vercel rejects that setting.

The custom build intentionally does not build the canvas/mockup sandbox.

## 2. Add server-only environment variables

In **Vercel → Project Settings → Environment Variables**, add these for every
environment you will use, including Preview and Production:

| Name | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | The existing direct Claude API key. |
| `DATABASE_URL` | A PostgreSQL connection string reachable from Vercel. |

Use your database provider's recommended **pooled, TLS-enabled** connection
string for serverless applications. Keep required SSL parameters in the URL.
Localhost and private Replit development database addresses are not reachable
from Vercel. The app does not create, replace, or migrate the existing database.
Use the existing database only if it is accessible from Vercel; otherwise
configure a separate PostgreSQL database and decide separately whether any
existing data should be moved.

**Do not put either secret in a `VITE_` variable or commit a populated `.env`
file.** Replit Secrets are not automatically copied into Vercel.
`PORT` and `BASE_PATH` are not needed on Vercel.
OpenAI/Gemini managed integrations remain optional Replit-only alternatives;
the UI uses direct Claude and needs neither integration's credentials.

## 3. Prepare the database before first use

An existing compatible database already containing this application's tables
needs no schema changes. For a **new, empty database**, securely configure its
`DATABASE_URL` in the terminal performing initialization, then run:

```sh
pnpm --filter @workspace/db push
```

Review the proposed schema changes before applying them. Do not use
`push-force` against a populated database. Database changes are deliberately
not run automatically by the Vercel build.

## 4. Protect access before sharing

**The app currently has no application sign-in. Anyone who can reach its API
can generate posts using your paid Claude key and access or modify shared
articles and drafts.** Configure Vercel Deployment Protection for every
environment that contains real credentials/data, including Production.
Protection options depend on your Vercel plan; do not assume a protected
preview also protects Production.

If adequate protection is unavailable on your plan, add application
authentication before opening the deployment to the public. This deployment
configuration does not add authentication or rate limiting.

## 5. Publish and verify

After configuring the environment, database, and access protection, trigger a
deployment in Vercel. Check:

1. `/` loads the studio and its fonts/assets.
2. `/api/healthz` returns a healthy response.
3. `/api/sources` returns data rather than a missing-table error.
4. Generate a post from a public article and test Copy.
5. Refresh: saved data remains in PostgreSQL.

If credentials are added after a deployment was built, redeploy so that the
function receives them. Function logs in Vercel show the actual failure.

## Local build verification

```sh
pnpm run build:vercel
pnpm run test:vercel
```

The smoke test runs the actual bundled API with dummy database settings and
without any Replit-specific credentials. It does not contact a database, call
Claude, change data, or publish anything.

The normal Replit development workflows are unchanged.
