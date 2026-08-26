# GODMODE AI Android Delivery Plan

## Current status

GODMODE AI is presently a React/Vite web application backed by Express, tRPC, Drizzle, and server-side encrypted provider credentials. **There is no APK in this repository.** An APK cannot safely be made by wrapping the development preview or by putting OpenRouter or Respan keys into a mobile bundle.

## Chosen delivery architecture

The safe Android path is a separate Expo/React Native companion application paired with a published HTTPS instance of this existing backend.

| Layer | Responsibility | Security boundary |
|---|---|---|
| Android companion | Conversations, provider-connection UI, settings, stream rendering, and device-safe session storage | It never receives provider secret material or server encryption secrets. |
| Published GODMODE API | Authenticated tRPC and streaming endpoints, provider invocation, encrypted provider-key storage, persistence | It remains the only layer that encrypts, decrypts, or invokes OpenRouter and Respan credentials. |
| Database | User-scoped conversations, messages, configurations, and fallback preference | Accessed only by the server. |

## Required work before a real APK

1. **Publish the web backend** from the project interface so the companion has a stable HTTPS API. The development preview URL is not a production mobile API.
2. **Create a distinct Expo mobile project** rather than modifying this web package. It should use the same chat API contracts and a native OAuth/deep-link callback that can establish an authenticated mobile session.
3. **Implement the necessary mobile screens**: sign-in, conversations, thread view, composer with streamed output, provider configuration, system-prompt save state, research citations, and the explicit Respan fast-stream fallback consent.
4. **Use platform-secure storage only for the authenticated session**, not for provider API keys. Provider key entry must be sent directly over HTTPS to the existing server configuration route and never retained by the mobile app.
5. **Run Android acceptance tests** against the published API: login, provider-key verification, direct and research chat, streamed first text, persisted messages, error diagnostics, and authorized Respan fallback attribution.
6. **Build and sign the release APK** with Android build tooling or an authorized cloud build account. This environment does not include an Android SDK/Gradle pipeline, and no signing key or cloud-build credential has been supplied; therefore no installable APK can be honestly produced here yet.

## Explicit non-goals

The companion must not embed a web development URL, hard-code server credentials, expose user provider keys, or claim that a local-only CLI server is reachable from an Android device. The current npm CLI remains a local browser/terminal workflow; it is not an Android backend.

## Next decision

After the backend is published, create the companion as a separate Expo project, complete its real API/auth flows, then generate a signed APK. The downloadable APK should be delivered only after those integration checks pass.
