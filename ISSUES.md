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
- The order box filled in the prompt. Now it starts empty and shows the task.
- Wrecks were instant. Builds now take 8 seconds and wrecks 4, standing at the landmark. Walking away cancels both.
- AI players only answered when named, once. Now every human message gets 1 or 2 replies, the AI player spoken to always answers with its own alibi, and opening lines are a back and forth.
- Nobody got ejected: AI votes were locked when the meeting opened and unsure crew always skipped. Now AI players vote after the whole discussion, follow a strong case, can be swayed during voting, and everyone can change their vote until time runs out.
- Tasks were one short line. Now each names the place, the object, a color or count, and a reason.
- The order box, lights banner and toasts were pushed off center by their slide in animation.

Peace's test feedback (Nov 20, evening):
- Ejected players could not move as ghosts. The ejection animation ran on frame time, so on a slow screen it was still playing when play resumed and the ghost never came back. It now runs on the clock and always ends as a ghost.
- Voting waited out the full timer. It now closes 3 seconds after everyone has voted.
- The camera angle was fixed. Dragging now turns it, and the movement keys follow the camera.
- There was no way to leave or end a game. Added Leave (an AI takes over) and End game for the host.
- Testing prompts meant playing a whole game around wrecks and meetings. Added Practice: just you and the builder, 4 tasks, no clock.

Peace's test feedback (Nov 20, late): the prompting felt off.
- Tasks spelled out the answer, so writing a prompt was copying. Now each task is a request in someone's words that hints at the details ("the color of a lemon").
- Where things went did not depend on the prompt. Now place words decide it, and some tasks check the place.
- A vague prompt got a coin flip, right 1 time in 3, which felt random. Now the builder uses the same default every time (a bird comes out brown) and never sees the task.
- There was no way to see how a prompt was read. Now an "I read" card shows each part and what the builder filled in.
- Fixing a miss meant building more on top. Now a prompt can recolor, move or remove what you built, in 3 seconds.
- Count tasks passed with extra copies. Now they need exactly that many, and a wreck hits every object of the task so redoing the prompt restores it.

Peace's feedback (Nov 21): the AI was the Impostor too often.
- Playing alone, a person was the Impostor only 1 game in 5, because the draw was even across all 5 seats. Now each person counts 4 times as much as one AI player, so alone it is about 1 in 2.
- Someone playing alone can now pick Random, Crew or Impostor in the lobby. With other people the pick is ignored, so nobody can tell who chose.

Peace's feedback (Nov 21, midday):
- A ghost froze after a second player was voted out. During that ejection the screen briefly stopped treating existing ghosts as ghosts, and the scene hid them for good. Now only the player being ejected changes, and a ghost is never hidden for good. Reproduced and verified in the test harness: after the second ejection the ghost walks again.
- After picking GitHub or Google in the sign-in box and pressing back, every button stayed disabled. The SDK's sign-in box disables its buttons when you pick a provider, and the browser restored the page from memory in that state. The app now reloads when the browser restores a page that way. GitHub sign-in itself works: it reaches GitHub's authorize page.
