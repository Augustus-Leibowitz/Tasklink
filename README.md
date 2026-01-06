# Tasklink

This project imports upcoming assignments from Canvas into Todoist for students.

- Groups tasks into Todoist projects by course
- Sets due dates (date-only, no time)
- Automatically sets priorities based on how soon tasks are due
- Checks Canvas every Friday and imports new/updated tasks

## High-level idea

A backend service periodically fetches Canvas assignments, applies AI-powered logic to map courses and prioritize tasks, and then syncs them into Todoist. A small frontend (likely a web dashboard) lets students connect their Canvas and Todoist accounts and configure preferences.