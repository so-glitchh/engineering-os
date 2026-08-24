import os
import sys
import json
import re
import time
from pathlib import Path
from datetime import date
import urllib.request
import urllib.error

# Setup
REPO_ROOT = Path(__file__).parent.resolve()

def load_env():
    env_file = REPO_ROOT / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ[k.strip()] = v.strip()

load_env()

LINEAR_API_KEY = os.getenv("LINEAR_API_KEY")
LINEAR_TEAM_ID = os.getenv("LINEAR_TEAM_ID")
DAILY_LOG = REPO_ROOT / "daily-log.md"
STATE_FILE = REPO_ROOT / "state.json"
CONTEXT_FILE = REPO_ROOT / "context.md"

DAYS_MAP = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

def linear_query(query, variables=None, retries=3):
    """Execute a GraphQL query against the Linear API."""
    if not LINEAR_API_KEY:
        raise ValueError("Missing LINEAR_API_KEY")
        
    url = "https://api.linear.app/graphql"
    headers = {
        "Authorization": LINEAR_API_KEY,
        "Content-Type": "application/json"
    }
    data = json.dumps({"query": query, "variables": variables or {}}).encode("utf-8")
    
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, data=data, headers=headers)
            with urllib.request.urlopen(req) as resp:
                result = json.loads(resp.read().decode())
                if "errors" in result:
                    raise RuntimeError(f"Linear GraphQL error: {result['errors']}")
                return result["data"]
        except urllib.error.HTTPError as e:
            if e.code == 429:
                if attempt < retries - 1:
                    time.sleep(2 ** attempt)
                    continue
            raise RuntimeError(f"Linear HTTP Error {e.code}: {e.read().decode()}")
        except Exception as e:
            raise RuntimeError(f"Network error: {e}")

def create_daily_log_template():
    """Create a template for today's entry if daily-log.md doesn't have one."""
    today_str = date.today().isoformat()
    day_name = DAYS_MAP[date.today().weekday()]
    
    entry = f"## {today_str} — {date.today().strftime('%A')}\n\n"
    entry += f"- [ ] Example task | Track: AI Engineering | Day: {day_name}\n\n"
    
    if DAILY_LOG.exists():
        content = DAILY_LOG.read_text()
        DAILY_LOG.write_text(entry + content)
    else:
        DAILY_LOG.write_text(f"# Daily Log\n\n{entry}")

def parse_target_line(line):
    """Parse a markdown checklist item with metadata pipes."""
    line = line.strip()
    if not line.startswith("- ["):
        return None
        
    done = "[x]" in line.lower()
    parts = line.split("|")
    
    # Extract task description
    main_part = parts[0].strip()
    desc = re.sub(r"^-\s*\[[ xX]\]\s*", "", main_part)
    
    # Default metadata
    track = "AI Engineering"
    day = DAYS_MAP[date.today().weekday()]
    
    # Parse inline metadata
    for part in parts[1:]:
        part = part.strip()
        if part.lower().startswith("track:"):
            track = part[6:].strip()
        elif part.lower().startswith("day:"):
            day = part[4:].strip()
            
    return {
        "id": str(int(time.time() * 1000) + hash(desc) % 10000), 
        "text": desc, 
        "track": track, 
        "day": day, 
        "done": done
    }

def resolve_team_id():
    """Convert a human-readable team key (like 'ENG') to a UUID if needed."""
    global LINEAR_TEAM_ID
    if not LINEAR_TEAM_ID or "-" in LINEAR_TEAM_ID:
        return # Already a UUID or missing
        
    query = """
    query {
      teams { nodes { id key name } }
    }
    """
    try:
        res = linear_query(query)
        for t in res["teams"]["nodes"]:
            if t["key"].lower() == LINEAR_TEAM_ID.lower() or t["name"].lower() == LINEAR_TEAM_ID.lower():
                print(f"Auto-resolved team '{LINEAR_TEAM_ID}' to UUID {t['id']}")
                LINEAR_TEAM_ID = t["id"]
                return
    except Exception as e:
        print(f"Failed to auto-resolve team ID: {e}")

def get_todays_targets():
    """Read today's section in daily-log.md and return parsed targets."""
    if not DAILY_LOG.exists():
        create_daily_log_template()
        return []
        
    today_str = date.today().isoformat()
    content = DAILY_LOG.read_text()
    
    # Match the section for today until the next date header
    pattern = rf"## {today_str}.*?(?=## \d{{4}}-\d{{2}}-\d{{2}}|\Z)"
    match = re.search(pattern, content, re.DOTALL)
    if not match:
        return []
        
    targets = []
    for line in match.group(0).split('\n'):
        t = parse_target_line(line)
        if t:
            targets.append(t)
            
    return targets

def update_state_json(targets):
    """Hydrate state.json with parsed targets for the index.html dashboard."""
    state = {"targets": []}
    if STATE_FILE.exists():
        try:
            state = json.loads(STATE_FILE.read_text())
            if "targets" not in state:
                state["targets"] = []
        except:
            pass
            
    existing_texts = {t["text"]: t for t in state["targets"]}
    
    for t in targets:
        if t["text"] in existing_texts:
            # Update existing target in state.json
            existing_texts[t["text"]]["done"] = t["done"]
            existing_texts[t["text"]]["track"] = t["track"]
            existing_texts[t["text"]]["day"] = t["day"]
        else:
            # Append new target
            state["targets"].append(t)
            
    STATE_FILE.write_text(json.dumps(state, indent=2))
    print("Hydrated state.json with targets from daily-log.md.")

def push_to_linear(targets):
    """Push new targets to Linear as issues if they don't already exist."""
    if not targets:
        return
        
    query = """
    query($teamId: String!) {
      team(id: $teamId) {
        issues(first: 50) {
          nodes { title }
        }
      }
    }
    """
    try:
        existing = linear_query(query, {"teamId": LINEAR_TEAM_ID})
        existing_titles = {i["title"] for i in existing["team"]["issues"]["nodes"]}
    except Exception as e:
        print(f"Failed to fetch existing issues from Linear: {e}")
        return

    create_mutation = """
    mutation($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue { identifier title }
      }
    }
    """
    
    for t in targets:
        if t["text"] in existing_titles:
            continue
            
        try:
            vars = {
                "input": {
                    "teamId": LINEAR_TEAM_ID,
                    "title": t["text"],
                    "priority": 2, # High
                    "dueDate": date.today().isoformat()
                }
            }
            res = linear_query(create_mutation, vars)
            print(f"Pushed to Linear: {res['issueCreate']['issue']['title']}")
        except Exception as e:
            print(f"Failed to push issue '{t['text']}': {e}")

def pull_from_linear(targets):
    """Fetch status from Linear and update targets if completed."""
    query = """
    query($teamId: String!) {
      team(id: $teamId) {
        issues(filter: { dueDate: { eq: "%s" } }, first: 50) {
          nodes { title state { type } }
        }
      }
    }
    """ % date.today().isoformat()
    
    try:
        result = linear_query(query, {"teamId": LINEAR_TEAM_ID})
        issues = result["team"]["issues"]["nodes"]
        status_map = {i["title"]: (i["state"]["type"] == "completed") for i in issues}
    except Exception as e:
        print(f"Failed to pull status from Linear: {e}")
        return targets

    for t in targets:
        if t["text"] in status_map and status_map[t["text"]]:
            t["done"] = True
            
    return targets

def rewrite_daily_log(targets):
    """Rewrite today's checkboxes in daily-log.md based on updated targets."""
    if not DAILY_LOG.exists():
        return
        
    content = DAILY_LOG.read_text()
    today_str = date.today().isoformat()
    
    pattern = rf"(## {today_str}.*?)(?=## \d{{4}}-\d{{2}}-\d{{2}}|\Z)"
    match = re.search(pattern, content, re.DOTALL)
    if not match:
        return
        
    section = match.group(1)
    
    for t in targets:
        # Match the old checkbox state and update it
        old_mark = r"-\s*\[[ xX]\]\s*" + re.escape(t["text"])
        new_mark = f"- [{'x' if t['done'] else ' '}] {t['text']}"
        section = re.sub(old_mark, new_mark, section)
        
    new_content = content[:match.start()] + section + content[match.end():]
    DAILY_LOG.write_text(new_content)
    print("Updated daily-log.md checkboxes from Linear statuses.")

def generate_context(targets):
    """Regenerate the context.md file with strict formatting."""
    done = sum(1 for t in targets if t["done"])
    total = len(targets)
    
    ctx = f"# Context — {date.today().isoformat()}\n\n"
    ctx += f"## Today's Targets ({done}/{total} completed)\n"
    
    for t in targets:
        mark = 'x' if t['done'] else ' '
        ctx += f"- [{mark}] {t['text']} (Track: {t['track']})\n"
        
    ctx += """
## Strict Rules
1. Pseudocode before code, always
2. Project first, cert after
3. Current month project must extend previous month
"""
    CONTEXT_FILE.write_text(ctx)
    print("Regenerated context.md for AI insertion.")

def main():
    print("Starting sync pipeline...")
    
    # Phase 1: Parse Markdown
    targets = get_todays_targets()
    
    # Phase 2: Linear API Synchronization
    if LINEAR_API_KEY and LINEAR_TEAM_ID:
        resolve_team_id()
        push_to_linear(targets)
        targets = pull_from_linear(targets)
        rewrite_daily_log(targets)
    else:
        print("Warning: Linear credentials missing from .env. Skipping API sync.")
        
    # Final Phase: Hydrate State and Generate Context
    update_state_json(targets)
    generate_context(targets)
    print("\nSync pipeline complete.")

if __name__ == "__main__":
    main()
