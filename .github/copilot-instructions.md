# AI Agent Instructions

> **The authoritative codebase reference is `CLAUDE.md` at the project root.**
> Read it in full before writing any code.

`CLAUDE.md` covers:
- Project identity and what the app does
- Full tech stack with versions and which dependencies are dead/unused
- How to run, build, lint, and deploy
- All environment variables and where they're consumed
- Complete folder structure with per-file annotations
- Database schema (all tables, columns, constraints)
- TypeScript types (`ClothingItem`, `WorkflowBatch`, `SlimItem`)
- State management map (all state in `App.tsx`, no global store)
- External integrations (Supabase, Hugging Face, OpenAI, Web Speech API)
- How every core feature works step by step
- Critical business logic (slim saving, delete-then-insert, double-fire guard, etc.)
- Component dependency map and known fragile areas
- Known bugs with numbers and descriptions
- What's done and what's in progress
- A pre-task checklist (build + lint + smoke test)
- A hard "Do Not" list of footguns
