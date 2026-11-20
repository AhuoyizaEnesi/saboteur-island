# Saboteur Island: submission write-up (draft)

Fill the bracketed parts after the live run sheet in SPEC.md section 15.

**Live:** [URL]
**Repo:** https://github.com/AhuoyizaEnesi/saboteur-island

## What I built

Saboteur Island is a multiplayer party game for 5 or 6 players. The crew walk around a floating 3D island and finish tasks before a 7 minute night clock runs out. Every task is done by writing your own prompt to an AI builder at a landmark. The task says what is needed, like a yellow bird on the roof, and the player has to put it into words. A vague prompt gets made up details, so the game teaches people to prompt clearly. One player is secretly the Impostor. They wreck finished tasks when nobody is near and cut the lights to hide. A wreck leaves smoke. Anyone who finds it can report it, and everyone meets, argues and votes. AI players fill empty seats, walk their own routes, do their tasks, report what they find, and argue in meetings from what they actually saw. One person can play a full game alone.

## DeepSpace integrations

I used 6:

1. **Auth.** Every player is signed in, and every server action knows who is calling.
2. **Records with live sync.** Games, players, builds, wrecked spots, votes and chat are records. Every screen draws from them.
3. **Permissions.** Roles and task lists use `ownerField` with read `own`, so the server hides the Impostor, not the interface. Wreck clues are readable by no role at all.
4. **Presence.** Live walking. Each browser broadcasts its position about 10 times a second.
5. **Server actions.** Every write. Browsers have read only access to every game collection, and each action checks phase, role, distance and cooldowns.
6. **AI.** The builder turns typed prompts into catalog objects, in build mode for the crew and wreck mode for the Impostor. In meetings, the model writes AI players' opening lines, replies to every human message, and decides AI votes from the whole chat and each AI player's private clues.

I left out cron because its 1 minute minimum is too slow for a 30 second vote; the host's browser calls `tick` every second instead. I left out messaging because meeting chat is short lived and belongs to the game. Nothing is edited together, so Yjs and canvas did not fit.

## Main tradeoff

Vision and movement trust the browser more than a shooter would. Live positions travel over presence, which the server cannot read, so browsers also send a checkpoint every 1.5 seconds and the server clamps any move faster than walking speed. Vision is drawn in the browser, and positions sit in records every player can read, so a player inspecting raw data could see past their vision circle. A server streaming filtered state to each player would close that, but records have no per player filtering and it would mean building my own realtime layer. For a party game among friends I chose the platform primitives and wrote the limit down in ISSUES.md.

Three smaller tradeoffs. AI players do their tasks with fixed builds instead of the model, which keeps cost to one model call per human order, plus a few per meeting: one to open it, one per human message (capped at 10), and one for votes. Every model call has a non AI fallback, so the game never stalls if the model is down. Model calls bill my account as the app owner, not the player, so anyone who signs in can play without credits of their own. A 4 second order cooldown, 4 objects per order and 220 objects per game cap what one player can spend.

## What the agent did

Claude wrote the code: the server actions, the schemas and permissions, the builder and meeting AI, the AI player routes, the three.js island, the game screen, the landing page and the tests. I directed the design and made the calls that shaped it: [list the decisions, for example: tasks done through the AI builder, sabotage instead of killing, walking kept with a vision circle, the night clock]. I set up the repo and the DeepSpace app, ran every CLI command, and played the game.

## What I verified

- [ ] 44 unit tests pass, including whole games played through the real server actions with the model offline.
- [ ] Solo game as crew against 4 AI players, played to an ending: [result]
- [ ] Solo game as Impostor: [result]
- [ ] Two browsers in one game: walking, a task, a wreck, a report, a vote, an ejection: [result]
- [ ] Lights out and the fix at the Power Shed: [result]
- [ ] Night falling ends the game: [result]
- [ ] Phone: [result]
- [ ] Changes I made after testing: [list]
