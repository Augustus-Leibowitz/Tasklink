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

// Canvas often encodes due dates as timestamps in the institution's local timezone.
// This school is on Pacific Time, so we interpret all Canvas `due_at` values in
// America/Los_Angeles, then drop the time-of-day and store a date-only value.
// We materialize that date as **midday UTC** so that viewing the date from any
// user timezone will not shift it to the previous/next calendar day.
function normalizeDueDate(dueAt: string | null | undefined): Date | null {
  if (!dueAt) return null;
  const instant = new Date(dueAt);
  if (Number.isNaN(instant.getTime())) return null;

  // Extract the year/month/day in Pacific Time.
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });

  const parts = dtf.formatToParts(instant);
  const year = Number(parts.find((p) => p.type === 'year')?.value ?? NaN);
  const month = Number(parts.find((p) => p.type === 'month')?.value ?? NaN) - 1; // 0-based
  const day = Number(parts.find((p) => p.type === 'day')?.value ?? NaN);

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }

  // Store as midday UTC on that Pacific calendar date. Midday avoids crossing
  // date boundaries when viewed from other timezones.
  return new Date(Date.UTC(year, month, day, 12, 0, 0));
}

// Helper to fetch all pages from a Canvas collection endpoint using simple
// page-based pagination. Canvas uses 1-based `page` with `per_page`.
async function fetchAllPages<T>(
  url: string,
  params: Record<string, unknown>,
  headers: Record<string, string>,
): Promise<T[]> {
  const all: T[] = [];
  const perPage = 50;
  let page = 1;

  // Stop once we receive a page with fewer than `perPage` results.
  // This avoids relying on Link headers and keeps the logic simple.
  // If Canvas ever returns an empty page, we also stop.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await axios.get<T[]>(url, {
      headers,
      params: { ...params, per_page: perPage, page },
    });
    const data = res.data ?? [];
    if (data.length === 0) {
      break;
    }
    all.push(...data);
    if (data.length < perPage) {
      break;
    }
    page += 1;
  }

  return all;
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

  // Fetch all active courses (not just the first page).
  const activeCourses = await fetchAllPages<CanvasCourse>(
    `${baseUrl}/api/v1/courses`,
    { enrollment_state: 'active' },
    authHeaders,
  );

  let courses: CanvasCourse[] = activeCourses;

  // Best-effort: try to also include invited/pending courses so newly added ones
  // show up even before the term fully starts. If Canvas does not support this
  // on a given instance, ignore the error instead of failing the whole run.
  try {
    const pendingCourses = await fetchAllPages<CanvasCourse>(
      `${baseUrl}/api/v1/courses`,
      { enrollment_state: 'invited_or_pending' },
      authHeaders,
    );
    const seen = new Set(courses.map((c) => c.id));
    for (const c of pendingCourses) {
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
      // Fetch all assignments for the course across all pages so that we don't
      // silently drop anything beyond the first 50.
      const assignments = await fetchAllPages<CanvasAssignment>(
        `${baseUrl}/api/v1/courses/${course.id}/assignments`,
        {
          // No bucket filter: fetch all assignments for the course.
        },
        authHeaders,
      );

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
