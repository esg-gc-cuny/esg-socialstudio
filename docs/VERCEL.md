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

**Do not put the secret in a `VITE_` variable or commit a populated `.env`
file.** Replit Secrets are not automatically copied into Vercel.
`PORT` and `BASE_PATH` are not needed on Vercel.
OpenAI/Gemini managed integrations remain optional Replit-only alternatives;
the UI uses direct Claude and needs neither integration's credentials.

## 3. Data handling

No database, `DATABASE_URL`, or schema initialization is required. Articles
are processed per request. Drafts and edits remain in the current browser tab
and clear on refresh. There is no article library or saved post history.
Any existing database records are left untouched and are no longer used by
this tool.

## 4. Protect access before sharing

**The app currently has no application sign-in. Anyone who can reach its API
can generate posts using your paid Claude key.** Configure Vercel Deployment Protection for every
environment that contains real credentials/data, including Production.
Protection options depend on your Vercel plan; do not assume a protected
preview also protects Production.

If adequate protection is unavailable on your plan, add application
authentication before opening the deployment to the public. This deployment
configuration does not add authentication or rate limiting.

## 5. Publish and verify

After configuring the environment and access protection, trigger a
deployment in Vercel. Check:

1. `/` loads the studio and its fonts/assets.
2. `/api/healthz` returns a healthy response.
3. Paste source text and generate posts for the selected platforms.
4. Generate a post from a public article and test Copy.
5. Reset posts clears the drafts; refresh clears the current article and drafts.

If credentials are added after a deployment was built, redeploy so that the
function receives them. Function logs in Vercel show the actual failure.

## Local build verification

```sh
pnpm run build:vercel
pnpm run test:vercel
```

The smoke test runs the actual bundled API without database settings or
Replit-specific credentials. It does not call Claude, change data, or publish
anything.

The normal Replit development workflows are unchanged.
