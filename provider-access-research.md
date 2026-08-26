# OpenRouter Free-Access Findings

Source reviewed on 2026-08-22: [OpenRouter API Credit & Rate Limits](https://openrouter.ai/docs/api_reference/limits).

- OpenRouter documents `GET /api/v1/key` as the endpoint for inspecting a key’s configured credit limit and remaining allowance.
- HTTP 402 is an account or per-key credit-limit failure. The official guidance is to check account balance and the key’s `limit_remaining` value.
- Free variants have a separate request limit: accounts with less than USD 10 in purchased credits are documented as having 20 requests per minute and 50 requests per day; accounts at or above that threshold have 20 requests per minute and 1,000 requests per day.
- A successful model-catalog response therefore does not prove that a key can execute a free-model completion. GODMODE must verify execution eligibility before describing an OpenRouter model as usable.

Source reviewed on 2026-08-22: [OpenRouter Authentication](https://openrouter.ai/docs/api_reference/authentication).

- OpenRouter requires a Bearer API key for direct API use. Keys can have an optional per-key credit limit, so an account can have access while an individual key remains capped.

## Redacted Live Verification — 2026-08-23

The stored OpenRouter connection passed a real eligibility probe and exposed 19 text-chat models after non-text audio-capable catalog entries were excluded. A minimal `openrouter/free` completion returned the expected fixed response in 4.0 seconds, using 49 total tokens. A streamed Cohere free-model probe produced its first text in 4.2 seconds and completed in 4.3 seconds, using 56 total tokens.

An immediate additional probe received HTTP 429, confirming that the account can be rate-limited even when access eligibility is healthy. GODMODE now distinguishes this provider-side rate limit from queue congestion in its fallback status. A live native web-research probe returned the official OpenRouter limits URL successfully, but took 9.4 seconds and used 800 total tokens; research is therefore intentionally presented as a slower, optional mode.

The historical completed chat rows showed 7.3–24.8 second responses with 3,851–4,151 prompt tokens. The new minimal live streaming probe produced first text in 4.2 seconds and completed in 4.3 seconds. A separate 11,631-character saved-prompt probe compiled the sent system policy to 975 characters and produced a real 211-prompt-token / 271-total-token completion, confirming that the fast policy materially reduces upstream payload size.

A second live native research probe confirmed that OpenRouter returned `url_citation` annotations, which GODMODE converted into three rendered Markdown source links. That request took 13.8 seconds and used 2,881 total tokens. Research currently uses a non-streamed provider response because citations arrive in the final annotation payload, so the UI now immediately labels the request as research in progress and shows a cited-research marker only once the final linked response is rendered.

The complete user-scoped chat service was then exercised with live research. It persisted a completed assistant record with `researchMode: yes`, appended Markdown citation links, stored a final-only total latency of 24.6 seconds and 2,668 tokens, and deliberately left `firstTokenMs` empty because this citation-bearing research route is non-streamed.
