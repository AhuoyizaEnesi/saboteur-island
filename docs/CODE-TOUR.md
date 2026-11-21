# Code tour

A map of how the game works, for reading or changing the code. Rules are in [SPEC.md](../SPEC.md).

## The shape

- **The browser draws and asks.** `src/game/ui/GameScreen.tsx` reads records with `useQuery` (through `src/game/useGame.ts`) and draws them. Every move it makes is a server action call (`src/game/api.ts`).
- **The server decides.** `src/actions/game.ts` holds every action. Each one checks who is calling, the phase, the distance and the cooldowns before it writes anything. Browsers cannot write game records at all (`src/schemas/game-schemas.ts`).
- **Shared rules.** `src/game/` holds code both sides use: landmarks, tasks, AI routes, voting and win rules, placement. These are plain functions, unit tested in `src/game/rules.test.ts`.
- **The 3D island.** `src/game/scene/IslandScene.ts` is one three.js class. React hands it data (builds, players, routes, smoke) and it animates toward it. It never talks to the network.

## Five flows, step by step

**1. Walking.** Keys move your islander inside `IslandScene` (`updateCharacters`), relative to the camera angle (`followYaw`, turned by dragging in `onPointerMove` or a two finger swipe in `onWheel`). Every move calls `onMyMove`. `GameScreen` broadcasts the position over presence about 10 times a second, so other browsers can draw you, and sends `game-pos` every 1.5 seconds so the server knows where you are. The server clamps any jump faster than walking speed (`legalMove`).

**2. Doing a task.** Walk near a landmark and press E. The order box shows the request from the person who lives there but starts empty: you write the prompt. A build is two calls, 8 seconds apart (`BUILD_MS`), or 3 seconds for an edit (`EDIT_MS`).

`game-build` (`buildOrder`):
1. checks you are within 3 units of the landmark (`playMove`, `TASK_RANGE`);
2. asks the builder agent what to do (`runBuilderAgent` in `src/server/builder-agent.ts`). It returns ops: add new objects, or recolor, move or remove the ones you built here. The model can only name catalog types and colors, and never sees your task. Without the model, `keywordBuild` and `keywordEdit` read the same things from plain words;
3. reads the prompt into the "I read" card (`placesIn`, `DEFAULT_COLOR`, `readingLines` in `src/game/prompting.ts`): the place words, and the builder's default for anything left out;
4. saves the ops, place words and reading as a pending job on your private `secrets` row and returns. The browser shows a progress ring and the card.

`game-build-finish` (`finishBuild`), after 8 seconds:
1. checks the time is up and you are still at the landmark. Walking away cancels the job on your next position checkpoint (`reportPos`);
2. applies the ops. New objects go through `placeItems` and `spotAtLandmark` in `src/game/tasks.ts`: a place word sends an object to that spot (`placeAnchors`), so "on the roof" really lands on the roof, and the spot is saved on the build (`placeTag`). Edits change your own builds at the landmark (`editTargets`);
3. rechecks every task at that landmark (`refreshTasks`, `taskDone`, which checks type, color, place and the exact count) and updates the public task counter;
4. explains a miss in one line (`explainMiss`): which part is off first, the exact ask from the second try. It counts tries and marks first try wins (`tries`, `firstTry` on the task);
5. ends the game if every task is done (`finishIfOver`).

**3. Wrecking.** Only the Impostor's secret row allows `game-wreck`. Like a build it is two calls, 4 seconds apart (`WRECK_MS`, half a build). The start picks the target (`wreckTargets`) and saves the plan; `game-wreck-finish` checks the Impostor stayed, then knocks over, paints or removes every object of that task (`applyWreck`), marks the task broken, leaves a smoke spot (`breaks`), and writes a private clue: who was nearby, which AI players saw it, and where every player was (`clues`, readable by nobody).

**4. Meetings.** `game-report` (near smoke) or `game-bell` (at the bell) calls `startMeeting`. It pauses the night clock, seats everyone, and asks `planMeeting` (`src/server/meeting-ai.ts`) for a few opening lines between the AI players. Each AI player only knows its own notes (`notesFor`): where it was, who was with it, what it saw. The AI Impostor gets a fake alibi.
- Every human message (`game-chat`, `sendChat`) gets 1 or 2 replies from `replyInMeeting`. The AI player you name, or the last one who spoke if you say "you", always answers. Capped at `MAX_REPLY_CALLS` per meeting.
- When voting opens, `startVote` asks `planVotes` for every AI vote after reading the whole chat. Eyewitnesses are firm; everyone else votes slowly and can be swayed by a human message during voting.
- Anyone can change their vote until voting closes (`castVote` updates the same row). Voting closes at the timer, or `VOTE_GRACE_MS` after the last living player's vote appears (`allVotedAt` in `tick`). `tick` moves meeting to vote to eject, `resolveVote` counts with `tally`, and `afterEject` either ends the game or restarts the clock.

**Practice.** `game-practice` (`startPractice`) makes a solo game with `mode: 'practice'`: you are crew with 4 tasks, the game starts in play, `tick` returns early (no clock, bots or meetings), the bell refuses, and `finishIfOver` ends it when every task is done.

**Leaving and ending.** `game-leave` frees a lobby seat, or turns your islander into an AI player mid game (same role and tasks, private rows moved to the AI) and passes the host on. `game-end` is host only and ends with no winner.

**5. The clock and AI players.** One browser calls `game-tick` every second (`GameScreen`, "the clock"). `tick` advances phases, checks nightfall, and calls `runBots`. Each AI player has a route of timed legs (`src/game/bots.ts`). Every browser draws the same legs from the shared clock, so AI players need no streaming. When a leg ends, `runBots` finishes the job (places a task build, wrecks, fixes the lights) and plans the next walk.

## Common changes

| Change | Where |
|---|---|
| Night clock length, cooldowns, ranges, vision | `src/game/constants.ts` |
| Add a task | Add an entry to `TASKS` in `src/game/tasks.ts` (landmark, who, request, checklist text, needed type, color, count or place, slot) |
| Add something the builder can make | Add it to `CATALOG` in `src/game/catalog.ts` and a model in `src/game/scene/models.ts` |
| Add a landmark | `LANDMARKS` in `src/game/landmarks.ts`, and a model in `buildLandmark` |
| How fast AI crew work | `BOT_TASK_PACE` in `src/actions/game.ts` |
| How often the AI Impostor wrecks | `BOT_FIRST_WRECK_MS`, `BOT_WRECK_MIN_MS`, `BOT_WRECK_MAX_MS` in `src/game/constants.ts` |
| Build, edit and wreck time | `BUILD_MS`, `EDIT_MS`, `WRECK_MS` in `src/game/constants.ts` |
| Place words, default colors | `PLACES`, `DEFAULT_COLOR` in `src/game/prompting.ts` |
| How often a person is the Impostor | `HUMAN_IMPOSTOR_WEIGHT` in `src/game/constants.ts`, used by `assignRoles` in `src/game/rules.ts` |
| Win conditions | `decideWinner` in `src/game/rules.ts` |
| Music track and how loud it plays | `SRC` and `GAIN` in `src/game/music.ts`; the file is `public/audio/afro-beat.mp3` |
| What AI players say, and their personalities | `STYLES`, `planMeeting`, `replyInMeeting` and the `heuristic*` fallbacks in `src/server/meeting-ai.ts` |
| How AI players vote | `planVotes` and `heuristicVotes` in `src/server/meeting-ai.ts` |

After any change: `npm run test:unit`, `npx tsc --noEmit`, `npm run lint`.

## Debugging tips

- A move does nothing: the action returned an error, shown as a red toast. The message names the check that failed (too far, cooling down, wrong phase).
- The game seems frozen: check that a browser is ticking. The host's tab must be open, or another human's.
- AI players stand still: their route ended and `runBots` did not plan a new one. Check the `routes` record for that player.
- The AI answer looks odd: every model call has a fallback (`keywordBuild`, `keywordWreck`, `heuristicMeeting`, `heuristicReply`, `heuristicVotes`). Server logs show `[builder]` or `[meeting-ai]` warnings when a fallback ran.
