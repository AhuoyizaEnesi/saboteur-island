# Known issues and limits

Non blocking issues logged during the build. Fixed items move to the bottom with the fix noted.

## Accepted limits (explained in the writeup)

- **Vision is drawn in the browser.** Player positions live in records every player can read, so someone inspecting the raw data could see past their vision circle. Filtering records per player is not something the records layer offers, and for a party game we accept it.
- **Positions are reported by browsers.** Presence carries live movement and the server cannot read it, so browsers also send checkpoints. The server pulls back any move faster than walking speed, but a cheater could still fake small moves.
- **One browser runs the clock.** The host's browser (or the first online human's) calls `tick` every second. If every human closes the tab, the game pauses until someone returns.

## Open

- Reporting a wreck or ringing the bell waits a few seconds for the AI players' meeting lines before the meeting opens.
- Fonts come from Google Fonts. Where that is blocked, the page falls back to the system font.

## Fixed
