# Skill Governance SOP

## Overview
This document defines the Standard Operating Procedure (SOP) for managing, updating, synthesizing, and localizing skills sourced from external libraries, specifically the `awesome-skills` repository, within the Antigravity Bimodal Execution Framework.

## Core Principles
1. **Antigravity Hard-Gates Prevail:** The single-flow execution model, plan locking, and process gating inherited from Antigravity's core logic rule supreme. External skills cannot bypass them.
2. **Selective Synthesis:** When an external skill shares a name and purpose with a core skill, we do not overwrite the core skill. Instead, we synthesize:
   - Extract edge cases, robustness guidelines, and non-functional requirements.
   - Inject them into the core skill under `Extended Synthesis`.
3. **Traceability:** Every synthesized or imported skill must retain a YAML metadata block indicating:
   - `source`: Core, Community, or Synthesized
   - `risk`: Level of danger (Unknown, Low, High)
   - `date_added`: YYYY-MM-DD of integration

## Procedure For Importing New External Skills
1. **Validation:** Check `c:\Users\bhatt\antigravity setup\.agent\skills` for existing collisions.
2. **Non-Collisions:** Move unique skills into `.agent/skills/awesome-skills/`. Ensure they do not contradict the `MASTER_ANTIGRAVITY_PROFILE.md`.
3. **Collisions (Synthesis Required):**
   - Retain the core `.agent/skills/<skill-name>/SKILL.md`.
   - Strip the `SKILL.md` from the external repository.
   - Inject novel sections (e.g., `Decision Logs`, `Limitations`) into the core file.
   - Prepend with the `Extended Synthesis (Awesome-Skills)` marker so future AI agents know its origin.

## Periodic Auditing
- Verify that `using-superpowers` accurately lists the `.agent/skills/awesome-skills` directory for discovery.
- Routinely evaluate heavily used `awesome-skills` to determine if they should be promoted to core status and subjected to stricter Antigravity localization.
