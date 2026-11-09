# Nexo AI Public

Nexo AI Public is the separate BYOK version of Nexo. It shares the canonical Nexo chat interface and Agent workspace, but public requests must carry provider keys entered by the visitor. The existing private-key app remains at `/`; the public version is available at `/nexo-public/`.

## Publish on Vercel

1. Push the repository to GitHub.
2. Import the repository into Vercel with the repository root (`.`) as the project root. Do not set the project root to `artifacts/nexo-public`; the root `vercel.json` builds the public frontend and routes its API requests.
3. Deploy. The public app is served at `/nexo-public/`; the existing app remains at `/`.
4. Do not configure your own Groq or Gemini key for the public endpoints. `/api/public/*` only uses keys supplied by the visitor in Settings.

## Set up a visitor's keys

1. Open **Settings** in Nexo AI Public.
2. Add a Groq API key. It is required for chat and Agent mode.
3. Optionally add a Gemini API key to enable image understanding and expanded Agent capabilities.
4. Save the keys and start a conversation. Agent mode remains usable without Gemini but displays a warning that some features may be limited.

Visitors can create keys at [Groq Console](https://console.groq.com/keys) and [Google AI Studio](https://aistudio.google.com/apikey). Provider account quotas, terms, and any billing are controlled by the visitor's provider account; Nexo does not supply model usage.

## Key handling

- Keys are saved in the visitor's browser storage on that device.
- The browser sends keys in request headers over HTTPS to this app's API, which forwards them to the selected provider for that request.
- The API does not write these headers to request logs or store the keys in the Nexo database.
- Users should not save keys on shared devices. They can clear either key from Settings; clearing Groq disables chat until another Groq key is entered.
- As with any same-origin web app, malicious browser extensions or a script-injection vulnerability could access local browser storage. Keep the app dependencies and deployment origin trusted.
