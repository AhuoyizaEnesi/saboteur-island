# Saboteur Island: build plan

## The game in one paragraph
Up to 6 players share a floating island. Each player gives orders to one AI builder agent, and the agent builds them on the island. One player is secretly the Impostor with a hidden goal, such as sneaking a volcano, rubber ducks and a pirate flag onto the island. Players are little islander characters who walk to whatever their order built, so the crew can watch who went where. Anyone can hit the emergency button to call a meeting. Players argue in chat, vote, and the ejected player drifts off into space. Empty seats are filled by AI players, so one person can play a full game alone.

## Game loop
1. **Lobby.** Host creates a game and shares a 4 letter code. Others join. Host starts.
2. **Role reveal.** Each player sees a full screen Crew or Impostor card. The Impostor also sees their secret goal.
3. **Build rounds (3 rounds, 90 seconds each).** Each player can send 2 orders per round. The agent builds each order. The builder character walks to the spot and a beam in their color comes down. The order text shows in the feed without a name.
4. **Crew tasks.** The crew shares a checklist (for example 3 houses, a dock, a lighthouse, lanterns) with a progress bar.
5. **Sabotage.** The Impostor can cut the lights for 20 seconds once per round. Any crew member can fix them early at the lighthouse.
6. **Emergency meeting.** Anyone alive can press the button once per game. Alarm, red flash, everyone is pulled to a meeting table. 45 seconds of chat, then 20 seconds of voting with a skip option.
7. **Ejection.** The ejected player drifts into space while a line types out whether they were the Impostor.
8. **End.** Crew wins by ejecting the Impostor, or by finishing the task list by the end of round 3 with the Impostor's goal unfinished. The Impostor wins by finishing the secret goal, or by surviving to the end with the goal finished.

## DeepSpace integrations and what each one does
| Integration | Job in the game |
|---|---|
| Auth | Every player is a signed in user. Actions verify who is calling. |
| Records + live sync | Games, players, orders, builds, votes and chat are records. Every screen draws the island from the builds list, so live sync is the multiplayer layer. |
| Permissions (RBAC with ownerField) | Each player's role lives in a `secrets` record that only that player can read. The server enforces it, not the UI. |
| Server actions | Every game move (create, join, start, order, vote, meeting, sabotage, tick) goes through an action that checks phase, turn and role on the server. |
| AI | The builder agent turns an order into validated tool calls (place, remove, time of day, weather). AI players write their own orders and argue in meetings. |
| Presence | Who is online, who is typing, and where each human's character is standing. |

## Main tradeoffs
1. **The agent writes a scene spec, never code.** Tool calls are checked against a fixed catalog and the island bounds before they become records. The island can never be broken by a bad order.
2. **Timers run through a `tick` action, not cron.** Cron's shortest interval is 1 minute, which is too slow for a 45 second meeting. Any connected client calls `tick` when a deadline passes; the server checks the clock and advances the phase once.
3. **Secrets are separate records.** Roles are never stored on the public player row.

## Build order
1. Records, actions and the pure game rules module, with unit tests.
2. Lobby and join flow.
3. The 3D island renderer, ported from the prototype, drawing from the builds records.
4. Orders and the builder agent.
5. Characters, walking and presence.
6. Meetings, chat, voting and ejection.
7. Sabotage, tasks and win conditions.
8. AI players.
9. Polish, sound, and the writeup.
