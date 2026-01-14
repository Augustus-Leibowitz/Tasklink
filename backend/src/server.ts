import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import { upsertCanvasConfig, fetchAndStoreUpcomingAssignments } from './services/canvasService';
import { upsertTodoistConfig, fetchTodoistProjects, syncAssignmentsToTodoist } from './services/todoistService';
import { prisma } from './prisma';
import {
  authMiddleware,
  clearSessionCookie,
  getSessionFromRequest,
  getUserEmailFromRequest,
  getUserIdFromRequest,
  redirectToFrontend,
  requireAuth,
  setSessionCookie,
} from './auth';

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
    if (!autoSyncUserId) return;

    // Fetch latest Canvas assignments first, using default detection options (all future, include no-due-date).
    await fetchAndStoreUpcomingAssignments(autoSyncUserId);

    // Sync all courses that have a mapped Todoist project for this user.
    const mappedCourses = await prisma.course.findMany({
      where: { userId: autoSyncUserId, todoistProjectId: { not: null } },
      select: { id: true },
    });

    if (mappedCourses.length === 0) return;

    await syncAssignmentsToTodoist(autoSyncUserId, mappedCourses.map((c) => c.id));
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
    credentials: true,
  }),
);
app.use(cookieParser());
app.use(express.json());
app.use(authMiddleware);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Lightweight auth status endpoint used by the frontend shell.
app.get('/api/me', (req, res) => {
  const session = getSessionFromRequest(req);
  if (!session) {
    return res.json({ authenticated: false });
  }
  return res.json({
    authenticated: true,
    user: {
      email: session.email ?? getUserEmailFromRequest(req),
    },
  });
});

// Register a new user with email/password and start a session.
app.post('/auth/register', async (req, res) => {
  const { email, password, name, remember } = req.body as {
    email?: string;
    password?: string;
    name?: string;
    remember?: boolean;
  };

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const normalizedEmail = email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    return res.status(400).json({ error: 'An account with this email already exists.' });
  }

  const bcrypt = await import('bcryptjs');
  const hash = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: {
      email: normalizedEmail,
      passwordHash: hash,
      displayName: name ?? null,
    },
  });

  setSessionCookie(res, { userId: user.id, email: user.email, remember });
  return res.json({ user: { email: user.email } });
});

// Log in with email/password and start a session.
app.post('/auth/login', async (req, res) => {
  const { email, password, remember } = req.body as {
    email?: string;
    password?: string;
    remember?: boolean;
  };

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const normalizedEmail = email.toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

  if (!user || !user.passwordHash) {
    return res.status(400).json({ error: 'Invalid email or password.' });
  }

  const bcrypt = await import('bcryptjs');
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(400).json({ error: 'Invalid email or password.' });
  }

  setSessionCookie(res, { userId: user.id, email: user.email, remember });
  return res.json({ user: { email: user.email } });
});

app.post('/auth/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ success: true });
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

app.post('/api/canvas/config', requireAuth, async (req, res) => {
  try {
    const { baseUrl, accessToken } = req.body as { baseUrl?: string; accessToken?: string };
    const userId = getUserIdFromRequest(req);

    if (!baseUrl || !accessToken) {
      return res.status(400).json({ error: 'baseUrl and accessToken are required' });
    }

    const result = await upsertCanvasConfig({ userId, baseUrl, accessToken });

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

app.post('/api/canvas/fetch-assignments', requireAuth, async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    const { daysAhead, includeNoDueDate } = req.body as {
      daysAhead?: number | null;
      includeNoDueDate?: boolean;
    };

    const result = await fetchAndStoreUpcomingAssignments(userId, { daysAhead, includeNoDueDate });
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

app.get('/api/assignments/upcoming', requireAuth, async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    const assignments = await prisma.assignment.findMany({
      where: {
        course: {
          userId,
        },
      },
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

app.get('/api/courses', requireAuth, async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    const courses = await prisma.course.findMany({
      where: { userId },
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

app.post('/api/courses/map-project', requireAuth, async (req, res) => {
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

app.post('/api/todoist/config', requireAuth, async (req, res) => {
  try {
    const { accessToken } = req.body as { accessToken?: string };
    const userId = getUserIdFromRequest(req);

    if (!accessToken) {
      return res.status(400).json({ error: 'accessToken is required' });
    }

    const result = await upsertTodoistConfig({ userId, accessToken });

    return res.json({
      message: 'Todoist configuration saved',
      userId: result.userId,
    });
  } catch (err) {
    console.error('Error saving Todoist config', err);
    return res.status(500).json({ error: 'Failed to save Todoist configuration' });
  }
});

app.get('/api/todoist/projects', requireAuth, async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    const projects = await fetchTodoistProjects(userId);
    return res.json({ projects });
  } catch (err) {
    console.error('Error fetching Todoist projects', err);
    return res.status(500).json({
      error:
        err instanceof Error ? err.message : 'Failed to fetch Todoist projects',
    });
  }
});

app.post('/api/todoist/sync-assignments', requireAuth, async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    const { courseIds, prioritySettings } = req.body as {
      courseIds?: string[];
      prioritySettings?: import('./services/todoistService').PrioritySettingsInput;
    };

    if (!courseIds || !Array.isArray(courseIds) || courseIds.length === 0) {
      return res.status(400).json({ error: 'courseIds must be a non-empty array' });
    }

    const result = await syncAssignmentsToTodoist(userId, courseIds, prioritySettings);
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

app.get('/api/auto-sync', requireAuth, (_req, res) => {
  return res.json({
    enabled: autoSyncIntervalMinutes > 0,
    intervalMinutes: autoSyncIntervalMinutes,
  });
});

app.get('/api/sync-runs', requireAuth, async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    const runs = await prisma.syncRun.findMany({
      where: { userId },
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

let autoSyncUserId: string | null = null;

app.post('/api/auto-sync', requireAuth, (req, res) => {
  const userId = getUserIdFromRequest(req);
  const { enabled, intervalMinutes } = req.body as {
    enabled?: boolean;
    intervalMinutes?: number;
  };

  if (!enabled) {
    configureAutoSync(0);
    autoSyncUserId = null;
    return res.json({ enabled: false, intervalMinutes: 0 });
  }

  const minutes = typeof intervalMinutes === 'number' && intervalMinutes > 0 ? intervalMinutes : 60;
  autoSyncUserId = userId;
  configureAutoSync(minutes);
  return res.json({ enabled: true, intervalMinutes: minutes });
});

app.listen(port, () => {
  console.log(`Backend listening on port ${port}`);
});
