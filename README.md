# ESG Social Studio

A simple tool that generates social media posts from articles using Claude.

## Features

- Paste article text or enter a public article link.
- Generate posts for LinkedIn, Facebook, Bluesky, and Substack Notes.
- Turn relevant hashtags on or off.
- Review, edit, and copy each post.
- Reset the displayed posts.

The tool does not publish posts automatically.

## Requirements

- Node.js and pnpm
- An Anthropic API key

Configure these server-side environment variables:

```text
ANTHROPIC_API_KEY
```

Do not commit secret values.

## Setup

```sh
pnpm install --frozen-lockfile
```

In Replit, start the API Server and ESG Social Studio web workflows.

## Deployment

See [Vercel setup](docs/VERCEL.md).

## Notes

Review generated posts before using them. Some websites block article extraction;
paste the text instead.

The tool has no sign-in. Protect access before sharing a deployment.

No database is required. Articles and drafts stay in the current tab and clear
when the page is refreshed.
