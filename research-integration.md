# Native Web Research Integration

GODMODE’s OpenRouter research mode uses the documented `openrouter:web_search` server tool in Chat Completions. The request includes `tools: [{ type: "openrouter:web_search", parameters: { engine: "native", max_results: 3, search_context_size: "low" } }]`. The model decides whether a search is needed; returned URL citations are appended to the persisted assistant response as Markdown links.

Research is explicitly optional because native web searches may add latency and model/provider support can vary. Normal chat uses the fast-response profile instead.

Source: [OpenRouter Web Search Server Tool](https://openrouter.ai/docs/guides/features/server-tools/web-search)
