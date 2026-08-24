# solid-saas-template skills

Six skills, written so another Claude instance dropped into a clone of this
template can work correctly without rediscovering how it fits together.

| Skill | Load it when |
|---|---|
| [`template-architecture`](template-architecture/SKILL.md) | First contact. The four server layers, what enforces what, and where a given piece of logic belongs. |
| [`add-permission`](add-permission/SKILL.md) | Changing who may do what — the enum, the grants, and the escalation rules permissions cannot express. |
| [`add-tenant-resource`](add-tenant-resource/SKILL.md) | A new tenant-owned table, end to end: migration, RLS, service, RPC, query, screen. |
| [`solidstart-tanstack-seam`](solidstart-tanstack-seam/SKILL.md) | Routes, loaders, SSR, hydration — the least standard part of the stack. |
| [`park-ui-conventions`](park-ui-conventions/SKILL.md) | Any UI work: the responsive table contract, portals, and the layout traps. |
| [`resource-descriptors`](resource-descriptors/SKILL.md) | The framework layer: descriptors, sorting, DataTable, bulk actions, codegen. |
| [`testing-and-verification`](testing-and-verification/SKILL.md) | Running or writing tests, and the environment traps around them. |

Start with `template-architecture`; it links onward.

## Why these exist

The template's non-obvious parts are non-obvious in both directions: several of
these rules look like arbitrary style until the bug they prevent shows up, and
several plausible "fixes" reintroduce a bug that was already paid for once.
Each skill states the rule *and* the failure, so the reasoning survives without
the person who did the debugging.

Everything cited was checked against the code at the time of writing. Where a
skill and the code disagree, the code is right — fix the skill.

## Using them outside this repo

The skills describe *this* codebase, including real paths and line references.
Copied into a project built from this template they stay accurate as long as the
structure does; they are not general SolidStart or Supabase advice.
