# Saboteur Island

**Live:** https://saboteur-island.app.space
**Repo:** https://github.com/AhuoyizaEnesi/saboteur-island

Mira misses the birds. She asks for one up high, where she can see it from her window, in the color of a lemon. You walk to her cottage and type "a bird." The builder sets a brown bird down on the grass. Mira says that is not what she asked for: the color and the place are wrong. You try again: "a yellow bird on the roof." Task done.

That is Saboteur Island. It plays like Among Us, but every task is a prompt.

## What it is

5 or 6 players fix up a floating island before night falls, about 7 minutes. Every task is a request from an islander, written as a hint, and the player turns it into a prompt for an AI builder. One player is secretly the Impostor. They wreck finished work and cut the lights. A wreck leaves smoke, someone reports it, and everyone meets to argue and vote. AI players fill empty seats. They walk their own routes, do their tasks, and argue from what they actually saw, so one person can play a full game alone.

## Why I built it

Prompting is a skill. If you do not say what you mean, the AI fills the gap its own way, and you get a brown bird on the grass. I wanted people to practice that in a way that feels like play, inside a game almost everyone already knows.

## How it works on DeepSpace

Six integrations, each with one job:

- **Auth:** every action knows who is calling.
- **Records:** games, players, builds, votes and chat sync live to every screen.
- **Permissions:** roles and tasks use `ownerField` with read `own`, so the server hides the Impostor, not the interface.
- **Presence:** live walking, about 10 updates a second.
- **Server actions:** every write. Browsers are read only, and each action checks phase, role, distance and cooldowns.
- **AI:** the builder turns prompts into objects through tools and never sees the task, so it cannot leak the answer. In meetings, AI players argue from their own private clues.

I left out cron because its 1 minute minimum is too slow for a 30 second vote, so the host's browser runs the clock. Meeting chat lives with the game, so messaging was not needed. Nothing is edited together, so Yjs and canvas did not fit.

**The main tradeoff.** I chose platform primitives over a custom realtime server. Presence is fast but the server cannot read it, so browsers also send a checkpoint every 1.5 seconds and the server rejects any move faster than walking. Positions sit in records every player can read, so someone inspecting raw data could see past their vision circle. Closing that means building my own realtime layer, which was not worth it for a party game among friends. The limit is written down in ISSUES.md.

## The decisions

- **Players write every prompt.** There is no autofill. The game only teaches prompting if you do the prompting.
- **Tasks are hints, not answers.** "The color of a lemon" makes you turn a need into words the AI can use.
- **The builder never guesses.** Anything you leave out gets a plain default. An "I read" card shows how your prompt was read, and you can fix things by talking: "make it yellow," "move it to the roof."
- **You can choose your side.** Roles used to be random, so trying the Impostor meant replaying until the draw dealt it. Now a solo player picks Crew or Impostor and tries either side right away. When roles are random, people get the Impostor more often than AI players.
- **Practice mode.** Just you and the builder, with no wrecks, meetings or clock, so you can focus on your prompts.
- **Fair pressure.** Wrecks take at least half as long as a fix, and AI votes come after the discussion, so you can change their minds.

## What the agent did

Claude wrote the code and the automated tests. I directed every decision above, played each change before it shipped, and turned down what did not fit, like a cartoon restyle that looked too sad for the island.

## How I tested it

I played every path myself: as crew, as the Impostor, as a ghost, in Practice mode, and signing in and out. I also brought in friends in other states and on other continents, people in tech who have played games like this, so I could hear how they think it should be better.

Testing found real bugs, and each one is fixed. A ghost froze after a second player was voted out. On the live site, an ejected player sometimes did not come back as a ghost, because updates arrived one at a time. The sign in buttons stayed dead after pressing back.

The automated checks back that up:

- 76 tests pass, including whole games through the real server actions.
- A stress run of 100 full games: every game ended with a winner, and no tick failed.
- A flood of 51 chat messages stayed within the cap of 10 AI calls per meeting.
- Abusive prompts hit the limits: "build 100 ducks" placed 4, and the island stops at 220 objects.
- On the live site, "a lemon colored bird up high" was read as "a yellow bird." 63 AI calls cost $0.02.

## What comes next

A browser runs the game clock, so if every player closes the tab, the game pauses until someone returns. Next, I want to spend more time on the prompts and the gameplay, so every task is a prompt worth writing.

## Why it matters

Mira's bird is small, but the lesson is not. When you do not prompt well, the AI does not understand what you meant. Saboteur Island lets people learn that the fun way, in a game almost everyone has played.
