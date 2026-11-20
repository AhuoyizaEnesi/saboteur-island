# Known issues and limits

Non blocking issues logged during the build. Fixed items move to the bottom with the fix noted.

## Accepted limits (explained in the writeup)

- **Vision is drawn in the browser.** Player positions live in records every player can read, so someone inspecting the raw data could see past their vision circle. Filtering records per player is not something the records layer offers, and for a party game we accept it.
- **Positions are reported by browsers.** Presence carries live movement and the server cannot read it, so browsers also send checkpoints. The server pulls back any move faster than walking speed, but a cheater could still fake small moves.
- **One browser runs the clock.** The host's browser (or the first online human's) calls `tick` every second. If every human closes the tab, the game pauses until someone returns.

## Open

- If two browsers both think they should run the clock for a moment (for example right after the host's tab comes back to the front), two ticks can overlap. Votes are protected by a uniqueness rule, but a phase change could be logged twice. Presence settles the choice within a second.
- Reporting a wreck or ringing the bell waits a few seconds for the AI players' meeting lines before the meeting opens. Voting opens the same way while AI votes are decided.
- A human message in a meeting waits for the AI reply call before the send finishes. The message itself shows right away; the AI replies follow with a typing indicator.
- AI votes are hidden until they appear, so a human cannot see who an AI player is leaning toward before arguing.
- Fonts come from Google Fonts. Where that is blocked, the page falls back to the system font.

## Decisions

- Polish pass dropped. Peace reviewed a cartoon sample (toon shading, outlines, rounded shapes, chunkier HUD) and kept the original look.

## Fixed

Peace's test feedback (Nov 20):
- The AI Impostor wrecked too fast: up to 13 wrecks a game. Now its first wreck waits 75 seconds and the next ones come every 60 to 80 seconds, with lights out at most twice. A sim game showed 3 wrecks and 2 lights outs.
- The order box filled in the prompt. Now it starts empty, shows the task details, and the builder makes up any detail a vague prompt leaves out (right 1 time in 3), with a line explaining the miss.
- Wrecks were instant. Builds now take 8 seconds and wrecks 4, standing at the landmark. Walking away cancels both.
- AI players only answered when named, once. Now every human message gets 1 or 2 replies, the AI player spoken to always answers with its own alibi, and opening lines are a back and forth.
- Nobody got ejected: AI votes were locked when the meeting opened and unsure crew always skipped. Now AI players vote after the whole discussion, follow a strong case, can be swayed during voting, and everyone can change their vote until time runs out.
- Tasks were one short line. Now each names the place, the object, a color or count, and a reason.
- The order box, lights banner and toasts were pushed off center by their slide in animation.
