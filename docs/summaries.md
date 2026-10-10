# Summaries

Every session gets a short structured summary, written by Haiku through your own `claude` login, so the app can answer "where is this one" without you reading the transcript.

**This uses your Claude account.** Each summary is one small `claude -p` call: a digest of the session goes in, a few hundred tokens of output come back, and it counts against your plan's usage like any other Claude call. Measured at about $0.002 per summary on Haiku, and a working session is summarised every few minutes (four by default), plus once when it finishes or needs you. Settings show the running total. If you would rather spend nothing, start with `--no-summaries` or set the mode to on request or off; everything else works without summaries, except the project headlines fall back to session titles and follow-ups are not detected.

![A summary in the drawer](images/drawer-summary.png)

## What and when

A summary has a headline, the goal, what is done so far, what is happening now, what comes next, and a verdict on whether the session is waiting for you. Project headlines, the one-liners above each project, come from the same mechanism.

| Mode | When a session is summarised |
|---|---|
| Automatic (default) | When first seen, whenever it finishes or needs you, and every few minutes while it works (the interval is a setting, four minutes by default). |
| On request | Only when you press "refresh" in the drawer. |
| Off | Never. Headlines fall back to session titles. Zero spend. |

## The waiting verdict

The verdict is judged from the last reply alone. A session is waiting for you only when that reply cannot proceed without you: it ends with a direct question to you, or asks you to choose, approve or provide something before work can continue. Offers such as "I can also do X", suggested next steps, a report of what was done, and questions that only appeared in earlier replies do not count.

A waiting verdict on a session that looks idle makes it a follow-up: it reads "needs you" until you have looked at it. [Using the app](using-the-app.md#needs-you-and-seen) describes what seen does.

## Cost and caching

Each summary runs `claude -p` with every setting source, MCP server, tool and plugin stripped, a tiny system prompt, low effort and `--max-turns 1`. Measured cost is about $0.002 and two to three seconds per summary on Haiku. Summaries are cached on disk by session and transcript position, so no state is summarised twice, and the cache survives restarts.

Settings (⚙ in the top bar) switch between the modes, set the refresh interval, and show what summaries have cost today and in total, taken from Claude's own accounting.

![Settings: summaries mode, refresh interval and spend](images/settings.png)

## Privacy

The summarizer is sent a bounded digest: the first prompt, the last few prompts, the last three replies, recent tool names, and the agents with their latest result. That is the only data that leaves your machine, and it goes through your own Claude login, the same place the session itself runs.

The digest is untrusted text, since it contains whatever the session and its tools printed. The summarizer therefore runs with no tools and a single turn: the worst a malicious transcript can do is produce a wrong summary.
