# Saboteur Island

Like Among Us, but every task is practice in prompting an AI.

**Play it:** https://saboteur-island.app.space

## The game

5 or 6 players fix up a floating island before night falls, 7 minutes. One of them is secretly the Impostor, who wrecks finished work and cuts the lights to hide. A wreck leaves smoke: report it or ring the bell, then argue, vote, and launch someone into space. Ejected players come back as ghosts. AI players fill empty seats, so one person can play a full game.

Playing alone, you can pick Crew, Impostor or Random. Practice mode is just you and the builder: 4 tasks, no Impostor and no clock.

## Prompting

Every task is done by writing your own prompt to an AI builder. A task is a request from someone on the island, written as a hint: "Put one up high where I can see it from my window, in the color of a lemon." The player turns it into a clear prompt, like "a yellow bird on the roof."

- **Place words matter.** "On the roof", "by the door" and "in the pond" decide where things go.
- **Missing details get a default.** Leave out the color and a bird comes out brown. The builder never sees the task, so it cannot guess the answer.
- **Every prompt shows how it was read.** An "I read" card lists what the builder took from it and what it filled in.
- **You can fix things by talking.** "Make it yellow", "move it to the roof" or "remove one duck" changes what you already built.
- **Misses teach.** The first miss says which part is off. The second says exactly what was asked for.

## Controls

WASD or click to walk. Drag the mouse or swipe with two fingers to turn. Pinch or scroll to zoom. At a landmark, type your prompt. Walk up to smoke to report it, or ring the bell in the middle of the island. The speaker button in the corner mutes the music and sound effects on every screen.

## Run it

Needs Node 22 or 24 and a DeepSpace account.

```
npm install
npx deepspace auth login
npx deepspace dev start --port 5180
```

Open http://localhost:5180 and sign in. Create a game and press Start, and empty seats fill with AI players. Or pick Practice with the builder.

```
npm run test:unit                 # rules, AI fallbacks, and whole games through the server actions
STRESS=1 npm run test:unit        # 100 full games, a chat flood, abusive prompts, players leaving
npx deepspace test run collab     # two real accounts in two browsers
npx deepspace deploy
```

On Windows PowerShell, run the stress tests with `$env:STRESS=1; npm run test:unit`.

## How it works

| Piece | Where |
|---|---|
| Collections and who can read them | `src/schemas/game-schemas.ts` |
| Every move: checks phase, role, range and cooldowns | `src/actions/game.ts` |
| The builder agent: new objects, edits, and wreck mode | `src/server/builder-agent.ts` |
| How a prompt is read: place words, defaults, the "I read" card | `src/game/prompting.ts` |
| AI players' meeting lines, replies and votes | `src/server/meeting-ai.ts` |
| Landmarks, task requests and checks, AI routes, rules | `src/game/landmarks.ts`, `tasks.ts`, `bots.ts`, `rules.ts` |
| The 3D island (three.js) | `src/game/scene/` |
| The game screen | `src/game/ui/GameScreen.tsx` |

Built with React 19, three.js, Vite, the DeepSpace SDK 0.44.2, and the Vercel AI SDK with a Claude Haiku model.

Music: ["Afro Beat - Instrumental Music"](https://pixabay.com/music/afrobeat-afro-beat-instrumental-music-554537/) by rediskasound on Pixabay, used under the Pixabay Content License. It plays quietly during the round and drops lower during meetings.

### DeepSpace integrations

| Integration | Job |
|---|---|
| Auth | Every player is signed in, and server actions know who is calling |
| Records with live sync | Games, players, builds, wrecked spots, votes and chat are records every screen draws from |
| Permissions | Roles and task lists use `ownerField` with read `own`, so only their owner can read them. Wreck clues are readable by nobody, only by server actions |
| Presence | Live walking: each browser broadcasts its islander about ten times a second |
| Server actions | All writes. Browsers have read only access to every game collection |
| AI | The builder turns prompts into catalog objects or edits; AI players argue and vote from real clues. Calls bill the app owner, so players need no credits |

Not used: cron (its 1 minute floor is too slow, so the host's browser calls `tick` every second), messaging (meeting chat lives with the game), and Yjs or canvas (nothing is edited together).

### Trust

The server decides everything that matters. The AI builder only proposes catalog objects, colors and edits, and it never sees the task it is building for. The server picks every position from the prompt's place words and checks every task against the builds. Range checks use position checkpoints that the server clamps to walking speed. Every AI call has a non AI fallback, so the game never stalls if the model is down.

## More

- [SPEC.md](./SPEC.md): the full rules and numbers.
- [DESIGN-NOTES.md](./DESIGN-NOTES.md): the tradeoffs, and what playtesting changed.
- [docs/CODE-TOUR.md](./docs/CODE-TOUR.md): a walkthrough of the code.
