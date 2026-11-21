# Saboteur Island: build spec

**This file is the source of truth.** Code follows this spec. If the build needs to change, this file changes first, and Peace approves the change.

Status: **Approved in chat on Nov 19, 2026.** This is the sabotage version, with no killing.

---

## 1. What DeepSpace is grading

- **Deadline:** Sunday, November 22, 2026, 11:59 PM Eastern.
- **Submit:** the live URL, the GitHub repo, and a short writeup covering what we built, which DeepSpace integrations we used, the main tradeoff, what the agent did, and what we verified.
- **Bar:** a full stack, multi user app deployed on DeepSpace using at least three integrations.
- **They look for:** a sensible scope, a main path that works on the live app, unfinished edges explained honestly, technical depth shown through working flows, readable code, protected secrets, and platform features used instead of rebuilt. Size and hours are not rewarded.
- **Design rules from docs.deep.space/design:** landing headline of 3 to 8 words, one commanding visual, no purple gradients, no hardcoded colors in JSX, no pictograph emoji, motion that respects reduced motion, no placeholder copy.

---

## 2. The game

Five or six islanders live on a floating island in space. The crew walk around fixing up the island before night falls. Each task is a small change at a landmark, like putting a yellow bird on the red cottage, and you do it by telling the AI builder what to make. One islander is secretly the Impostor. They pretend to work, sneak up to finished tasks and tell the builder to wreck them, and cut the lights so nobody can see who is where. When someone finds a wrecked task, or rings the bell, everyone meets, argues and votes. The crew win by finishing every task or voting out the Impostor. The Impostor wins if night falls first. AI players fill empty seats, so one person can play alone.

---

## 3. Roles

| Role | Count | Goal |
|---|---|---|
| Crew | everyone else | Finish every task before night, or vote out the Impostor |
| Impostor | 1 | Keep the island unfinished until night |

The Impostor gets a fake task list so they know where to pretend to work. Nothing they build ever counts as a task.

---

## 4. The island

The island is about twice its current size, so walking takes real time and players can be out of sight. Landmarks are placed at game start and never move.

Every task names the place, the object, at least one detail (a color or a count) and a short reason.

| Landmark | Tasks there |
|---|---|
| Red Cottage | The roof looks empty since the birds flew south. Put a yellow bird on the roof. / Guests keep tripping at night. Hang 2 lanterns by the door |
| Blue Cottage | The front yard looks bare. Plant 3 pink flower beds out front. / The garden needs a border. Build a white fence beside the cottage |
| Dock and Pond | The fisher needs a ride. Tie a red boat to the dock. / The pond feels lonely. Put 2 ducks on the pond |
| Well | Something odd grows in the shade. Plant 3 purple mushrooms by the well. / Travelers need a place to rest. Put a green bench next to the well |
| Windmill | The miller wants a small flock. Put 2 sheep by the windmill. / Crows keep stealing grain. Stand a scarecrow in a red shirt by the windmill |
| Lighthouse | Ships cannot spot the island. Raise a blue flag by the lighthouse. / The path is too dark to walk. Light 3 lanterns on the lighthouse path |
| Camp | Campers arrive tonight. Pitch 2 orange tents at the camp. / Story night needs something spooky. Light a green campfire at the camp |
| Orchard | The orchard is short on fruit. Plant 2 round trees in the orchard. / The bees need a new home. Put a white beehive by the orchard |
| Power Shed | Fixes the lights. No tasks |
| Meeting Bell | Center of the island. Calls meetings. No tasks |

---

## 5. Tasks

- Each crew member gets **3 tasks** at 3 different landmarks. No two players get the same task.
- **Doing a task:** walk within range of the landmark, open the order box and type your own prompt. The box starts empty, so the player turns the task into a prompt. Building takes 8 seconds standing at the landmark, with a progress ring. Walking away cancels it.
- **Vague prompts:** the builder follows a specific prompt exactly. When a prompt leaves out a detail the task needs, like the color or how many, the builder fills the gap itself. It matches the task about 1 time in 3 and picks something else the rest of the time. A specific prompt never gets a made up detail.
- **Feedback:** after a build that misses, one line says what was off, for example "You built 1 white bird. The task needs a yellow bird. Your prompt did not say the color." The game over screen shows how many of your tasks you finished on the first prompt.
- **Checking:** the server checks the landmark after every order. A task is done when the owner has at least the required number of the required object there, in the required color if the task names one. The builder picks colors from a fixed list (red, orange, yellow, green, blue, pink, purple, white, black, brown), so the check is exact.
- **Extra builds are fine.** "A yellow bird wearing a tiny hat" still counts. A volcano at the cottage does not.
- **Task bar:** shared and public. It shows done tasks out of total tasks.

---

## 6. The Impostor

| Ability | Rule |
|---|---|
| Fake tasks | A list of 3 tasks like the crew's. Standing at the landmark does nothing |
| Wreck | Stand within range of a finished task and tell the builder what to do to it, like "knock the bird off" or "paint it black". Quick buttons: Knock over, Paint black, Take away. A wreck takes 4 seconds standing still, half the time a build takes, and walking away cancels it. The task becomes broken, and the task bar drops. Cooldown 30 seconds. The first wreck is ready 20 seconds after the game starts |
| Lights out | Usable anywhere. Crew vision shrinks to 1.8 units for 30 seconds, or until a crew member fixes it at the Power Shed. Cooldown 45 seconds |

The Impostor's builder can knock over, recolor and remove objects. The crew's builder can only add and recolor.

---

## 7. Broken tasks, meetings and voting

- **A broken task** shows smoke and rubble at its spot. Anyone close enough sees it. The owner's task list shows that task as broken, so they know to go back and redo it. Everyone else only sees the task bar drop.
- **Report:** a living player within 2.5 units of a broken spot can report it. That starts a meeting. A spot can only be reported once.
- **Bell:** a living player at the center can ring the bell. Each player gets 1 ring. The bell is locked for 15 seconds after every meeting.
- **Meeting:** everyone is moved to seats around the bell. 60 seconds of chat, then 30 seconds of voting. Chat stays open while voting. Each living player votes for someone or skips, and anyone can change their vote until voting closes, so a good argument can still swing it. Voting closes when the timer ends, or 3 seconds after the last living player's vote appears. The night clock pauses during meetings.
- **Result:** the player with the most votes is ejected. A tie, or a skip winning, ejects nobody. The ejected player floats off into space while a line types out whether they were the Impostor.
- **Ghosts:** ejected crew become ghosts. They float, can still do their own tasks, and are invisible to the living. They cannot chat, vote, report or ring the bell.

---

## 8. Winning

| Winner | When |
|---|---|
| Crew | Every task is done at the same moment |
| Crew | The Impostor is ejected |
| Impostor | Night falls while any task is unfinished |
| Impostor | Only one living crew member is left |

---

## 9. Vision and camera

- The camera follows your islander from above and behind, in the lobby too. The role reveal and the end screen use the orbit view.
- You see other islanders within your vision circle: crew 5 units, Impostor 6 units, crew with lights out 1.8 units. Ghosts see everything.
- Builds, landmarks and smoke are always drawn, but everything outside your circle is darkened.
- **Known limit:** vision is drawn in the browser. Positions sit in records every player can read, so someone inspecting the raw data could see more. We accept that for a party game and say so in the writeup.

---

## 10. AI players

AI players fill seats up to 5. They walk, do tasks, fix, report, chat and vote.

- **Movement:** the server plans each AI player's walk as timed legs between landmarks. Every browser draws the same legs, so everyone sees AI players in the same place, and the server can work out where any AI player is at any moment.
- **Crew AI:** walks to its tasks, works 8 seconds and completes them with fixed builds, without calling the model. It redoes its own broken tasks. If it passes a broken spot, it usually reports it.
- **Impostor AI:** walks between landmarks faking tasks. Its first wreck waits 75 seconds, then it wrecks at most once every 60 to 80 seconds, about 5 wrecks a game. Each wreck takes 4 seconds at the spot. It wrecks when nobody is in its vision, and sometimes when someone is. It cuts the lights at most twice a game.
- **Clues:** at every wreck, the server records who was near the spot and which AI players could see the Impostor. Clues are private to the server.
- **Meetings:** AI players talk like people in a game chat: short, casual, reacting to each other, asking questions back. One model call opens the meeting with a few lines between them. Every human message gets a reply from 1 or 2 AI players. A named AI player always answers, using what it knows: where its tasks were, where it was and what it saw.
- **Votes:** AI players decide when voting starts, after reading the whole chat. Crew vote on a strong case, not only proof: a witness, someone two players accuse, or someone caught in a lie. The Impostor AI piles onto whoever the crew suspects. During voting, a human message can sway an AI player who did not see the wreck. An eyewitness never changes its vote.
- **Fallback:** if a model call fails, AI players use short fixed lines and vote for whoever their clues or the chat point to, or skip.

---

## 11. Default settings

These get tuned during testing.

| Setting | Value |
|---|---|
| Players | 5 to 6, AI fills to 5 |
| Impostors | 1 |
| Tasks per crew member | 3 |
| Play time until night | 7 minutes, paused during meetings |
| Walking speed | 3 units per second |
| Task and wreck range | 2.5 units from the landmark |
| Report range | 2.5 units |
| Vision | crew 5, Impostor 6, lights out 1.8 |
| Build and fix time | 8 seconds at the landmark |
| Wreck time | 4 seconds at the landmark |
| Wreck cooldown | Human 30 seconds, first ready at 20 seconds. AI first at 75 seconds, then every 60 to 80 seconds |
| Lights out | 30 seconds, cooldown 45 seconds. AI at most twice a game |
| Gap fill match rate | 1 in 3 |
| Bell rings | 1 per player, locked 15 seconds after a meeting |
| Discussion and voting | 60 seconds and 30 seconds |
| Show whether the ejected player was the Impostor | On |

---

## 12. Screens and controls

| Screen | What it shows |
|---|---|
| Landing | Headline of 3 to 8 words, the live 3D island as the hero, a Play button |
| Menu | Create a game, or join with a 4 letter code |
| Lobby | Follow view so players can walk while they wait. A side panel with the code, an invite link, 6 seats, and Start for the host |
| Role reveal | Crew or Impostor in large type, with the goal in one line |
| Play | Follow camera. Top left: task list and task bar. Top right: night clock, a small island map (your position and your task landmarks, never other players), and the player list. Bottom right: action buttons that light up in range (Build, Report, Fix lights, Bell). Top center: alerts |
| Game menu | A button beside the title. Leave game for anyone: in the lobby the seat frees up; during a game an AI player takes over your islander with the same role and tasks, and the host role passes to the next human. End game for the host only: nobody wins and everyone sees the Impostor. Both need a second click |
| Order box | Opens at a landmark. Shows your task there with its details and reason, an empty prompt field and a Build button. While building, a progress ring. After a miss, one line on what the prompt left out. The Impostor also sees the wreck buttons |
| Meeting | Chat on one side with a typing indicator for AI players, islanders seated around the bell, then the vote grid. Chat stays open while voting, and votes can be changed until time runs out |
| Ejection | Space background, the islander drifting away, the result typing out |
| End | Who won and why, who the Impostor was, how many of your tasks you finished on the first prompt, Play again |

Controls: WASD or arrow keys, or click the ground to walk. Drag to turn the camera around you; movement keys follow the camera, so W walks away from you. Scroll to zoom. E opens the order box, R reports. Every action also has a button for mouse and touch.

---

## 13. How it runs on DeepSpace

### Integrations

| Integration | Job in the game |
|---|---|
| Auth | Every player is signed in, and server actions know who is calling |
| Records with live sync | Games, players, tasks, builds, broken spots, votes and chat are records. Every screen draws from them |
| Permissions | Each player's role and task list are records only that player can read, using ownerField with read own. The server hides the Impostor, not the interface |
| Presence | Live movement. Each browser broadcasts its islander's position about 10 times a second |
| Server actions | Every move with rules goes through an action that checks phase, role, range and cooldowns |
| AI | The builder for tasks and wrecks, and the AI players' meeting dialogue |

**Not used:** cron, because its 1 minute minimum is too slow, so a browser calls `tick` every second instead. Messaging, because meeting chat is short lived and lives with the game. Yjs and canvas, because nothing is edited together.

### Data

| Collection | Holds | Who can read |
|---|---|---|
| games | phase, night clock, task bar totals, lights state, meeting info, winner | everyone |
| players | name, color, seat, alive, last checkpoint position, bell rings left | everyone |
| secrets | role, cooldowns, fake task list | only that player |
| tasks | one row per task: landmark, need, status todo, done or broken | only the owner |
| builds | type, color, position, landmark, upright or knocked over | everyone |
| breaks | broken spots: landmark, position, time, reported | everyone |
| routes | AI players' timed walking legs | everyone |
| clues | who was near each wreck, and who saw it | nobody, server only |
| votes, chat, events | meeting votes, messages, the island feed | everyone |

### Server actions

| Action | Who | Checks |
|---|---|---|
| game-create, game-join, game-start | host and players | lobby phase, seat limit, host only for start |
| game-pos | every human, every 1.5 seconds | phase, and a plausible distance since the last checkpoint |
| game-build | crew | in range of the landmark; runs the builder; marks tasks done |
| game-wreck | Impostor | role, cooldown, in range of a finished task; runs the builder in wreck mode |
| game-lights, game-fix-lights | Impostor, crew at the Power Shed | role, cooldown, range |
| game-report, game-bell | living players | range, rings left, bell lock |
| game-chat, game-vote | living players | phase |
| game-tick | the host's browser, or the first online human if the host left | advances timers, moves and runs AI players, checks every win condition |
| game-rematch | any player at the end | game over |

### Movement and trust

Presence carries live movement because it is fast and stores nothing. The server cannot read presence, so browsers also send a checkpoint every 1.5 seconds, and every action carries the caller's current position. The server rejects a position that is too far from the last checkpoint for the time passed. A cheater could still fake small moves. We accept that and say so in the writeup.

### AI cost control

- Builder: Claude Haiku 5.5, one call per order, at most 4 objects per order, at most 1 order every 4 seconds per player.
- Meetings: one call to open each meeting, one call for AI votes when voting starts, and one reply call per human message, capped at 10 reply calls per meeting.
- AI players' tasks and wrecks use fixed builds, not the model.
- Every model call has a non AI fallback, so the game never stalls.

---

## 14. Design direction

A floating island at dusk in deep space, turning to night as the clock runs down. Low poly and handmade, with warm lights against a dark sky. The islanders are round and soft with a leaf sprout and a scarf in the player's color. Everything is our own design.

- **Type:** Unbounded for display, Sora for everything else.
- **Color:** dark navy background. Cyan for crew and safety, coral red for the Impostor and danger, gold for tasks. Player colors only on islanders and names. All colors live in CSS variables.
- **HUD:** dark glass panels with thin borders. Nothing covers the middle of the screen during play.
- **Motion:** smooth camera moves and pop in builds. Everything checks `prefers-reduced-motion`.
- **No emoji** anywhere in the interface. Icons come from lucide.
- **Sound:** small synthesized effects (bell, task done, wreck, lights out, ejection), silent until the first click, with a mute button.

---

## 15. Testing

- **Unit tests:** task checks, wreck effects, the night clock, voting, every win condition, cooldowns, range checks, AI routes.
- **Two player test** with deepspace/testing: two signed in users join one game, each can read only their own role and tasks, one walks and the other sees the checkpoint, a vote by one shows for the other.
- **Run sheet on the live URL:**
  1. Solo as crew against 4 AI players, to an ending.
  2. Solo as Impostor, to an ending.
  3. Two browsers: walking, a task, a wreck, a report, a vote, an ejection.
  4. Lights out and the fix.
  5. Night falling ends the game.
  6. Phone check.
- Non blocking bugs go into ISSUES.md during the build. Full testing happens at the end, then a fix plan.

---

## 16. Build order and push checkpoints

Peace pushes to GitHub at the end of each step, about every 3 hours. I copy the changed files to her laptop and give her the commit command.

| Step | What | Done when |
|---|---|---|
| 0 | Push the current prototype and this spec | Commit on GitHub |
| 1 | Bigger island, landmarks, follow camera, WASD and click walking, presence, checkpoints | Two browsers see each other walk |
| 2 | Task lists, order box, builder at landmarks, task checks, task bar, night clock | Crew can finish every task before night, and night ends the game |
| 3 | Wreck, broken spots, lights out and fix, report, bell, meeting, vote, ejection, ghosts, win checks | Two humans can play a full game |
| 4 | AI players: routes, tasks, Impostor AI, clues, meeting dialogue | One human can play a full game as either role |
| 5 | Vision circle, design rules pass, landing page | Passes the design rules in section 1 |
| 6 | Tests, deploy, run sheet on the live URL, writeup | Everything in section 15 passes on the deployed app |

**Cut order if we fall behind:** ghosts doing tasks (ghosts only watch), the wreck quick buttons, the AI reply to mentions. Steps 1 to 4 never get cut.

---

## 17. What changes from the current code

**Keep:** the 3D renderer, models and islanders, placement rules, meeting, vote and ejection screens, role secrets, the builder agent, AI meeting dialogue, the lobby.

**Change:** island size, the camera, timed build rounds become a night clock, orders happen at landmarks, the Impostor's secret item goal becomes wrecking tasks.

**Remove:** the 3 build rounds and the Impostor's secret item themes.

---

## 18. Writeup notes

- **What we built:** one paragraph.
- **Integrations:** the table in section 13, with the reasons for the ones left out.
- **Main tradeoff:** vision drawn in the browser and positions checked from client checkpoints, instead of a server streaming filtered state to each player.
- **What the agent did:** which parts Claude wrote.
- **What Peace verified:** the run sheet results and anything she changed.

## 19. Out of scope

Killing, vents, more than one Impostor, settings menus, matchmaking with strangers, voice chat, mobile apps.
