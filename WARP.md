# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Repository overview

This repository implements **Tasklink**, which imports upcoming assignments from Canvas into Todoist for students. The integration:
- Groups tasks into Todoist projects by course
- Sets due dates as date-only (no time)
- Automatically sets priorities based on how soon tasks are due
- Periodically checks Canvas (currently envisioned as every Friday) and imports new or updated tasks

The repo is structured as a TypeScript backend, a React frontend, and room for additional documentation:
- `backend/`: Node.js/TypeScript service using Express and Prisma with a SQLite database (for personal prototyping, with a path to Postgres later).
- `frontend/`: React + Vite + TypeScript single-page app that will serve as the dashboard for connecting Canvas and Todoist and displaying sync status.
- `docs/`: Reserved for future documentation and design notes.

## Intended architecture and code structure

At a high level, the system is a backend service plus a small web dashboard:

- `backend/`: Backend service that periodically fetches Canvas assignments, applies logic to map courses and prioritize tasks, and syncs them into Todoist.
  - Implemented in **Node.js + TypeScript** with **Express**.
  - Uses **Prisma** ORM with a **SQLite** database during personal prototyping (`DATABASE_URL="file:./prisma/dev.db"`), with the schema designed to be portable to Postgres later.
  - Exposes HTTP endpoints under the same origin (e.g., `/health` today, later `/auth/*`, `/sync/*`, etc.).
  - Responsible for:
    - Authenticating to Canvas and Todoist.
    - Fetching upcoming assignments from Canvas.
    - Mapping Canvas courses to Todoist projects.
    - Creating/updating Todoist tasks with appropriate due dates and priorities.
    - Tracking sync runs and status in the database.

- `frontend/`: React-based dashboard (Vite + TypeScript).
  - Renders a SPA that talks to the backend over HTTP.
  - Will guide the user through connecting Canvas and Todoist and configuring preferences.
  - Currently includes a minimal shell that calls the backend `/health` endpoint and displays its status.

- `docs/`: Documentation, design notes, and operational runbooks.
  - Suitable for API contracts, sync behavior documentation, and deployment instructions as the project grows.

### Backend data model (Prisma + SQLite)

The core entities are defined in `backend/prisma/schema.prisma` and surfaced via Prisma Client:
- `User`: represents a single end user; stores optional email/display name plus `canvasUserId` and `todoistUserId`.
- `CanvasAccount` / `TodoistAccount`: hold API tokens and metadata for Canvas and Todoist, each linked 1:1 with a `User`.
- `Course`: per-user mapping of a Canvas course (`canvasCourseId`) to a Todoist project (`todoistProjectId`), plus a human-readable name.
- `Assignment`: per-course Canvas assignment, with `canvasAssignmentId`, `name`, optional `description`, optional `dueDate`, and optional `todoistTaskId` + `lastSyncedAt` for tracking.
- `SyncRun`: records each sync execution for a user (`status`, timestamps, optional message) for observability and debugging.

This schema is currently backed by SQLite for local development; when moving to Postgres, update the datasource provider and `DATABASE_URL`, then run Prisma migrations against the new database.

## Commands: build, lint, and tests

### Backend (Node.js + TypeScript + Prisma)

All commands below are run from `backend/`:

- **Install dependencies**
  - `npm install`

- **Run the dev server** (auto-reloads on changes)
  - `npm run dev`
  - Starts an Express server on `http://localhost:4000`.
  - Health check: `GET http://localhost:4000/health` → `{ "status": "ok" }`.

- **Build the backend**
  - `npm run build`
  - Compiles TypeScript from `src/` to JavaScript in `dist/`.

- **Run the compiled backend**
  - `npm start`
  - Runs `node dist/server.js`.

- **Lint backend TypeScript**
  - `npm run lint`

- **Prisma / database workflows**
  - Ensure `backend/.env` exists (copied from `.env.example`), with:
    - `DATABASE_URL="file:./prisma/dev.db"`
  - Generate Prisma Client:
    - `npx prisma generate`
  - Apply schema changes to the local SQLite DB with a named migration:
    - `npx prisma migrate dev --name <migration-name>`

### Frontend (React + Vite + TypeScript)

All commands below are run from `frontend/`:

- **Install dependencies**
  - `npm install`

- **Run the frontend dev server**
  - `npm run dev`
  - Starts Vite on `http://localhost:5173`.
  - The root page renders a minimal dashboard shell that calls the backend `/health` endpoint and displays whether the backend is reachable.

- **Build the frontend**
  - `npm run build`

- **Preview the production build**
  - `npm run preview`

When developing locally, run both:
- Backend: `cd backend && npm run dev`
- Frontend: `cd frontend && npm run dev`

Then open the frontend URL in a browser; it should indicate whether the backend is healthy via the `/health` endpoint.
