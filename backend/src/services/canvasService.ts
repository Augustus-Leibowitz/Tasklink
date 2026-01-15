import axios from 'axios';
import { prisma } from '../prisma';

export interface UpsertCanvasConfigParams {
  userId: string;
  baseUrl: string;
  accessToken: string;
}

export interface FetchAssignmentsResult {
  coursesProcessed: number;
  assignmentsUpserted: number;
}

export interface FetchAssignmentsOptions {
  // How many days ahead from today to include. If null/undefined, include all future dates.
  daysAhead?: number | null;
  // Whether to include assignments that have no due date at all.
  includeNoDueDate?: boolean;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, '');
}

export async function upsertCanvasConfig({ userId, baseUrl, accessToken }: UpsertCanvasConfigParams) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);

  const account = await prisma.canvasAccount.upsert({
    where: { userId },
    update: {
      baseUrl: normalizedBaseUrl,
      accessToken,
    },
    create: {
      userId,
      baseUrl: normalizedBaseUrl,
      accessToken,
    },
  });

  return { userId, account };
}

interface CanvasCourse {
  id: number;
  name: string;
}

interface CanvasAssignment {
  id: number;
  name: string;
  description?: string | null;
  due_at?: string | null;
}

// Canvas often encodes "end of day" deadlines as very-early-morning timestamps (e.g., 1–2am).
// To avoid confusion in a date-only view, we treat any local time between 00:00 and 03:59
// as belonging to the *previous* calendar day, and we store due dates as date-only (midnight).
function normalizeDueDate(dueAt: string | null | undefined): Date | null {
  if (!dueAt) return null;
  const raw = new Date(dueAt);
  if (Number.isNaN(raw.getTime())) return null;

  let year = raw.getFullYear();
  let month = raw.getMonth();
  let day = raw.getDate();

  const hour = raw.getHours();
  if (hour >= 0 && hour < 4) {
    const adjusted = new Date(raw);
    adjusted.setDate(adjusted.getDate() - 1);
    year = adjusted.getFullYear();
    month = adjusted.getMonth();
    day = adjusted.getDate();
  }

  // Return a date set to local midnight of the logical due date so downstream
  // code and the UI can treat it purely as a date without time-of-day shifts.
  return new Date(year, month, day);
}

export async function fetchAndStoreUpcomingAssignments(
  userId: string,
  options: FetchAssignmentsOptions = {},
): Promise<FetchAssignmentsResult> {
  const { daysAhead, includeNoDueDate = true } = options;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { canvasAccount: true },
  });

  if (!user || !user.canvasAccount) {
    throw new Error('Canvas configuration not found. Please save Canvas base URL and token first.');
  }

  // If the user has chosen to ignore no-due-date assignments, proactively remove any existing
  // ones from the database for this user so they disappear from the UI and future syncs.
  if (!includeNoDueDate) {
    await prisma.assignment.deleteMany({
      where: {
        dueDate: null,
        course: {
          userId: user.id,
        },
      },
    });
  }

  const { baseUrl, accessToken } = user.canvasAccount;
  const authHeaders = {
    Authorization: `Bearer ${accessToken}`,
  };

  // Fetch active courses first (the common case).
  const activeCoursesResponse = await axios.get<CanvasCourse[]>(
    `${baseUrl}/api/v1/courses`,
    {
      headers: authHeaders,
      params: {
        enrollment_state: 'active',
        per_page: 50,
      },
    },
  );

  let courses: CanvasCourse[] = activeCoursesResponse.data ?? [];

  // Best-effort: try to also include invited/pending courses so newly added ones
  // show up even before the term fully starts. If Canvas does not support this
  // on a given instance, ignore the error instead of failing the whole run.
  try {
    const pendingResponse = await axios.get<CanvasCourse[]>(
      `${baseUrl}/api/v1/courses`,
      {
        headers: authHeaders,
        params: {
          enrollment_state: 'invited_or_pending',
          per_page: 50,
        },
      },
    );
    const pending = pendingResponse.data ?? [];
    const seen = new Set(courses.map((c) => c.id));
    for (const c of pending) {
      if (!seen.has(c.id)) {
        courses.push(c);
        seen.add(c.id);
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('Canvas invited_or_pending courses request failed; continuing with active courses only.', err);
  }

  let coursesProcessed = 0;
  let assignmentsUpserted = 0;

  // We want all future assignments (subject to optional look-ahead), not just Canvas's short
  // "upcoming" window. Compute "today" at local midnight so we can skip already-past-due work
  // and optionally cap how far ahead we look.
  const now = new Date();
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const maxDaysAhead = typeof daysAhead === 'number' && daysAhead > 0 ? daysAhead : null;

  for (const course of courses) {
    if (!course.id || !course.name) continue;

    const courseRecord = await prisma.course.upsert({
      where: {
        userId_canvasCourseId: {
          userId: user.id,
          canvasCourseId: String(course.id),
        },
      },
      update: {
        name: course.name,
      },
      create: {
        userId: user.id,
        canvasCourseId: String(course.id),
        name: course.name,
      },
    });

    coursesProcessed += 1;

    try {
      const assignmentsResponse = await axios.get<CanvasAssignment[]>(
        `${baseUrl}/api/v1/courses/${course.id}/assignments`,
        {
          headers: authHeaders,
          params: {
            // No bucket filter: fetch all assignments for the course.
            per_page: 50,
          },
        },
      );

      const assignments = assignmentsResponse.data;

      for (const assignment of assignments) {
      if (!assignment.id || !assignment.name) continue;

      const dueDate = normalizeDueDate(assignment.due_at);

      // Optionally skip assignments with no due date at all.
      if (!dueDate && !includeNoDueDate) {
        continue;
      }

      // Skip assignments that are clearly in the past; we only care about today and future.
      if (dueDate && dueDate < todayMidnight) {
        continue;
      }

      // If a look-ahead window is configured, skip assignments beyond that window.
      if (dueDate && maxDaysAhead !== null) {
        const diffMs = dueDate.getTime() - todayMidnight.getTime();
        const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
        if (diffDays > maxDaysAhead) {
          continue;
        }
      }

      await prisma.assignment.upsert({
        where: {
          courseId_canvasAssignmentId: {
            courseId: courseRecord.id,
            canvasAssignmentId: String(assignment.id),
          },
        },
        update: {
          name: assignment.name,
          description: assignment.description ?? null,
          dueDate,
        },
        create: {
          courseId: courseRecord.id,
          canvasAssignmentId: String(assignment.id),
          name: assignment.name,
          description: assignment.description ?? null,
          dueDate,
        },
      });

      assignmentsUpserted += 1;
    }
  } catch (err) {
    // If fetching assignments for a single course fails, log and continue so that
    // other courses can still be processed.
    // eslint-disable-next-line no-console
    console.error(`Failed to fetch assignments for Canvas course ${course.id}`, err);
  }
}

return { coursesProcessed, assignmentsUpserted };
}
