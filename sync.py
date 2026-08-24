#!/usr/bin/env python3
"""
sync.py — the one script that ties everything together.

What it does:
1. Reads today's targets from daily-log.md (your local markdown)
2. Creates/updates matching issues in Linear via their GraphQL API
3. Pulls issue status back from Linear, writes completion back to daily-log.md
4. Regenerates context.md — a single file summarizing current state,
   which you paste into ANY LLM (Ollama, Groq, OpenRouter, Antigravity)
   so you never lose context switching providers.

Setup:
    pip install requests python-dotenv

    Create a .env file next to this script:
        LINEAR_API_KEY=lin_api_xxxxx     # Linear Settings -> API -> Create key
        LINEAR_TEAM_ID=xxxxx             # found in Linear team settings URL

Run:
    python sync.py                # full sync, both directions
    python sync.py --push-only    # just create today's issues from daily-log.md
    python sync.py --pull-only    # just pull Linear status into daily-log.md
    python sync.py --context      # just regenerate context.md
"""

import os
import re
import sys
import json
from datetime import datetime, date
from pathlib import Path

try:
    import requests
except ImportError:
    print("Error: 'requests' package not installed. Run: pip install requests")
    sys.exit(1)

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # .env loading is optional; env vars can be set directly

LINEAR_API_KEY = os.environ.get("LINEAR_API_KEY", "").strip()
LINEAR_TEAM_ID = os.environ.get("LINEAR_TEAM_ID", "").strip()
LINEAR_API_URL = "https://api.linear.app/graphql"

REPO_ROOT = Path(__file__).parent
DAILY_LOG = REPO_ROOT / "daily-log.md"
CONTEXT_FILE = REPO_ROOT / "context.md"
STATE_FILE = REPO_ROOT / "state.json"


def linear_query(query, variables=None):
    """Send a GraphQL query to Linear's API with error handling."""
    if not LINEAR_API_KEY:
        raise RuntimeError("LINEAR_API_KEY not set")

    headers = {"Authorization": LINEAR_API_KEY, "Content-Type": "application/json"}
    try:
        resp = requests.post(
            LINEAR_API_URL,
            json={"query": query, "variables": variables or {}},
            headers=headers,
            timeout=15,
        )
    except requests.exceptions.ConnectionError:
        raise RuntimeError("Network error: could not reach Linear API. Check your connection.")
    except requests.exceptions.Timeout:
        raise RuntimeError("Linear API request timed out (15s). Try again later.")
    except requests.exceptions.RequestException as e:
        raise RuntimeError(f"HTTP request failed: {e}")

    if resp.status_code == 429:
        raise RuntimeError("Linear API rate limit hit. Wait a few minutes and retry.")
    if resp.status_code == 401:
        raise RuntimeError("Linear API authentication failed. Check your LINEAR_API_KEY.")
    if resp.status_code >= 400:
        raise RuntimeError(f"Linear API returned HTTP {resp.status_code}: {resp.text[:200]}")

    try:
        data = resp.json()
    except json.JSONDecodeError:
        raise RuntimeError(f"Linear returned invalid JSON: {resp.text[:200]}")

    if "errors" in data:
        raise RuntimeError(f"Linear GraphQL error: {data['errors']}")
    return data["data"]


def get_todays_targets_from_log():
    """Parse today's 3 targets from daily-log.md."""
    if not DAILY_LOG.exists():
        print("No daily-log.md found. Creating from template.")
        create_daily_log_template()
        return []

    today_str = date.today().isoformat()
    content = DAILY_LOG.read_text()

    # find today's section
    pattern = rf"## {today_str}.*?(?=## \d{{4}}-\d{{2}}-\d{{2}}|\Z)"
    match = re.search(pattern, content, re.DOTALL)
    if not match:
        print(f"No entry for {today_str} in daily-log.md")
        return []

    section = match.group(0)
    targets = re.findall(r"- \[([ x])\] (.+)", section)
    return [{"done": t[0] == "x", "text": t[1].strip()} for t in targets]


def create_daily_log_template():
    """Create today's entry in daily-log.md if it doesn't exist."""
    today_str = date.today().isoformat()
    day_name = date.today().strftime("%A")

    entry = f"""
## {today_str} — {day_name}

- [ ] Target 1:
- [ ] Target 2:
- [ ] Target 3:

Commit: (fill after 19:30 push)
"""
    if DAILY_LOG.exists():
        existing = DAILY_LOG.read_text()
        DAILY_LOG.write_text(entry + "\n" + existing)
    else:
        DAILY_LOG.write_text(f"# Daily Log\n{entry}")

    print(f"Created template for {today_str}. Fill in your 3 targets and re-run.")


def push_targets_to_linear(targets):
    """Create Linear issues for today's targets that don't exist yet."""
    if not targets:
        print("No targets to push.")
        return

    # check existing issues today to avoid duplicates
    query = """
    query($teamId: String!) {
      team(id: $teamId) {
        issues(filter: { title: { contains: "" } }, first: 50) {
          nodes { id title state { name } }
        }
      }
    }
    """
    existing = linear_query(query, {"teamId": LINEAR_TEAM_ID})
    existing_titles = {i["title"] for i in existing["team"]["issues"]["nodes"]}

    create_mutation = """
    mutation($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue { id identifier title }
      }
    }
    """

    for t in targets:
        if t["text"] in existing_titles:
            continue
        variables = {
            "input": {
                "teamId": LINEAR_TEAM_ID,
                "title": t["text"],
                "priority": 2,  # high
                "dueDate": date.today().isoformat(),
            }
        }
        result = linear_query(create_mutation, variables)
        issue = result["issueCreate"]["issue"]
        print(f"Created Linear issue {issue['identifier']}: {issue['title']}")


def pull_status_from_linear():
    """Pull current issue statuses from Linear, return as dict."""
    query = """
    query($teamId: String!) {
      team(id: $teamId) {
        issues(filter: { dueDate: { eq: "%s" } }, first: 50) {
          nodes {
            id
            identifier
            title
            state { name type }
          }
        }
      }
    }
    """ % date.today().isoformat()

    result = linear_query(query, {"teamId": LINEAR_TEAM_ID})
    issues = result["team"]["issues"]["nodes"]
    return {i["title"]: i["state"]["type"] == "completed" for i in issues}


def update_daily_log_from_linear(status_map):
    """Rewrite today's checkboxes in daily-log.md based on Linear status."""
    if not DAILY_LOG.exists() or not status_map:
        return

    content = DAILY_LOG.read_text()
    today_str = date.today().isoformat()

    def replace_checkbox(match):
        checked, text = match.group(1), match.group(2).strip()
        is_done = status_map.get(text, checked == "x")
        return f"- [{'x' if is_done else ' '}] {text}"

    pattern = rf"(## {today_str}.*?)(?=## \d{{4}}-\d{{2}}-\d{{2}}|\Z)"
    section_match = re.search(pattern, content, re.DOTALL)
    if section_match:
        updated_section = re.sub(r"- \[([ x])\] (.+)", replace_checkbox, section_match.group(1))
        content = content[:section_match.start()] + updated_section + content[section_match.end():]
        DAILY_LOG.write_text(content)
        print("Updated daily-log.md with Linear statuses.")


def get_state_data():
    """Read state from state.json if it exists, for context generation."""
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text())
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def regenerate_context_file():
    """
    Build context.md — the single file you paste into ANY LLM to restore
    full context, regardless of provider (Ollama/Groq/OpenRouter/Antigravity).
    """
    targets = get_todays_targets_from_log()
    done_count = sum(1 for t in targets if t["done"])

    state_data = get_state_data()
    current_month = state_data.get("currentMonth", 1)

    # try to read from the doc if present
    doc_path = REPO_ROOT / "docs" / "mehfooj_engineering_doc.md"
    if doc_path.exists():
        m = re.search(r"currentMonth[\"']?\s*:\s*(\d+)", doc_path.read_text())
        if m:
            current_month = m.group(1)

    context = f"""# Context — {date.today().isoformat()}

You are helping Mehfooj Alam with his 6-month engineering roadmap.
Full plan lives in mehfooj_engineering_doc.md in this repo.

## Current state
- Month: {current_month} of 6
- Today's targets: {done_count}/{len(targets)} done

## Today's targets
{chr(10).join(f"- [{'x' if t['done'] else ' '}] {t['text']}" for t in targets) if targets else "(none set yet)"}

## Rules to follow when helping
1. Never write code before Mehfooj writes pseudocode first (cognitive friction protocol)
2. Project-first: he builds, then takes certifications, never the reverse
3. One resource per concept — don't suggest additional playlists/courses
4. Flag if he's about to start a new resource before finishing the current project
5. Current month's project must extend the previous month's — never suggest a disconnected new project

## Reference
Full roadmap: mehfooj_engineering_doc.md
Project spine: see "6-Month Project Spine" section
Resource map: see "Resource Map" section — do not add resources outside this list
"""
    CONTEXT_FILE.write_text(context)
    print(f"Regenerated context.md ({len(context)} chars) — paste this into any LLM session.")


def has_linear_credentials():
    """Check if Linear API credentials are configured."""
    return bool(LINEAR_API_KEY) and bool(LINEAR_TEAM_ID)


def main():
    args = sys.argv[1:]

    # --context works without Linear credentials
    if "--context" in args:
        regenerate_context_file()
        return

    if not has_linear_credentials():
        print("Warning: LINEAR_API_KEY or LINEAR_TEAM_ID not set in .env")
        print("Get your API key: Linear -> Settings -> API -> Create key")
        print("Generating context.md only (no Linear sync).")
        regenerate_context_file()
        return

    try:
        if "--pull-only" not in args:
            targets = get_todays_targets_from_log()
            push_targets_to_linear(targets)

        if "--push-only" not in args:
            status_map = pull_status_from_linear()
            update_daily_log_from_linear(status_map)

        regenerate_context_file()
        print("\nSync complete.")

    except RuntimeError as e:
        print(f"\nSync failed: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"\nUnexpected error during sync: {type(e).__name__}: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
