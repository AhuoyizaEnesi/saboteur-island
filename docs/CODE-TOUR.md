# Code tour

A map of how the game works, for reading or changing the code. Rules are in [SPEC.md](../SPEC.md).

## The shape

- **The browser draws and asks.** `src/game/ui/GameScreen.tsx` reads records with `useQuery` (through `src/game/useGame.ts`) and draws them. Every move it makes is a server action call (`src/game/api.ts`).
- **The server decides.** `src/actions/game.ts` holds every action. Each one checks who is calling, the phase, the distance and the cooldowns before it writes anything. Browsers cannot write game records at all (`src/schemas/game-schemas.ts`).
- **Shared rules.** `src/game/` holds code both sides use: landmarks, tasks, AI routes, voting and win rules, placement. These are plain functions, unit tested in `src/game/rules.test.ts`.
- **The 3D island.** `src/game/scene/IslandScene.ts` is one three.js class. React hands it data (builds, players, routes, smoke) and it animates toward it. It never talks to the network.

## Five flows, step by step

**1. Walking.** Keys move your islander inside `IslandScene` (`updateCharacters`). Every move calls `onMyMove`. `GameScreen` broadcasts the position over presence about 10 times a second, so other browsers can draw you, and sends `game-pos` every 1.5 seconds so the server knows where you are. The server clamps any jump faster than walking speed (`legalMove`).

**2. Doing a task.** Walk near a landmark and press E. The order box starts with your task's text. Sending it calls `game-build`. The server:
1. checks you are within 3 units of the landmark (`playMove`, `TASK_RANGE`);
2. asks the builder agent what to place (`runBuilderAgent` in `src/server/builder-agent.ts`). The model can only name catalog types and colors;
3. picks the exact spot itself (`spotAtLandmark` in `src/game/tasks.ts`). A task's object goes in its slot, so the bird lands on the roof;
4. rechecks every task at that landmark against the builds (`refreshTasks` and `taskDone`) and updates the public task counter;
5. ends the game if every task is done (`finishIfOver`).

**3. Wrecking.** Only the Impostor's secret row allows `game-wreck`. The server finds builds that currently complete a finished task (`wreckTargets`), knocks over, paints or removes one (`applyWreck`), marks the task broken, leaves a smoke spot (`breaks`), and writes a private clue: who was nearby and which AI players saw it (`clues`, readable by nobody).

**4. Meetings.** `game-report` (near smoke) or `game-bell` (at the bell) calls `startMeeting`. It pauses the night clock, seats everyone, and asks `planMeeting` (`src/server/meeting-ai.ts`) for AI players' lines and votes, built only from each AI player's own clues. `tick` moves meeting to vote to eject, `resolveVote` counts with `tally`, and `afterEject` either ends the game or restarts the clock.

**5. The clock and AI players.** One browser calls `game-tick` every second (`GameScreen`, "the clock"). `tick` advances phases, checks nightfall, and calls `runBots`. Each AI player has a route of timed legs (`src/game/bots.ts`). Every browser draws the same legs from the shared clock, so AI players need no streaming. When a leg ends, `runBots` finishes the job (places a task build, wrecks, fixes the lights) and plans the next walk.

## Common changes

| Change | Where |
|---|---|
| Night clock length, cooldowns, ranges, vision | `src/game/constants.ts` |
| Add a task | Add an entry to `TASKS` in `src/game/tasks.ts` (landmark, text, needed type, slot) |
| Add something the builder can make | Add it to `CATALOG` in `src/game/catalog.ts` and a model in `src/game/scene/models.ts` |
| Add a landmark | `LANDMARKS` in `src/game/landmarks.ts`, and a model in `buildLandmark` |
| How fast AI crew work | `BOT_TASK_PACE` in `src/actions/game.ts` |
| Win conditions | `decideWinner` in `src/game/rules.ts` |
| What AI players say | `planMeeting` and `heuristicMeeting` in `src/server/meeting-ai.ts` |

After any change: `npm run test:unit`, `npx tsc --noEmit`, `npm run lint`.

## Debugging tips

- A move does nothing: the action returned an error, shown as a red toast. The message names the check that failed (too far, cooling down, wrong phase).
- The game seems frozen: check that a browser is ticking. The host's tab must be open, or another human's.
- AI players stand still: their route ended and `runBots` did not plan a new one. Check the `routes` record for that player.
- The AI answer looks odd: every model call has a fallback (`keywordBuild`, `keywordWreck`, `heuristicMeeting`). Server logs show `[builder]` or `[meeting-ai]` warnings when a fallback ran.
