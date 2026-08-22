# GODMODE AI — Architecture Decisions

GODMODE exposes a model only after live discovery reports the provider as both configured and healthy. The platform catalog is available through the built-in server-side integration, while OpenRouter support uses its documented model catalog and chat-completion endpoints with a server-only bearer credential. The application therefore presents unavailable providers as **unconfigured** or **degraded**, rather than synthesizing a model list or a successful outcome.

| Decision | Implementation consequence |
| --- | --- |
| Credentials remain server-side | The browser never receives a provider key. A locally hosted installation configures `OPENROUTER_API_KEY` in its host environment and restarts the server; the Model Registry then performs live verification. |
| Outputs are evidence, not optimistic state | A run becomes `succeeded` only after the provider response returns; failures retain the error, timing, and event records. |
| Competition does not fabricate a verdict | The same command is submitted to independently selected callable models, and the UI preserves each outcome and metadata without declaring a winner. |
| User-scoped data is mandatory | Project, mission, message, run, and event queries include the authenticated user identifier and reject unowned records. |

The OpenRouter provider contract follows the current documented `GET /api/v1/models` discovery endpoint and `POST /api/v1/chat/completions` request format.[1] [2]

The uploaded G0DM0D3 archive is a separate Next.js/API project with chat, model selection, settings, and OpenRouter-related modules. GODMODE will take only high-level functional inspiration from it; it will retain its own data model, server contracts, interface composition, and visual system. The optional Respan gateway is documented as an OpenAI-compatible provider using `https://api.respan.ai/api/` with a Respan API key; its exact catalog-discovery behavior will be verified with a supplied key before models are shown.[3]

GODMODE’s OpenRouter chat catalog operates under a free-only policy. A model is eligible only when every applicable OpenRouter catalog price field is zero; any paid usage component excludes the model. The catalog also includes the documented `openrouter/free` router, which selects an available free model at request time. Free-model availability and rate limits can change upstream, so the application discovers the catalog live rather than maintaining a hard-coded list.[4] [5]

## References

[1] [OpenRouter — List all models and their properties](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties)

[2] [OpenRouter — API reference](https://openrouter.ai/docs/api_reference/overview)

[3] [Respan — AI Gateway quickstart](https://www.respan.ai/docs/documentation/features/gateway/gateway-quickstart)

[4] [OpenRouter — Models API and pricing object](https://openrouter.ai/docs/guides/overview/models)

[5] [OpenRouter — Free Models Router](https://openrouter.ai/docs/guides/routing/routers/free-router)
