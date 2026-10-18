# AI tooling — Claude Code setup for JobFlex

The plugins, MCP servers and skills used to build JobFlex with Claude Code, and
how to install each one. Inventory taken 2026-10-17 from the owner's machine.
No secrets are in this file: where a server needs a key, the variable's name is
given and the value comes from the owner (or your own account).

Install Claude Code first (`npm install -g @anthropic-ai/claude-code`, or the
desktop app / VS Code extension), sign in, and open it in this repo
(`c:\joblfex-v3`). Restart Claude Code after adding plugins or MCP servers.

## What this repo already gives you

These load automatically when you open the project. Claude Code asks once to
approve them.

- **Project MCP servers** in [`.mcp.json`](../.mcp.json): context7, playwright,
  chrome-devtools, vercel, posthog.
- **Project skills** in [`.claude/skills/`](../.claude/skills/):
  - `jobflex-page-styler`: the design workflow; it points at [DESIGN.md](../DESIGN.md).
  - `frontend-design`
  - `mobile-app-ui-design`
- **Rules** in [`CLAUDE.md`](../CLAUDE.md) and [`AGENTS.md`](../AGENTS.md), and
  the design spec in [`DESIGN.md`](../DESIGN.md).

Everything below is per-user and has to be installed on each machine.

## 1. Plugins

Run these inside a Claude Code session. Add each marketplace once, then install
from it.

```text
/plugin marketplace add anthropics/claude-plugins-official
/plugin install superpowers@claude-plugins-official
/plugin install frontend-design@claude-plugins-official
/plugin install skill-creator@claude-plugins-official
/plugin install security-guidance@claude-plugins-official

/plugin marketplace add mksglu/context-mode
/plugin install context-mode@context-mode

/plugin marketplace add juliusbrussee/caveman
/plugin install caveman@caveman

/plugin marketplace add EveryInc/compound-engineering-plugin
/plugin install compound-engineering@compound-engineering-plugin

/plugin marketplace add openai/codex-plugin-cc
/plugin install codex@openai-codex

/plugin marketplace add https://github.com/Owl-Listener/designer-skills.git
/plugin install design-research@designer-skills
/plugin install design-systems@designer-skills
/plugin install ux-strategy@designer-skills
/plugin install ui-design@designer-skills
/plugin install interaction-design@designer-skills
/plugin install prototyping-testing@designer-skills
/plugin install design-ops@designer-skills
/plugin install designer-toolkit@designer-skills
/plugin install visual-critique@designer-skills
```

| Plugin | What it is for |
| --- | --- |
| superpowers | Process skills: brainstorming, writing and executing plans, systematic debugging, verification before completion. |
| frontend-design | Component and page build guidance. CLAUDE.md asks for it on any component build. |
| skill-creator | Writing new skills (CLAUDE.md: propose a skill first, then create it). |
| security-guidance | Security hints while editing. |
| context-mode | Keeps large command output out of the conversation (`ctx_execute`, `ctx_search`). Updates with `/ctx-upgrade`. |
| caveman | Short replies. Optional; turn it off with "normal mode". |
| compound-engineering | Planning, review and PR workflows (`ce-*` commands). |
| codex | Hands a task or a second opinion to OpenAI Codex. Needs the Codex CLI and an OpenAI login (`/codex:setup`). |
| designer-skills (9 plugins) | Design research, systems, UX strategy, UI, interaction, prototyping, design ops, critique. |

`claude-mem@thedotmack` is installed on the owner's machine but switched off. You can leave it out.

## 2. MCP servers (user level)

Run these in a terminal. `--scope user` makes them available in every project.

```bash
# Library documentation (also in the project's .mcp.json)
claude mcp add --scope user --transport http context7 https://mcp.context7.com/mcp

# Browser automation for checking pages (also in the project's .mcp.json)
claude mcp add --scope user playwright -- npx -y @playwright/mcp@latest

# Web search
claude mcp add --scope user --transport http exa https://mcp.exa.ai/mcp

# Web scraping — signs in with OAuth on first use (/mcp in a session)
claude mcp add --scope user --transport http firecrawl https://mcp.firecrawl.dev/v2/mcp-oauth

# GitHub — the official server. Download github-mcp-server from
# https://github.com/github/github-mcp-server/releases, then:
claude mcp add --scope user github -e GITHUB_PERSONAL_ACCESS_TOKEN=<your token> -- <path to>/github-mcp-server stdio
```

Optional, per project. These are already listed in `.mcp.json`, or are added
only when needed:

```bash
# Stripe — read and manage the Stripe account (use a TEST key locally)
claude mcp add --transport http stripe https://mcp.stripe.com
# Vercel — deployments and logs (OAuth on first use)
claude mcp add --transport http vercel https://mcp.vercel.com
# Chrome DevTools — performance and console inspection
claude mcp add chrome-devtools -- npx -y chrome-devtools-mcp@latest
```

Check what is connected with `/mcp` inside a session, or `claude mcp list`.

### Browser and claude.ai connectors

- **Claude in Chrome**: install the "Claude" extension from the Chrome Web
  Store, sign in with the same account, and run `/chrome` in Claude Code.
  It is used to look at the running app in your own browser.
- **claude.ai connectors** (Gmail, Google Calendar, Google Drive, Claude
  Docs, Mobbin, Higgsfield): switch them on at claude.ai → Settings →
  Connectors. Claude Code picks them up with the same login. JobFlex work
  does not need them.

## 3. Skills (user level)

Skills live in `~/.claude/skills/<name>/SKILL.md` (Windows:
`C:\Users\<you>\.claude\skills\`). The ones used for JobFlex work:

| Skill | Use | Install |
| --- | --- | --- |
| **impeccable** | Design passes on UI (refine, critique, polish, layout) inside the Blueprint system. | From [impeccable.style](https://impeccable.style) (Apache 2.0): put its folder at `~/.claude/skills/impeccable/` (`SKILL.md`, `reference/`, `scripts/`). |
| **design-clarity** | The owner's UI clarity rules: larger readable type, less clutter, clear next action. | The owner's own skill. Get the text from the owner and save it as `~/.claude/skills/design-clarity/SKILL.md`. |
| **get-shit-done** (`gsd-*`, 67 skills) | Phase planning, execution, review and QA workflows. | `npx get-shit-done-cc@latest`, then pick Claude Code and global install. |
| **antigravity-awesome-skills** (about 1,500 skills) | A large general library (frameworks, testing, SEO, cloud, design). | `git clone https://github.com/sickn33/antigravity-awesome-skills`, then copy the skill folders from its `skills/` directory into `~/.claude/skills/`. |
| **ckm design pack** (`ckm:design`, `ckm:brand`, `ckm:ui-styling`, `ckm:design-system`, `ckm:slides`, `ckm:banner-design`) | Brand, design-system and slide work. | Copied into `~/.claude/skills/` with the collection above. Optional. |

Do **not** use the user-level `blueprint` skill for design work: it is a
construction-plan generator (antbotlab/blueprint), not the JobFlex Blueprint
design. The JobFlex Blueprint design is [DESIGN.md](../DESIGN.md) plus the
project's `jobflex-page-styler` skill.

## 4. Check the setup

In a Claude Code session in this repo:

1. `/mcp`: context7, playwright and chrome-devtools are connected; vercel and
   firecrawl show "needs auth" until you sign in.
2. `/plugin`: the plugins above are listed and enabled.
3. Ask "list the skills you have". jobflex-page-styler, impeccable and the
   superpowers skills should be among them.

Test accounts and the rules for using them are in [CLAUDE.md](../CLAUDE.md)
("Test accounts"). Automated runs sign in only as `qa@acme.test`.
