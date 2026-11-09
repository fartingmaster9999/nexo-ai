---
name: Browser storage event semantics
description: Cross-tab tests for localStorage removals and clears.
---

A browser `storage` event is delivered to other same-origin documents, not to the document that called `setItem`, `removeItem`, or `clear`. A clear event has a null key, so listeners should reread the storage state rather than relying on one specific key.

**Why:** Tests that mutate storage in the same document cannot verify the cross-tab listener. Clearing from an app tab also leaves its own in-memory UI unchanged unless the app explicitly updates it.

**How to apply:** Trigger storage mutations from another same-origin tab, assert the receiving tabs update, and verify receivers do not write defaults back.
