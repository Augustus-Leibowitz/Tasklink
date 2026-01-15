import axios from 'axios';
import { prisma } from '../prisma';

const TODOIST_API_BASE = 'https://api.todoist.com/rest/v2';

export interface UpsertTodoistConfigParams {
  userId: string;
  accessToken: string;
}

export interface TodoistProject {
  id: string;
  name: string;
};

export interface PriorityRangeInput {
  enabled?: boolean;
  to?: number; // 1-5, where 5 means 5+ days
  todoistPriority?: 1 | 2 | 3 | 4; // Todoist numeric priority
}

export interface PrioritySettingsInput {
  p1?: PriorityRangeInput;
  p2?: PriorityRangeInput;
  p3?: PriorityRangeInput;
  p4?: PriorityRangeInput;
}

interface TodoistTaskCreateResponse {
  id: string;
}

interface TodoistTask {
  id: string;
  content: string;
  project_id: string;
  due?: {
    date?: string | null;
  } | null;
}

export async function upsertTodoistConfig({ userId, accessToken }: UpsertTodoistConfigParams) {
  const account = await prisma.todoistAccount.upsert({
    where: { userId },
    update: {
      accessToken,
    },
    create: {
      userId,
      accessToken,
    },
  });

  return { userId, account };
}

export async function fetchTodoistProjects(userId: string): Promise<TodoistProject[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { todoistAccount: true },
  });

  if (!user || !user.todoistAccount) {
    throw new Error('Todoist configuration not found. Please save your Todoist token first.');
  }

  const { accessToken } = user.todoistAccount;

  const res = await axios.get<TodoistProject[]>(`${TODOIST_API_BASE}/projects`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  return res.data;
}

function toTodoistDate(date: Date | null): string | undefined {
  if (!date) return undefined;
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

type PriorityKey = 'p1' | 'p2' | 'p3' | 'p4';

interface NormalizedPriorityRange {
  enabled: boolean;
  to: number; // 1-5
  todoistPriority: 1 | 2 | 3 | 4;
}

interface NormalizedPrioritySettings {
  ranges: Record<PriorityKey, NormalizedPriorityRange>;
}

function clampDay(value: number): number {
  if (value <= 1) return 1;
  if (value === 2) return 2;
  if (value === 3) return 3;
  if (value === 4) return 4;
  return 5;
}

function normalizePrioritySettings(settings?: PrioritySettingsInput): NormalizedPrioritySettings {
  const base: Record<PriorityKey, NormalizedPriorityRange> = {
    p1: {
      enabled: settings?.p1?.enabled ?? true,
      to: clampDay(settings?.p1?.to ?? 2),
      todoistPriority: (settings?.p1?.todoistPriority as 1 | 2 | 3 | 4) ?? 4,
    },
    p2: {
      enabled: settings?.p2?.enabled ?? true,
      to: clampDay(settings?.p2?.to ?? 3),
      todoistPriority: (settings?.p2?.todoistPriority as 1 | 2 | 3 | 4) ?? 3,
    },
    p3: {
      enabled: settings?.p3?.enabled ?? true,
      to: clampDay(settings?.p3?.to ?? 4),
      todoistPriority: (settings?.p3?.todoistPriority as 1 | 2 | 3 | 4) ?? 2,
    },
    p4: {
      enabled: settings?.p4?.enabled ?? false,
      to: 5,
      todoistPriority: (settings?.p4?.todoistPriority as 1 | 2 | 3 | 4) ?? 1,
    },
  };

  // Ensure monotonic non-decreasing cuts for p1..p3
  let c1 = clampDay(base.p1.to);
  let c2 = clampDay(base.p2.to);
  let c3 = clampDay(base.p3.to);

  if (c2 < c1) c2 = clampDay(c1 + 1);
  if (c3 < c2) c3 = clampDay(c2 + 1);

  base.p1.to = c1;
  base.p2.to = c2;
  base.p3.to = c3;
  base.p4.to = 5;

  return { ranges: base };
}

// Compute conceptual priority bucket based on days until due.
// Overdue/today (diffDays <= 0) are always P1.
function computeConceptualBucket(diffDays: number, settings: NormalizedPrioritySettings): PriorityKey {
  if (diffDays <= 0) return 'p1';
  const day = clampDay(diffDays > 5 ? 5 : diffDays);
  const { p1, p2, p3 } = settings.ranges;

  if (day <= p1.to) return 'p1';
  if (day <= p2.to) return 'p2';
  if (day <= p3.to) return 'p3';
  return 'p4';
}

// Map a conceptual bucket to a Todoist priority, respecting enabled flags and nearest bucket.
function bucketToTodoistPriority(bucket: PriorityKey, settings: NormalizedPrioritySettings): number {
  const order: PriorityKey[] = ['p1', 'p2', 'p3', 'p4'];
  const idx = order.indexOf(bucket);

  // Prefer searching upward in urgency, then downward.
  for (let i = idx; i >= 0; i -= 1) {
    const key = order[i];
    const range = settings.ranges[key];
    if (range.enabled) return range.todoistPriority;
  }
  for (let i = idx + 1; i < order.length; i += 1) {
    const key = order[i];
    const range = settings.ranges[key];
    if (range.enabled) return range.todoistPriority;
  }

  // Fallback if everything is disabled.
  return 2;
}

export async function syncAssignmentsToTodoist(
  userId: string,
  courseIds: string[],
  prioritySettings?: PrioritySettingsInput,
): Promise<{
  created: number;
  skipped: number;
}> {
  if (courseIds.length === 0) {
    return { created: 0, skipped: 0 };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { todoistAccount: true },
  });

  if (!user || !user.todoistAccount) {
    throw new Error('Todoist configuration not found. Please save your Todoist token first.');
  }

  const { accessToken } = user.todoistAccount;

  const normalizedSettings = normalizePrioritySettings(prioritySettings);

  // Create a sync run record for visibility in the UI.
  const syncRun = await prisma.syncRun.create({
    data: {
      userId: user.id,
      status: 'RUNNING',
      message: `Starting sync for ${courseIds.length} course(s).`,
    },
  });

  const markSuccess = async (created: number, skipped: number) => {
    await prisma.syncRun.update({
      where: { id: syncRun.id },
      data: {
        finishedAt: new Date(),
        status: 'SUCCESS',
        message: `Created ${created} task(s), skipped ${skipped}.`,
      },
    });
  };

  const markError = async (err: unknown) => {
    await prisma.syncRun.update({
      where: { id: syncRun.id },
      data: {
        finishedAt: new Date(),
        status: 'ERROR',
        message: err instanceof Error ? err.message : 'Unknown sync error',
      },
    });
  };

  try {
    const courses = await prisma.course.findMany({
      where: {
        id: { in: courseIds },
        userId,
        todoistProjectId: { not: null },
      },
    });

    if (courses.length === 0) {
      await markSuccess(0, 0);
      return { created: 0, skipped: 0 };
    }

    const courseById = new Map(courses.map((c) => [c.id, c]));

    const assignments = await prisma.assignment.findMany({
      where: {
        courseId: { in: Array.from(courseById.keys()) },
      },
      include: { course: true },
    });

    // Build a cache of existing Todoist tasks per project so we can avoid
    // creating duplicates on resync and can update due dates for matching tasks.
    // We key by project + content (title) and ignore existing due dates, since
    // Tasklink's normalized due date is the source of truth.
    const projectIds = Array.from(
      new Set(
        courses
          .map((c) => c.todoistProjectId)
          .filter((p): p is string => typeof p === 'string' && p.length > 0),
      ),
    );

    const existingTasksByKey = new Map<string, string>();

    const makeTaskKey = (projectId: string, content: string) =>
      `${projectId}::${content.trim()}`;

    for (const projectId of projectIds) {
      try {
        const res = await axios.get<TodoistTask[]>(`${TODOIST_API_BASE}/tasks`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          params: {
            project_id: projectId,
          },
        });

        for (const task of res.data ?? []) {
          const key = makeTaskKey(projectId, task.content);
          if (!existingTasksByKey.has(key)) {
            existingTasksByKey.set(key, task.id);
          }
        }
      } catch (err) {
        // If fetching tasks for a project fails, log and continue. We'll still
        // avoid duplicates for projects we could read.
        // eslint-disable-next-line no-console
        console.warn(`Failed to load existing Todoist tasks for project ${projectId}`, err);
      }
    }

    let created = 0;
    let skipped = 0;

    for (const assignment of assignments) {
      const course = courseById.get(assignment.courseId);
      if (!course || !course.todoistProjectId) {
        skipped += 1;
        continue;
      }

      const today = new Date();
      const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const dueDateValue = assignment.dueDate ?? null;
      const conceptualBucket: PriorityKey = (() => {
        if (!dueDateValue) return 'p4';
        const dueMidnight = new Date(
          dueDateValue.getFullYear(),
          dueDateValue.getMonth(),
          dueDateValue.getDate(),
        );
        const diffMs = dueMidnight.getTime() - todayMidnight.getTime();
        const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
        return computeConceptualBucket(diffDays, normalizedSettings);
      })();

      const todoistPriority = bucketToTodoistPriority(conceptualBucket, normalizedSettings);
      const dueDate = toTodoistDate(assignment.dueDate);

      // If the assignment doesn't have a Todoist task yet, first try to link it
      // to an existing Todoist task with the same project and title. When a
      // match is found, we also update the Todoist task's due date and priority
      // to reflect the normalized Canvas due date.
      if (!assignment.todoistTaskId) {
        const taskKey = makeTaskKey(course.todoistProjectId, assignment.name);
        const existingTaskId = existingTasksByKey.get(taskKey);

        if (existingTaskId) {
          try {
            const updateBody: Record<string, unknown> = {
              priority: todoistPriority,
            };
            if (dueDate) {
              (updateBody as any).due_date = dueDate;
            } else {
              (updateBody as any).due_date = null;
            }

            await axios.post(
              `${TODOIST_API_BASE}/tasks/${existingTaskId}`,
              updateBody,
              {
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                  'Content-Type': 'application/json',
                },
              },
            );

            await prisma.assignment.update({
              where: { id: assignment.id },
              data: {
                todoistTaskId: existingTaskId,
                lastSyncedAt: new Date(),
              },
            });
            skipped += 1;
          } catch (err) {
            // If updating the existing task fails (e.g., it was deleted), fall
            // back to creating a new one below.
          }

          continue;
        }

        const body: Record<string, unknown> = {
          content: assignment.name,
          project_id: course.todoistProjectId,
          priority: todoistPriority,
        };

        if (dueDate) {
          body.due_date = dueDate;
        }

        try {
          const res = await axios.post<TodoistTaskCreateResponse>(`${TODOIST_API_BASE}/tasks`, body, {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
          });

          await prisma.assignment.update({
            where: { id: assignment.id },
            data: {
              todoistTaskId: res.data.id,
              lastSyncedAt: new Date(),
            },
          });

          // Track this newly created task in our cache so we don't create
          // another one for the same assignment during this sync run.
          existingTasksByKey.set(taskKey, res.data.id);

          created += 1;
        } catch (err) {
          skipped += 1;
        }

        continue;
      }

      // For assignments that already have a Todoist task, update both priority
      // and due date so they stay aligned with Canvas.
      try {
        const updateBody: Record<string, unknown> = {
          priority: todoistPriority,
        };
        if (dueDate) {
          (updateBody as any).due_date = dueDate;
        } else {
          (updateBody as any).due_date = null;
        }

        await axios.post(
          `${TODOIST_API_BASE}/tasks/${assignment.todoistTaskId}`,
          updateBody,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
          },
        );

        await prisma.assignment.update({
          where: { id: assignment.id },
          data: {
            lastSyncedAt: new Date(),
          },
        });
      } catch (err) {
        // If the task no longer exists in Todoist (e.g., deleted manually), clear the
        // todoistTaskId so that a future sync can recreate it.
        await prisma.assignment.update({
          where: { id: assignment.id },
          data: {
            todoistTaskId: null,
            lastSyncedAt: new Date(),
          },
        });
        skipped += 1;
      }
    }

    await markSuccess(created, skipped);
    return { created, skipped };
  } catch (err) {
    await markError(err);
    throw err;
  }
}
