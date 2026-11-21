# Saboteur Island

**Live:** https://saboteur-island.app.space
**Repo:** https://github.com/AhuoyizaEnesi/saboteur-island

## What I built

Like Among Us, but every task is practice in prompting an AI.

5 or 6 players fix up a floating 3D island before a 7 minute night clock runs out. One of them is a secret Impostor who wrecks finished work and cuts the lights. Every task is a request from an islander, written as a hint: "Put one up high where I can see it from my window, in the color of a lemon." The player has to turn that into a precise prompt for an AI builder. The builder shows how it read each prompt, fills gaps with plain defaults, and takes fixes like "make it yellow". A wreck leaves smoke, a report calls a meeting, and humans and AI players argue and vote. AI players fill empty seats, so one person can play a full game. Practice mode removes the Impostor and the clock so players can focus on their prompts.

## DeepSpace integrations (6)

- **Auth:** every server action knows who is calling.
- **Records:** games, players, builds, votes and chat are live records that every screen draws from.
- **Permissions:** roles and task lists use `ownerField` with read `own`. The server hides the Impostor, not the interface. Wreck clues are readable by no one.
- **Presence:** live walking at about 10 updates a second, with nothing stored.
- **Server actions:** every write. Browsers are read only, and each action checks phase, role, distance and cooldowns.
- **AI:** the builder can only place catalog objects through tools, and it never sees the task, so it cannot leak the answer. In meetings, AI players argue from their own private clues and vote after the discussion.

I left out cron because its 1 minute minimum is too slow for a 30 second vote, so the host's browser runs the clock. Meeting chat lives with the game, so messaging was not needed. Nothing is edited together, so Yjs and canvas did not fit.

## Main tradeoff

I chose platform primitives over a custom realtime server. Presence is fast but the server cannot read it, so browsers also send a checkpoint every 1.5 seconds and the server rejects any move faster than walking. Positions sit in records every player can read, so someone inspecting raw data could see past their vision circle. Closing that would mean building my own realtime layer. For a party game among friends, that cost was not worth it, and I logged the limit in ISSUES.md.

## What the agent did

Claude wrote the code and the tests. I directed it, tested every change, and changed course when the result was wrong:

- I made players write their own prompts, with no autofill, so the game teaches prompting.
- Playtests showed the AI Impostor wrecking too fast, so I made every wreck take at least half as long as a fix.
- Nobody was ever ejected, so I had AI votes moved after the discussion and made them open to persuasion.
- I asked for Practice mode to test prompting without the interruption of the gameplay.
- The AI was the Impostor too often, so people now get the role more often, and a solo player can pick.
- I rejected a cartoon restyle the agent built and kept the original look.

## What I verified

- 76 automated tests pass. 16 of them play whole games through the real server actions.
- On the live site, "a lemon colored bird up high" was read as "a yellow bird", which proves the model runs in production. 63 model calls cost $0.02.
- No secrets are in the repo. The model runs through the DeepSpace AI integration, billed to the app owner.
- Two players on two continents: [result]
- Solo as Crew and as Impostor: [result]

## Unfinished and next

- A browser runs the game clock, so if every player closes the tab, the game pauses until someone returns.
- Next, I would spend more time on the prompts and the gameplay, so each prompt is something worth writing and building.
