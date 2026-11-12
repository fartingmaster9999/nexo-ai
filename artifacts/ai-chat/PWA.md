# Install Nexo AI on ChromeOS

Nexo AI is an installable web app; it does not require the ChromeOS Linux environment.

1. Publish the app to an HTTPS URL.
2. On the Chromebook, open that URL in Chrome and sign in to the network.
3. Select Chrome's **Install Nexo AI** action in the address bar or browser menu.
4. Launch Nexo from the Chromebook launcher.

The app shell can be reopened offline after it has been cached, but chat, Agent model calls, and Nexo Live need an internet connection. The service worker only caches the app shell and static assets; it does not cache `/api` responses, provider keys, or conversation data.
