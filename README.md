# Saboteur Island

A multiplayer party game for 5 or 6 players, built on DeepSpace. The crew walk around a floating island and fix it up before night falls. Every task is done by typing an order to an AI builder at a landmark, like "a yellow bird on the roof". One player is secretly the Impostor. They wreck finished work when nobody is looking and cut the lights to hide. Smoke gives the wreck away: report it, argue, vote, and launch someone into space. AI players fill empty seats, so one person can play a whole game.

The full rules and the build plan are in [SPEC.md](./SPEC.md). Known limits are in [ISSUES.md](./ISSUES.md). A walkthrough of the code is in [docs/CODE-TOUR.md](./docs/CODE-TOUR.md).

## Run it

```
npm install
npx deepspace dev start --port 5180
```

Open http://localhost:5180, sign in, create a game, and press Start. Empty seats fill with AI players.

```
npm run test:unit                 # rules, AI fallbacks, and whole games through the server actions
npx deepspace test run collab     # two real accounts in two browsers
npx deepspace deploy
```

## How it works

| Piece | Where |
|---|---|
| Collections and who can read them | `src/schemas/game-schemas.ts` |
| Every move: checks phase, role, range and cooldowns | `src/actions/game.ts` |
| The builder agent (build mode and wreck mode) | `src/server/builder-agent.ts` |
| AI players' meeting lines and votes | `src/server/meeting-ai.ts` |
| Landmarks, tasks, AI routes, rules | `src/game/landmarks.ts`, `tasks.ts`, `bots.ts`, `rules.ts` |
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
| AI | The builder turns typed orders into catalog objects; AI players argue from real clues |

Not used: cron (its 1 minute floor is too slow, so the host's browser calls `tick` every second), messaging (meeting chat lives with the game), and Yjs or canvas (nothing is edited together).

### Trust

The server decides everything that matters. The AI builder only proposes catalog types and colors; the server picks every position. Tasks are checked against the builds on the server, never in the browser. Range checks use position checkpoints that the server clamps to walking speed. Every AI call has a non AI fallback, so the game never stalls if the model is down.
