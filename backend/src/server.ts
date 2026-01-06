import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { upsertCanvasConfig, fetchAndStoreUpcomingAssignments } from './services/canvasService';
import { upsertTodoistConfig, fetchTodoistProjects, syncAssignmentsToTodoist } from './services/todoistService';
import { prisma } from './prisma';

dotenv.config();

const app = express();
const port = Number(process.env.PORT) || 4000;

// Allow configuring CORS origin for deployment; default to local Vite dev server.
const rawCorsOrigin = process.env.CORS_ORIGIN || 'http://localhost:5173';
const corsOrigins = rawCorsOrigin.split(',').map((o) => o.trim()).filter(Boolean);

// Simple in-memory auto-sync scheduler (per backend process).
let autoSyncIntervalMinutes = 0;
let autoSyncTimer: NodeJS.Timeout | null = null;

async function runAutoSync() {
  try {
    // Fetch latest Canvas assignments first.
    await fetchAndStoreUpcomingAssignments();

    // Sync all courses that have a mapped Todoist project.
    const mappedCourses = await prisma.course.findMany({
      where: { todoistProjectId: { not: null } },
      select: { id: true },
    });

    if (mappedCourses.length === 0) return;

    await syncAssignmentsToTodoist(mappedCourses.map((c) => c.id));
  } catch (err) {
    // For now, just log; in the future we could persist these.
    // eslint-disable-next-line no-console
    console.error('Auto-sync run failed', err);
  }
}

function configureAutoSync(intervalMinutes: number) {
  if (autoSyncTimer) {
    clearInterval(autoSyncTimer);
    autoSyncTimer = null;
  }

  autoSyncIntervalMinutes = intervalMinutes;

  if (intervalMinutes > 0) {
    autoSyncTimer = setInterval(() => {
      void runAutoSync();
    }, intervalMinutes * 60 * 1000);
  }
}

app.use(
  cors({
    origin: corsOrigins.length === 0 ? '*' : corsOrigins,
  }),
);
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/status', async (_req, res) => {
  try {
    const user = await prisma.user.findFirst({
      include: { canvasAccount: true, todoistAccount: true },
    });

    const coursesCount = await prisma.course.count();
    const assignmentsCount = await prisma.assignment.count();

    return res.json({
      canvas: {
        configured: !!user?.canvasAccount,
        baseUrl: user?.canvasAccount?.baseUrl ?? null,
      },
      todoist: {
        configured: !!user?.todoistAccount,
      },
      summary: {
        coursesCount,
        assignmentsCount,
      },
      autoSync: {
        enabled: autoSyncIntervalMinutes > 0,
        intervalMinutes: autoSyncIntervalMinutes,
      },
    });
  } catch (err) {
    console.error('Error loading status', err);
    return res.status(500).json({ error: 'Failed to load status' });
  }
});

app.post('/api/canvas/config', async (req, res) => {
  try {
    const { baseUrl, accessToken } = req.body as { baseUrl?: string; accessToken?: string };

    if (!baseUrl || !accessToken) {
      return res.status(400).json({ error: 'baseUrl and accessToken are required' });
    }

    const result = await upsertCanvasConfig({ baseUrl, accessToken });

    return res.json({
      message: 'Canvas configuration saved',
      userId: result.userId,
      baseUrl: result.account.baseUrl,
    });
  } catch (err) {
    console.error('Error saving Canvas config', err);
    return res.status(500).json({ error: 'Failed to save Canvas configuration' });
  }
});

app.post('/api/canvas/fetch-assignments', async (_req, res) => {
  try {
    const result = await fetchAndStoreUpcomingAssignments();
    return res.json({
      message: 'Fetched upcoming assignments from Canvas',
      ...result,
    });
  } catch (err) {
    console.error('Error fetching assignments from Canvas', err);
    return res.status(500).json({
      error:
        err instanceof Error
          ? err.message
          : 'Failed to fetch assignments from Canvas',
    });
  }
});

app.get('/api/assignments/upcoming', async (_req, res) => {
  try {
    const assignments = await prisma.assignment.findMany({
      include: { course: true },
      orderBy: [
        { dueDate: 'asc' },
        { createdAt: 'desc' },
      ],
      take: 200,
    });

    return res.json({
      assignments: assignments.map((a) => ({
        id: a.id,
        name: a.name,
        courseName: a.course?.name ?? 'Unknown course',
        dueDate: a.dueDate,
        synced: !!a.todoistTaskId,
        lastSyncedAt: a.lastSyncedAt,
      })),
    });
  } catch (err) {
    console.error('Error loading assignments', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to load assignments',
    });
  }
});

app.get('/api/courses', async (_req, res) => {
  try {
    const courses = await prisma.course.findMany({
      orderBy: { name: 'asc' },
    });

    return res.json({
      courses: courses.map((c) => ({
        id: c.id,
        name: c.name,
        todoistProjectId: c.todoistProjectId,
      })),
    });
  } catch (err) {
    console.error('Error loading courses', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to load courses',
    });
  }
});

app.post('/api/courses/map-project', async (req, res) => {
  try {
    const { courseId, todoistProjectId } = req.body as {
      courseId?: string;
      todoistProjectId?: string | null;
    };

    if (!courseId) {
      return res.status(400).json({ error: 'courseId is required' });
    }

    const updated = await prisma.course.update({
      where: { id: courseId },
      data: {
        todoistProjectId: todoistProjectId || null,
      },
    });

    return res.json({
      id: updated.id,
      name: updated.name,
      todoistProjectId: updated.todoistProjectId,
    });
  } catch (err) {
    console.error('Error mapping course to Todoist project', err);
    return res.status(500).json({
      error:
        err instanceof Error
          ? err.message
          : 'Failed to map course to Todoist project',
    });
  }
});

app.post('/api/todoist/config', async (req, res) => {
  try {
    const { accessToken } = req.body as { accessToken?: string };

    if (!accessToken) {
      return res.status(400).json({ error: 'accessToken is required' });
    }

    const result = await upsertTodoistConfig({ accessToken });

    return res.json({
      message: 'Todoist configuration saved',
      userId: result.userId,
    });
  } catch (err) {
    console.error('Error saving Todoist config', err);
    return res.status(500).json({ error: 'Failed to save Todoist configuration' });
  }
});

app.get('/api/todoist/projects', async (_req, res) => {
  try {
    const projects = await fetchTodoistProjects();
    return res.json({ projects });
  } catch (err) {
    console.error('Error fetching Todoist projects', err);
    return res.status(500).json({
      error:
        err instanceof Error ? err.message : 'Failed to fetch Todoist projects',
    });
  }
});

app.post('/api/todoist/sync-assignments', async (req, res) => {
  try {
    const { courseIds, prioritySettings } = req.body as {
      courseIds?: string[];
      prioritySettings?: import('./services/todoistService').PrioritySettingsInput;
    };

    if (!courseIds || !Array.isArray(courseIds) || courseIds.length === 0) {
      return res.status(400).json({ error: 'courseIds must be a non-empty array' });
    }

    const result = await syncAssignmentsToTodoist(courseIds, prioritySettings);
    return res.json({
      message: 'Synced assignments to Todoist',
      ...result,
    });
  } catch (err) {
    console.error('Error syncing assignments to Todoist', err);
    return res.status(500).json({
      error:
        err instanceof Error ? err.message : 'Failed to sync assignments to Todoist',
    });
  }
});

app.get('/api/auto-sync', (_req, res) => {
  return res.json({
    enabled: autoSyncIntervalMinutes > 0,
    intervalMinutes: autoSyncIntervalMinutes,
  });
});

app.get('/api/sync-runs', async (_req, res) => {
  try {
    const runs = await prisma.syncRun.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    return res.json({
      runs: runs.map((r) => ({
        id: r.id,
        startedAt: r.startedAt ?? r.createdAt,
        finishedAt: r.finishedAt,
        status: r.status,
        message: r.message,
      })),
    });
  } catch (err) {
    console.error('Error loading sync history', err);
    return res.status(500).json({ error: 'Failed to load sync history' });
  }
});

app.post('/api/auto-sync', (req, res) => {
  const { enabled, intervalMinutes } = req.body as {
    enabled?: boolean;
    intervalMinutes?: number;
  };

  if (!enabled) {
    configureAutoSync(0);
    return res.json({ enabled: false, intervalMinutes: 0 });
  }

  const minutes = typeof intervalMinutes === 'number' && intervalMinutes > 0 ? intervalMinutes : 60;
  configureAutoSync(minutes);
  return res.json({ enabled: true, intervalMinutes: minutes });
});

app.listen(port, () => {
  console.log(`Backend listening on port ${port}`);
});
