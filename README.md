# GODMODE AI

GODMODE AI is a multi-provider chat command center with encrypted in-app OpenRouter and optional Respan connections, persistent conversations, saved system prompts, streamed OpenRouter output, live web research, and truthful route metadata.

## Local browser + terminal use

The local CLI runs GODMODE on **`http://127.0.0.1:3000` only**. It creates one local operator in a local MySQL/TiDB database; it does not use Manus OAuth in local mode. Provider keys are entered in the browser and encrypted at rest using your `JWT_SECRET`.

### Windows PowerShell — exact copy/paste commands

Run these commands **one at a time** from a normal PowerShell window. Do not type angle brackets (`<` or `>`) around the repository URL.

```powershell
cd $HOME
git clone https://github.com/poojakpdoshi-cmd/-godmode-ai.git
cd .\-godmode-ai
corepack enable
corepack pnpm install
corepack pnpm approve-builds
# Select esbuild (and @tailwindcss/oxide if it is listed), then press Enter.
corepack pnpm rebuild
corepack pnpm godmode init
notepad .env
```

In the `.env` file, replace the sample `DATABASE_URL` with your running local MySQL/TiDB connection and replace `JWT_SECRET` with a long private random value. Save and close Notepad, then run:

```powershell
corepack pnpm godmode doctor
corepack pnpm godmode db
corepack pnpm godmode dev
```

pnpm requires you to explicitly approve dependency build scripts. Run `corepack pnpm approve-builds` **inside `-godmode-ai`**, select `esbuild` (and `@tailwindcss/oxide` if it appears), press Enter, then run `corepack pnpm rebuild`. Do not approve packages you do not recognize. If you still see **`ERR_PNPM_IGNORED_BUILDS`**, repeat this approval step from the project directory; do not run `pnpm godmode` from your home folder.

```powershell
corepack pnpm approve-builds
```

Then open [http://127.0.0.1:3000](http://127.0.0.1:3000). In **Configuration**, connect your own OpenRouter key and, optionally, a Respan or NVIDIA NIM key. The built-in Managed Fast route is only available in the hosted project because it uses host-provided server credentials.

> A local MySQL or TiDB server must be running before `corepack pnpm godmode db` can work. This repository does not install a database automatically and it never stores provider keys in the client bundle.

### Local database (optional, one command)

If you do not already have MySQL running, a loopback-only instance is included:

```powershell
docker compose up -d
```

Then use this `DATABASE_URL` in `.env`:

```
DATABASE_URL=mysql://godmode:godmode_local_dev@127.0.0.1:3306/godmode_ai
```

Those are local development defaults, not secrets. The published port is bound to `127.0.0.1` only.

### Reachability

The local server binds to `127.0.0.1` by design. It is reachable from the same machine's browser at [http://127.0.0.1:3000](http://127.0.0.1:3000) and from nowhere else — it will not respond on your LAN address, and it cannot be driven from a hosted preview or container dashboard. This is intentional, since the app stores encrypted provider keys in the local database.

## CLI commands

Always invoke these through pnpm (`corepack pnpm godmode …`). Do **not** run `npx godmode` — `npx` resolves an unrelated third-party package from the public registry instead of this repository's CLI.

| Command               | Purpose                                              |
| --------------------- | ---------------------------------------------------- |
| `pnpm godmode init`   | Creates `.env` from the safe template.               |
| `pnpm godmode doctor` | Checks local prerequisites without printing secrets. |
| `pnpm godmode db`     | Generates and applies local database migrations.     |
| `pnpm godmode dev`    | Starts the loopback-only local development server.   |

## Security notes

Do not commit `.env`. Use a unique, long `JWT_SECRET`; changing it makes stored encrypted provider keys unreadable. The local CLI does not rotate or pool keys to bypass any provider limits. When configured, Respan is a separate, transparently attributed fallback route.

## Android delivery

This repository does not contain an APK. See [the secure Android delivery plan](docs/android-delivery-plan.md) for the required published backend, native authentication, provider-key boundary, and build-signing prerequisites.
