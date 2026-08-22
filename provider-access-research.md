# OpenRouter Free-Access Findings

Source reviewed on 2026-08-22: [OpenRouter API Credit & Rate Limits](https://openrouter.ai/docs/api_reference/limits).

- OpenRouter documents `GET /api/v1/key` as the endpoint for inspecting a key’s configured credit limit and remaining allowance.
- HTTP 402 is an account or per-key credit-limit failure. The official guidance is to check account balance and the key’s `limit_remaining` value.
- Free variants have a separate request limit: accounts with less than USD 10 in purchased credits are documented as having 20 requests per minute and 50 requests per day; accounts at or above that threshold have 20 requests per minute and 1,000 requests per day.
- A successful model-catalog response therefore does not prove that a key can execute a free-model completion. GODMODE must verify execution eligibility before describing an OpenRouter model as usable.

Source reviewed on 2026-08-22: [OpenRouter Authentication](https://openrouter.ai/docs/api_reference/authentication).

- OpenRouter requires a Bearer API key for direct API use. Keys can have an optional per-key credit limit, so an account can have access while an individual key remains capped.
