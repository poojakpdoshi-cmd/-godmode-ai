# GODMODE AI

GODMODE AI is a multi-provider chat command center with encrypted in-app OpenRouter and optional Respan connections, persistent conversations, saved system prompts, streamed OpenRouter output, live web research, and truthful route metadata.

## Local browser + terminal use

The local CLI runs GODMODE on **`http://127.0.0.1:3000` only**. It creates one local operator in the local database; it does not use Manus OAuth in local mode. Provider keys are entered in the browser and encrypted at rest using your `JWT_SECRET`.

```bash
git clone <your-private-repository-url>
cd godmode-ai
pnpm install
pnpm godmode init
# Edit .env: set DATABASE_URL and JWT_SECRET
pnpm godmode db
pnpm godmode dev
```

Then open [http://127.0.0.1:3000](http://127.0.0.1:3000). In **Configuration**, connect your own OpenRouter key and, optionally, a Respan key. The built-in managed route is only available in the hosted project because it uses host-provided server credentials.

## CLI commands

| Command | Purpose |
|---|---|
| `pnpm godmode init` | Creates `.env` from the safe template. |
| `pnpm godmode doctor` | Checks local prerequisites without printing secrets. |
| `pnpm godmode db` | Generates and applies local database migrations. |
| `pnpm godmode dev` | Starts the loopback-only local development server. |

## Security notes

Do not commit `.env`. Use a unique, long `JWT_SECRET`; changing it makes stored encrypted provider keys unreadable. The local CLI does not rotate or pool keys to bypass any provider limits. When configured, Respan is a separate, transparently attributed fallback route.
