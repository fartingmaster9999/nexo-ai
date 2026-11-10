# Nexo Live — Own Mark Reveal

## Director's treatment

- **Promise:** Nexo Live is real-time voice conversation using the Gemini Live API.
- **Identity:** Follow the Nexo Agent Reveal reference: near-black `#030812`, cobalt `#1769ff`, electric blue `#55a9ff`, white `#f4f7ff`; Space Grotesk with DM Sans and JetBrains Mono.
- **Hero:** A distinct Nexo Live voice-mark, designed for this sub-product. It pairs an open echo-ring with a three-stroke live meter and is not a redraw of the Nexo parent glyph.
- **Motion:** One steady bottom-up rise, then a soft dissolve to a quiet centered product lockup.
- **Arc:** The custom Live mark arrives alone, aligns, and remains present as the Nexo Live wordmark and accurate feature descriptor resolve.
- **Payoff:** The new sub-brand mark and wordmark lock up cleanly; no concept narrative, interface mockup, slogan, or added product claim.
- **Format/runtime:** Preserve 16:9. Six seconds total, matching the Agent Reveal's 1.8s + 4.2s pacing.
- **Audio:** None. No music, VO, SFX, audio element, or audio playback.

## Shot timeline

| Shot | Time | Focus / action | Composition | Handoff |
|---|---:|---|---|---|
| 01 | 0.00–1.80 | A macro crop of the new Nexo Live voice-mark rises smoothly and settles at its final center point. | Full-bleed near-black; custom mark at 3.3x; no copy or graphic movement. | The mark stays still while the end card dissolves in around its center. |
| 02 | 1.80–6.00 | The custom voice-mark, Nexo Live wordmark, and a single factual feature capsule resolve together. | Quiet centered lockup, still and readable; sparse blue diagonal corner details. | Final card remains fully visible through the loop boundary. |

## Full shot script

### Shot 01 / 0.00–1.80s / 1.80s — "LIVE MARK."

- **Purpose:** Give Nexo Live its own recognizable mark, introduced with the same quiet anticipation as the Agent Reveal reference.
- **Exact content:** Only the custom white-and-blue Live voice-mark from `public/images/nexo-live-mark.svg`. No parent Nexo glyph, headline, caption, slogan, decorative waveform, or feature copy.
- **Composition:** Near-black `#030812`. A 22vmin square logo plane is anchored at 50% x / 35% y, enlarged to a fixed 3.3x. The symbol starts 32vh below its final vertical anchor; cropping is intentional. No blue shutters or decorative lines.
- **Artistic idea:** The new mark's open echo-ring and center meter read as a single silhouette at macro scale, then travel upward to the exact anchor they will occupy in the Nexo Live lockup.
- **Timed choreography:** At 0.00s, the logo is already visible at 3.3x, centered 32vh below the destination. From 0.00–1.55s it rises smoothly to `y: 0` without scale, opacity, rotation, or spring changes. From 1.55–1.80s it holds perfectly still. At 1.80s the end card begins a 0.55s dissolve around the same logo center.
- **Transition contract:** Shot 02's smaller custom Live mark uses the same center point. The macro stays still beneath the incoming card; both scenes overlap with a 0.55s opacity dissolve and no blank frame, flash, wipe, or position shift.
- **Assets and technique:** New sub-brand asset `public/images/nexo-live-mark.svg`; one image plane, fixed 3.3x scale, and vertical `y` translation only. The parent Nexo mark is not altered or redrawn.
- **Sound intent:** Silence; no audio stream or audio element.

### Shot 02 / 1.80–6.00s / 4.20s — "NEXO LIVE."

- **Purpose:** Resolve the custom Live mark as a distinct Nexo product identity and state its real feature directly, without implying a particular answer or inventing an interface.
- **Exact content:** `NEXO LIVE`; capsule text `Real-time voice conversation using Gemini Live API`. No other copy.
- **Composition:** A static near-black card with very restrained cobalt diagonal edge panels and a thin blue rule. The custom Live mark is centered at the same x/y point as Shot 01, at 18vmin. `NEXO LIVE` sits beneath it in Space Grotesk. The feature capsule sits below the name in DM Sans with a thin cobalt outline. Keep generous negative space and safe margins.
- **Artistic idea:** The close mark keeps its anchor as the wordmark and feature resolve softly around it; the reveal changes only scale and context.
- **Timed choreography:** 0.00–0.55s: linearly fade the complete card in over the still-visible macro mark; the macro exits over the same interval. Do not scale or move the card. 0.55–4.20s: hold the complete mark, name, and feature capsule still and fully legible. The last frame is the full lockup.
- **Transition contract:** The Live mark center remains fixed at 50% x / 35% y across the dissolve. The complete card is unmodified once revealed; final frame holds into the loop.
- **Assets and technique:** New Nexo Live mark at `public/images/nexo-live-mark.svg`, local font imports, static CSS diagonal corner geometry, and a single opacity crossfade. No parent logo, Agent Mode artwork, or Agent Mode text is reused.
- **Sound intent:** Silence; no music, voiceover, sound effect, `<audio>` element, or exported audio track.

## Revision integrity

- The user's request replaces the prior illustrative four-shot concept with the restrained two-shot logo reveal. The feature copy is limited to the explicit fact supplied in the feedback.
- This revision replaces the parent Nexo symbol in the current reveal with a distinct Live voice-mark and updates both shots to use it.
- `public/images/nexo-live-mark.svg` is the only logo asset used or shipped by this trailer; the prior copied parent-logo file is removed.
- Keep `VIDEO_ASPECT_RATIO` and artifact metadata at 16:9. Keep `useVideoPlayer({ durations: SCENE_DURATIONS })` so recording and looping remain scaffold-owned.
- Remove audio completely rather than default-muted playback. The revised film has no audio asset, audio element, audio hook, or audio UI registration.
- Reference inspected: `artifacts/nexo-agent-reveal/SCRIPT.md`, `VideoTemplate.tsx`, `src/index.css`, `index.html`, `public/images/nexo-agent-splash.png`, and `public/video/nexo-agent-mode.mp4`. The Agent asset establishes the source image/palette approach; the Nexo Live reveal uses only the supplied Nexo logo and its own accurate product label.
