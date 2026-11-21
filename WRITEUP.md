# Saboteur Island

**Live:** https://saboteur-island.app.space
**Repo:** https://github.com/AhuoyizaEnesi/saboteur-island

## What I built

Saboteur Island plays like Among Us, but every task is a prompt. 5 or 6 players fix up a floating island before night falls, about 7 minutes. Each task is a request from someone who lives there, written as a hint: Mira wants a bird up high where she can see it from her window, in the color of a lemon. The player has to turn that into a prompt for an AI builder, like "a yellow bird on the roof." One player is secretly the Impostor, wrecking finished work and cutting the lights. Every wreck leaves smoke, someone reports it, and everyone meets to argue and vote. AI players fill the empty seats. They walk their own routes, do their tasks, and argue from what they actually saw, so one person can play a full game alone.

## Why I built it

Prompting is a skill. When you do not say what you mean, the AI fills the gap its own way, and the result is not what you pictured. I wanted people to practice that in a way that feels like play, and to bring back the fun of a game almost everyone has played.

## How it works on DeepSpace

Every player signs in with DeepSpace auth, so every action knows who is calling. The game lives in records that sync live to every screen: games, players, builds, votes and chat. Permissions keep the secrets on the server. Roles and task lists use `ownerField` with read `own`, so the server hides the Impostor, not the interface. Walking runs on presence at about 10 updates a second. Every write goes through a server action that checks phase, role, distance and cooldowns, and browsers can only read. The AI integration powers the builder, which turns prompts into objects through tools and never sees the task, so it cannot leak the answer. It also powers the AI players in meetings, who argue from their own private clues.

I left out cron because its 1 minute minimum is too slow for a 30 second vote, so the host's browser runs the clock. Meeting chat lives with the game, so messaging was not needed. Nothing is edited together, so Yjs and canvas did not fit.

The main tradeoff was trust. I chose platform primitives over a custom realtime server. Presence is fast but the server cannot read it, so browsers also send a checkpoint every 1.5 seconds and the server rejects any move faster than walking. Positions sit in records every player can read, so someone inspecting raw data could see past their vision circle. Closing that means building my own realtime layer, which was not worth it for a party game among friends. The limit is written down in ISSUES.md.

## The decisions along the way

The first decision was that players write every prompt themselves. An early version filled the prompt in, and it taught nothing, so I removed it. Then I made tasks hints instead of answers, so "the color of a lemon" makes you turn a need into words the AI can use.

Next, I made sure the builder never guesses. At first, a vague prompt got a coin flip that was right 1 time in 3, and it felt random. Now anything left out gets a plain default, an "I read" card shows how the prompt was read, and players can fix things by talking: "make it yellow" or "move it to the roof."

Playtests shaped the rest. The AI Impostor wrecked too fast, so every wreck now takes at least half as long as a fix. Nobody ever got voted out, so AI votes now come after the discussion, and people can change their minds. Trying the Impostor side meant replaying until the random draw dealt it, so a solo player can now pick Crew or Impostor and try either side right away. When roles are random, people get the Impostor more often than AI players. I also wanted to practice prompts without wrecks and meetings in the way, so I added Practice mode: just you and the builder, with no clock.

## What the agent did

Claude wrote the code and the automated tests. I directed every decision, played each change before it shipped, and turned down what did not fit, like a cartoon restyle that looked too sad for the island.

## How I tested it

I played every path myself: as crew, as the Impostor, as a ghost, in Practice mode, and signing in and out. I also brought in friends in other states and on other continents, people in tech who have played games like this, so I could hear how they think it should be better.

Testing found real bugs, and each one is fixed. A ghost froze after a second player was voted out. On the live site, an ejected player sometimes did not come back as a ghost, because updates arrived one at a time. The sign in buttons stayed dead after pressing back.

The automated checks back that up. 76 tests pass, including whole games through the real server actions. A stress run of 100 full games ended every game with a winner and no failed tick. A flood of 51 chat messages stayed within the cap of 10 AI calls per meeting. Abusive prompts hit the limits: "build 100 ducks" placed 4, and the island stops at 220 objects. On the live site, "a lemon colored bird up high" was read as "a yellow bird," and 63 AI calls cost $0.02.

## What comes next

A browser runs the game clock, so if every player closes the tab, the game pauses until someone returns. Next, I want to spend more time on the prompts and the gameplay, so every task is a prompt worth writing.

## Why it matters

When you do not prompt well, the AI does not understand what you meant. Saboteur Island lets people learn that the fun way, in a game almost everyone has played.
