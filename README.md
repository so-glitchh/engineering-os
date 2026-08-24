# Engineering OS

Personal engineering dashboard & productivity system for a 6-month AI engineering roadmap.

## What this is

- **`index.html`** — Single-file dashboard. Opens in any browser, stores state in `localStorage`, supports JSON import/export for cross-device sync.
- **`sync.py`** — Python script that syncs daily targets with Linear (GraphQL API) and generates `context.md` for LLM context continuity.
- **`state.json`** — Portable state file. Commit to repo for cross-device sync.

## Quick start

```bash
# 1. Open the dashboard
open index.html
# or: python -m http.server 8000  → http://localhost:8000

# 2. Set up Linear sync (optional)
cp .env.example .env
# Edit .env with your Linear API key and team ID
pip install requests python-dotenv
python sync.py --context    # generates context.md without Linear credentials

# 3. Full sync (requires Linear credentials)
python sync.py
```

## Daily workflow

```
10:00  Open dashboard → add 3 targets via "+ add"
10:05  Copy targets to daily-log.md (or write directly there)
...    Work through blocks A/B/C
19:30  git add . && git commit -m "Fixes ENG-XX: <what shipped>"
       git push && python sync.py
21:30  Export state.json, commit for cross-device sync
```

## LLM context continuity

The right panel generates a live `context.md` preview. Paste into any LLM session:

| Provider | How to use |
|---|---|
| **Ollama** | Paste as first message |
| **Groq / OpenRouter** | Paste as system prompt |
| **Antigravity** | Drop `context.md` at project root — auto-detected |

## GitHub Pages

Dashboard is live at: `https://tsvlgd.github.io/engineering-os/`

## File structure

```
engineering-os/
├── index.html        # unified dashboard
├── sync.py           # Linear & context sync
├── state.json        # portable state
├── daily-log.md      # daily work log
├── .env.example      # Linear API template
├── .gitignore        # ignores .env, __pycache__, temp
└── README.md         # this file
```
