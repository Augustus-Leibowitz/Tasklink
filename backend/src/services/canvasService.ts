import axios from 'axios';
import { prisma } from '../prisma';

export interface UpsertCanvasConfigParams {
  baseUrl: string;
  accessToken: string;
}

export interface FetchAssignmentsResult {
  coursesProcessed: number;
  assignmentsUpserted: number;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, '');
}

async function getOrCreateSingleUserId(): Promise<string> {
  const existing = await prisma.user.findFirst();
  if (existing) return existing.id;

  const created = await prisma.user.create({
    data: {},
  });
  return created.id;
}

export async function upsertCanvasConfig({ baseUrl, accessToken }: UpsertCanvasConfigParams) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const userId = await getOrCreateSingleUserId();

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
// as belonging to the *previous* calendar day.
function normalizeDueDate(dueAt: string | null | undefined): Date | null {
  if (!dueAt) return null;
  const date = new Date(dueAt);
  if (Number.isNaN(date.getTime())) return null;

  const hour = date.getHours();
  if (hour >= 0 && hour < 4) {
    const adjusted = new Date(date);
    adjusted.setDate(adjusted.getDate() - 1);
    return adjusted;
  }

  return date;
}

export async function fetchAndStoreUpcomingAssignments(): Promise<FetchAssignmentsResult> {
  const user = await prisma.user.findFirst({
    include: { canvasAccount: true },
  });

  if (!user || !user.canvasAccount) {
    throw new Error('Canvas configuration not found. Please save Canvas base URL and token first.');
  }

  const { baseUrl, accessToken } = user.canvasAccount;
  const authHeaders = {
    Authorization: `Bearer ${accessToken}`,
  };

  const coursesResponse = await axios.get<CanvasCourse[]>(
    `${baseUrl}/api/v1/courses`,
    {
      headers: authHeaders,
      params: {
        enrollment_state: 'active',
        per_page: 50,
      },
    },
  );

  const courses = coursesResponse.data;

  let coursesProcessed = 0;
  let assignmentsUpserted = 0;

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

    const assignmentsResponse = await axios.get<CanvasAssignment[]>(
      `${baseUrl}/api/v1/courses/${course.id}/assignments`,
      {
        headers: authHeaders,
        params: {
          bucket: 'upcoming',
          per_page: 50,
        },
      },
    );

    const assignments = assignmentsResponse.data;

    for (const assignment of assignments) {
      if (!assignment.id || !assignment.name) continue;

      const dueDate = normalizeDueDate(assignment.due_at);

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
  }

  return { coursesProcessed, assignmentsUpserted };
}
