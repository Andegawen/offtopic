# offtopic

A Claude Code mod that shows how far your conversation has drifted: a live histogram of the session's topics, drawn above the prompt.

```
offtopic · 31 exchanges · main: mod authoring · 42% off-topic
mod authoring      ████████████████████████████ 18
github publishing  ██████████ 6
plugin research    ██████ 4
```

After each of Claude's turns, one Haiku call labels the exchange (your prompt and Claude's reply) with a short topic, reusing an existing topic when it fits. The biggest topic is the main one; every other topic counts as off-topic, and the header shows the off-topic share in green, yellow or red. When the mod first loads in a session, it labels the earlier exchanges (up to the last 40) in a single call so the chart starts filled in.

- `/offtopic` hides or shows the histogram.
- `/offtopic reset` clears it and classifies the session again.

## Cost

The mod uses your Claude Code credentials: a few hundred Haiku tokens per turn, and one larger call when it first loads in a session with history. Interrupted turns, subagents and slash commands are not classified.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install offtopic --marketplace Andegawen/offtopic
```

Answer `y` to add the marketplace, then pick a scope.

From a shell:

```
claude plugin install offtopic --marketplace Andegawen/offtopic
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `Andegawen/offtopic`, then Add plugin.
