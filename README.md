# Saboteur Island

Like Among Us, but every task is practice in prompting an AI.

A multiplayer party game for 5 or 6 players, built on DeepSpace. The crew walk around a floating island and fix it up before night falls. One player is secretly the Impostor. They wreck finished work when nobody is looking and cut the lights to hide. Smoke gives the wreck away: report it, argue, vote, and launch someone into space. AI players fill empty seats, so one person can play a whole game.

Every task is done by writing your own prompt to an AI builder. A task is a request from someone on the island, in their words: "Put one up high where I can see it from my window, in the color of a lemon." The player turns that into a clear prompt, like "a yellow bird on the roof".

- **Place words matter.** "On the roof", "by the door" and "in the pond" decide where things go.
- **Missing details get a default.** Leave out the color and a bird comes out brown. The builder never sees the task, so it cannot guess the answer.
- **Every prompt shows how it was read.** An "I read" card lists what the builder took from it and what it filled in.
- **You can fix things by talking.** "Make it yellow", "move it to the roof" or "remove one duck" changes what you already built.
- **Misses teach.** The first miss says which part is off. The second says exactly what was asked for.

Practice mode is just you and the builder: 4 tasks, no Impostor and no clock.

The full rules and the build plan are in [SPEC.md](./SPEC.md). Known limits are in [ISSUES.md](./ISSUES.md). A walkthrough of the code is in [docs/CODE-TOUR.md](./docs/CODE-TOUR.md).

## Run it

```
npm install
npx deepspace dev start --port 5180
```

Open http://localhost:5180 and sign in. Create a game and press Start, and empty seats fill with AI players. Or pick Practice with the builder to try prompting on its own.

```
npm run test:unit                 # rules, AI fallbacks, and whole games through the server actions
STRESS=1 npm run test:unit        # stress: 100 full games, a chat flood, abusive prompts, players leaving
npx deepspace test run collab     # two real accounts in two browsers
npx deepspace deploy
```

## How it works

| Piece | Where |
|---|---|
| Collections and who can read them | `src/schemas/game-schemas.ts` |
| Every move: checks phase, role, range and cooldowns | `src/actions/game.ts` |
| The builder agent: new objects, edits, and wreck mode | `src/server/builder-agent.ts` |
| How a prompt is read: place words, defaults, the "I read" card | `src/game/prompting.ts` |
| AI players' meeting lines and votes | `src/server/meeting-ai.ts` |
| Landmarks, task requests and checks, AI routes, rules | `src/game/landmarks.ts`, `tasks.ts`, `bots.ts`, `rules.ts` |
| The 3D island (three.js) | `src/game/scene/` |
| The game screen | `src/game/ui/GameScreen.tsx` |

### DeepSpace integrations

| Integration | Job |
|---|---|
| Auth | Every player is signed in, and server actions know who is calling |
| Records with live sync | Games, players, builds, wrecked spots, votes and chat are records every screen draws from |
| Permissions | Roles and task lists use `ownerField` with read `own`, so only their owner can read them. Wreck clues are readable by nobody, only by server actions |
| Presence | Live walking: each browser broadcasts its islander about ten times a second |
| Server actions | All writes. Browsers have read only access to every game collection |
| AI | The builder turns typed prompts into catalog objects or edits to what you built; AI players argue from real clues |

Not used: cron (its 1 minute floor is too slow, so the host's browser calls `tick` every second), messaging (meeting chat lives with the game), and Yjs or canvas (nothing is edited together).

### Trust

The server decides everything that matters. The AI builder only proposes catalog types, colors and edits, and it never sees the task it is building for. The server picks every position from the prompt's place words. Tasks are checked against the builds on the server, never in the browser. Range checks use position checkpoints that the server clamps to walking speed. Every AI call has a non AI fallback, so the game never stalls if the model is down.
