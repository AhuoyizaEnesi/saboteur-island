# Design notes

## Tradeoffs

Each of these is a deliberate choice that keeps a party game simple and fast, and each one has a guard.

- **Vision is drawn in the browser.** DeepSpace records sync to every player in a game, so the browser hides what is outside your vision circle. Filtering records per player would need a server streaming custom state to each browser. For a game played with friends, hiding it on screen is enough. The data that decides the game is locked by permissions: roles and task lists are readable only by their owner, and wreck clues only by server actions.
- **Live movement comes from browsers.** Presence carries walking about ten times a second and stores nothing, so the server cannot read it. Browsers also send a checkpoint every 1.5 seconds, and every action carries the caller's position. The server pulls back any move faster than walking speed, so nobody can teleport to a task.
- **A browser runs the clock.** DeepSpace cron runs at most once a minute, which is too slow for a 7 minute round. The host's browser calls `tick` every second, and if the host leaves, the next person online takes over. If everyone closes the tab, the game waits until someone comes back.

## What playtesting changed

Playtests with friends led to these changes.

- **Practice mode.** Testing prompts used to mean playing a whole game. Practice is just you and the builder: 4 tasks, no clock.
- **Tasks are requests, not answers.** Each task is a line in someone's words that hints at the details ("the color of a lemon"), so writing the prompt is the work.
- **Place words matter.** Where things go comes from the prompt, and some tasks check the place.
- **Same prompt, same result.** A vague prompt gets the same default every time (a bird comes out brown). The builder never sees the task.
- **The "I read" card.** It shows how each part of the prompt was read and what the builder filled in.
- **Fix it by talking.** A prompt can recolor, move or remove what you built, in 3 seconds.
- **Misses teach.** The first miss says which part is off. The second says exactly what was asked for.
- **Pick your role.** Playing alone, you can choose Random, Crew or Impostor. With other people the pick is ignored, so nobody can tell who chose.
- **Fair Impostor odds.** Each person counts 4 times as much as an AI player in the draw, so playing alone you are the Impostor about half the time.
- **AI players argue like people.** Every message gets a reply, the player you name answers with an alibi, and AI players vote after the whole discussion and can be swayed while voting.
- **Paced sabotage.** The AI Impostor's first wreck waits 75 seconds, then one every 60 to 80 seconds, with lights out at most twice.
- **Building takes time.** A build takes 8 seconds and a wreck 4, standing at the landmark. Walking away cancels both.
- **Leave and end.** Leaving hands your seat to an AI player, and the host can end the game.
- **A camera you can turn.** Drag to turn it, and the movement keys follow.
- **Music and one mute button.** An Afrobeat instrumental plays on every page and drops lower during meetings. One button on every page mutes it with the sound effects.
