# company

Automatic token thrift for Claude Code. No commands needed. It loads with every session and runs under four rules: ponytail, headroom, i-have-adhd, caveman.

What it does:
- Router: each subagent goes to the cheapest model that fits (lookup Haiku, code Sonnet, review and research Opus max, design Opus xhigh).
- Governor: fixes wasteful effort; never uses Fable (it bills usage credits).
- Meter: 5-hour and weekly use in the status line; economy mode near the limits.
- Diet: short subagent reports; caps huge file reads and searches in the main loop.
- Charter: your 21 company rules and the four directives, in every session and subagent.

Run first, above every other plugin (once per device). Add this line to your user settings file (`~/.claude/settings.json`; Windows `%USERPROFILE%\.claude\settings.json`):

    "prependPlugins": ["company@synced"]

Already open session: run `/reload-plugins` if the mod is new there, then `/company`. `/company` starts everything again and shows what is on.

Status line: `company · 5h n% · week n% · k subagents routed · g efforts governed · n diet · directives n/4`.
