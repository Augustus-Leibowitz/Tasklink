import React, { useEffect, useState } from 'react';
import './App.css';

type UiAssignment = {
  id: string;
  name: string;
  courseName: string;
  dueDate: string | null;
  synced: boolean;
  lastSyncedAt: string | null;
};

type TodoistProject = {
  id: string;
  name: string;
};

type UiCourse = {
  id: string;
  name: string;
  todoistProjectId: string | null;
};

type UiSyncRun = {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  message: string | null;
};
type HelpTopic = 'canvasConfig' | 'todoistConfig' | 'autoSync' | 'assignments';

type DayOption = 1 | 2 | 3 | 4 | 5; // 5 = 5+ days

type PriorityKey = 'p1' | 'p2' | 'p3' | 'p4';

type PriorityRangeConfig = {
  enabled: boolean;
  // upper bound of the range in days (inclusive), 5 = 5+.
  to: DayOption;
  // Todoist numeric priority this bucket maps to: 4 = Todoist P1 (highest), 1 = P4 (lowest).
  todoistPriority: 1 | 2 | 3 | 4;
};

type PrioritySettings = {
  p1: PriorityRangeConfig;
  p2: PriorityRangeConfig;
  p3: PriorityRangeConfig;
  p4: PriorityRangeConfig;
};

type DetectionSettings = {
  // null = all future assignments
  daysAhead: number | null;
  // whether to include assignments that have no due date
  includeNoDueDate: boolean;
};

type AuthState = 'unknown' | 'unauthenticated' | 'authenticated';

type CurrentUser = {
  email: string | null;
};

type BackendStatus = {
  canvasConfigured: boolean;
  canvasBaseUrl: string | null;
  todoistConfigured: boolean;
  coursesCount: number;
  assignmentsCount: number;
  autoSyncEnabled: boolean;
  autoSyncIntervalMinutes: number;
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000';

export const App: React.FC = () => {
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const [authState, setAuthState] = useState<AuthState>('unknown');
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [rememberMe, setRememberMe] = useState(true);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [backendStatus, setBackendStatus] = useState<BackendStatus | null>(null);
  const [themeMode, setThemeMode] = useState<'light' | 'dark' | 'system'>('system');
  const [systemPrefersDark, setSystemPrefersDark] = useState(true);
  const [view, setView] = useState<'main' | 'settings'>('main');
  const [helpTopic, setHelpTopic] = useState<HelpTopic | null>(null);

  const [canvasBaseUrl, setCanvasBaseUrl] = useState('https://your-campus.instructure.com');
  const [canvasToken, setCanvasToken] = useState('');
  const [canvasSaving, setCanvasSaving] = useState(false);
  const [canvasSyncing, setCanvasSyncing] = useState(false);
  const [canvasResult, setCanvasResult] = useState<string | null>(null);
  const [canvasError, setCanvasError] = useState<string | null>(null);

  const [assignments, setAssignments] = useState<UiAssignment[]>([]);
  const [assignmentsLoading, setAssignmentsLoading] = useState(false);
  const [assignmentsError, setAssignmentsError] = useState<string | null>(null);

  const [todoistToken, setTodoistToken] = useState('');
  const [todoistSaving, setTodoistSaving] = useState(false);
  const [todoistProjects, setTodoistProjects] = useState<TodoistProject[]>([]);
  const [todoistProjectsLoading, setTodoistProjectsLoading] = useState(false);
  const [todoistError, setTodoistError] = useState<string | null>(null);
  const [todoistResult, setTodoistResult] = useState<string | null>(null);

  const [courses, setCourses] = useState<UiCourse[]>([]);
  const [coursesLoading, setCoursesLoading] = useState(false);
  const [coursesError, setCoursesError] = useState<string | null>(null);

  const [syncRuns, setSyncRuns] = useState<UiSyncRun[]>([]);
  const [syncRunsLoading, setSyncRunsLoading] = useState(false);
  const [syncRunsError, setSyncRunsError] = useState<string | null>(null);

  const [prioritySettings, setPrioritySettings] = useState<PrioritySettings>({
    p1: { enabled: true, to: 2, todoistPriority: 4 }, // Todoist P1
    p2: { enabled: true, to: 3, todoistPriority: 3 }, // Todoist P2
    p3: { enabled: true, to: 4, todoistPriority: 2 }, // Todoist P3
    p4: { enabled: false, to: 5, todoistPriority: 1 }, // Todoist P4, off by default
  });

  const [detectionSettings, setDetectionSettings] = useState<DetectionSettings>({
    daysAhead: null, // all future
    includeNoDueDate: true,
  });

  const [syncSelectedCourseIds, setSyncSelectedCourseIds] = useState<string[]>([]);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const [autoSyncEnabled, setAutoSyncEnabled] = useState(false);
  const [autoSyncIntervalMinutes, setAutoSyncIntervalMinutes] = useState(0);
  const [autoSyncSaving, setAutoSyncSaving] = useState(false);

  // Check backend health independently so we can show it even on the login screen.
  useEffect(() => {
    const checkHealth = async () => {
      try {
        setStatus('loading');
        const healthRes = await fetch(`${API_BASE_URL}/health`);

        if (!healthRes.ok) {
          throw new Error('Health check failed with status ' + healthRes.status);
        }

        const health = (await healthRes.json()) as { status?: string };
        if (health.status === 'ok') {
          setStatus('ok');
          setMessage('Backend is healthy');
        } else {
          setStatus('error');
          setMessage('Unexpected health response from backend');
        }
      } catch (err) {
        setStatus('error');
        if (err instanceof Error) {
          setMessage(err.message);
        } else {
          setMessage('Unknown error');
        }
      }
    };

    void checkHealth();
  }, []);

  // Check auth status on load.
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/me`, {
          credentials: 'include',
        });

        if (!res.ok) {
          setAuthState('unauthenticated');
          return;
        }

        const body = (await res.json()) as {
          authenticated?: boolean;
          user?: { email?: string | null };
        };

        if (body.authenticated && body.user) {
          setAuthState('authenticated');
          setCurrentUser({ email: body.user.email ?? null });
        } else {
          setAuthState('unauthenticated');
        }
      } catch {
        setAuthState('unauthenticated');
      }
    };

    void checkAuth();
  }, []);

  // Once authenticated, load status + recent sync runs.
  useEffect(() => {
    if (authState !== 'authenticated') return;

    const fetchStatusAndSync = async () => {
      try {
        const statusRes = await fetch(`${API_BASE_URL}/api/status`, {
          credentials: 'include',
        });

        if (statusRes.ok) {
          const s = (await statusRes.json()) as {
            canvas: { configured: boolean; baseUrl: string | null };
            todoist: { configured: boolean };
            summary: { coursesCount: number; assignmentsCount: number };
            autoSync: { enabled: boolean; intervalMinutes: number };
          };

          setBackendStatus({
            canvasConfigured: s.canvas.configured,
            canvasBaseUrl: s.canvas.baseUrl,
            todoistConfigured: s.todoist.configured,
            coursesCount: s.summary.coursesCount,
            assignmentsCount: s.summary.assignmentsCount,
            autoSyncEnabled: s.autoSync.enabled,
            autoSyncIntervalMinutes: s.autoSync.intervalMinutes,
          });
          setAutoSyncEnabled(s.autoSync.enabled);
          setAutoSyncIntervalMinutes(s.autoSync.intervalMinutes || 0);
          if (s.canvas.baseUrl) {
            setCanvasBaseUrl(s.canvas.baseUrl);
          }
        }

        try {
          await loadSyncRuns();
        } catch {
          // ignore here; errors are handled in the history card when user refreshes.
        }
      } catch (err) {
        setStatus('error');
        if (err instanceof Error) {
          setMessage(err.message);
        } else {
          setMessage('Unknown error');
        }
      }
    };

    void fetchStatusAndSync();
  }, [authState]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const storedTheme = window.localStorage.getItem('tasklink-theme');
    if (storedTheme === 'light' || storedTheme === 'dark' || storedTheme === 'system') {
      setThemeMode(storedTheme);
    } else {
      setThemeMode('system');
    }

    const storedPriority = window.localStorage.getItem('tasklink-priority-settings');
    if (storedPriority) {
      try {
        const parsed = JSON.parse(storedPriority) as any;

        // Backwards-compat: migrate old shape { p1MaxDays, p2MaxDays, useTodoistP4 }
        if (typeof parsed.p1MaxDays === 'number' || typeof parsed.p2MaxDays === 'number') {
          const p1Max = typeof parsed.p1MaxDays === 'number' ? parsed.p1MaxDays : 2;
          const p2Max = typeof parsed.p2MaxDays === 'number' ? parsed.p2MaxDays : 3;
          const useP4 = typeof parsed.useTodoistP4 === 'boolean' ? parsed.useTodoistP4 : true;
          setPrioritySettings({
            p1: { enabled: true, to: clampDay(p1Max), todoistPriority: useP4 ? 4 : 3 },
            p2: { enabled: true, to: clampDay(Math.max(p1Max + 1, p2Max)), todoistPriority: 3 },
            p3: { enabled: true, to: 4, todoistPriority: 2 },
            p4: { enabled: !useP4, to: 5, todoistPriority: 1 },
          });
        } else {
          // New shape
          setPrioritySettings((prev) => normalizePrioritySettingsFromStorage(parsed as Partial<PrioritySettings>, prev));
        }
      } catch {
        // ignore bad data
      }
    }

    const storedDetection = window.localStorage.getItem('tasklink-detection-settings');
    if (storedDetection) {
      try {
        const parsed = JSON.parse(storedDetection) as any;
        setDetectionSettings({
          daysAhead:
            typeof parsed.daysAhead === 'number' && parsed.daysAhead > 0 ? parsed.daysAhead : null,
          includeNoDueDate:
            typeof parsed.includeNoDueDate === 'boolean' ? parsed.includeNoDueDate : true,
        });
      } catch {
        // ignore bad data
      }
    }

    const mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
    if (!mq) return;

    setSystemPrefersDark(mq.matches);

    const listener = (event: MediaQueryListEvent) => {
      setSystemPrefersDark(event.matches);
    };

    if (mq.addEventListener) {
      mq.addEventListener('change', listener);
    } else {
      // @ts-expect-error older browsers
      mq.addListener(listener);
    }

    return () => {
      if (mq.removeEventListener) {
        mq.removeEventListener('change', listener);
      } else {
        // @ts-expect-error older browsers
        mq.removeListener(listener);
      }
    };
  }, []);

  const clampDay = (value: number): DayOption => {
    if (value <= 1) return 1;
    if (value === 2) return 2;
    if (value === 3) return 3;
    if (value === 4) return 4;
    return 5;
  };

  const normalizePrioritySettingsFromStorage = (
    parsed: Partial<PrioritySettings>,
    fallback: PrioritySettings,
  ): PrioritySettings => {
    const safe = (key: PriorityKey): PriorityRangeConfig => {
      const src = (parsed as any)[key] as Partial<PriorityRangeConfig> | undefined;
      if (!src) return fallback[key];
      const to = typeof src.to === 'number' ? clampDay(src.to) : fallback[key].to;
      const enabled = typeof src.enabled === 'boolean' ? src.enabled : fallback[key].enabled;
      const todoistPriority =
        src.todoistPriority === 1 || src.todoistPriority === 2 || src.todoistPriority === 3 || src.todoistPriority === 4
          ? src.todoistPriority
          : fallback[key].todoistPriority;
      return { enabled, to, todoistPriority };
    };

    const base: PrioritySettings = {
      p1: safe('p1'),
      p2: safe('p2'),
      p3: safe('p3'),
      p4: safe('p4'),
    };

    return normalizePriorityCuts(base);
  };

  const normalizePriorityCuts = (settings: PrioritySettings): PrioritySettings => {
    // Ensure strictly non-decreasing cuts and clamp to [1..5]
    let c1 = clampDay(settings.p1.to);
    let c2 = clampDay(settings.p2.to);
    let c3 = clampDay(settings.p3.to);

    if (c2 < c1) c2 = clampDay(c1 + 1);
    if (c3 < c2) c3 = clampDay(c2 + 1);

    const result: PrioritySettings = {
      p1: { ...settings.p1, to: c1 },
      p2: { ...settings.p2, to: c2 },
      p3: { ...settings.p3, to: c3 },
      p4: { ...settings.p4, to: 5 },
    };

    return result;
  };

  const handleSaveCanvasConfig = async () => {
    try {
      setCanvasSaving(true);
      setCanvasError(null);
      setCanvasResult(null);

      const res = await fetch(`${API_BASE_URL}/api/canvas/config`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          baseUrl: canvasBaseUrl,
          accessToken: canvasToken,
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || 'Request failed with status ' + res.status);
      }

      const body = (await res.json()) as { message?: string };
      setCanvasResult(body.message ?? 'Canvas configuration saved.');
    } catch (err) {
      if (err instanceof Error) {
        setCanvasError(err.message);
      } else {
        setCanvasError('Unknown error saving Canvas configuration');
      }
    } finally {
      setCanvasSaving(false);
    }
  };

  const loadAssignments = async () => {
    try {
      setAssignmentsLoading(true);
      setAssignmentsError(null);

      const res = await fetch(`${API_BASE_URL}/api/assignments/upcoming`, {
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || 'Request failed with status ' + res.status);
      }

      const body = (await res.json()) as { assignments?: UiAssignment[] };
      let next = body.assignments ?? [];
      if (!detectionSettings.includeNoDueDate) {
        next = next.filter((a) => a.dueDate !== null);
      }
      setAssignments(next);
    } catch (err) {
      if (err instanceof Error) {
        setAssignmentsError(err.message);
      } else {
        setAssignmentsError('Unknown error loading assignments');
      }
    } finally {
      setAssignmentsLoading(false);
    }
  };

  const loadCourses = async () => {
    try {
      setCoursesLoading(true);
      setCoursesError(null);

      const res = await fetch(`${API_BASE_URL}/api/courses`, {
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || 'Request failed with status ' + res.status);
      }

      const body = (await res.json()) as { courses?: UiCourse[] };
      const loaded = body.courses ?? [];
      setCourses(loaded);
      setSyncSelectedCourseIds(loaded.filter((c) => c.todoistProjectId).map((c) => c.id));
    } catch (err) {
      if (err instanceof Error) {
        setCoursesError(err.message);
      } else {
        setCoursesError('Unknown error loading courses');
      }
    } finally {
      setCoursesLoading(false);
    }
  };

  const handleFetchAssignments = async () => {
    try {
      setCanvasSyncing(true);
      setCanvasError(null);
      setCanvasResult(null);

      const res = await fetch(`${API_BASE_URL}/api/canvas/fetch-assignments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          daysAhead: detectionSettings.daysAhead,
          includeNoDueDate: detectionSettings.includeNoDueDate,
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || 'Request failed with status ' + res.status);
      }

      const body = (await res.json()) as {
        message?: string;
        coursesProcessed?: number;
        assignmentsUpserted?: number;
      };

      const text =
        'Processed ' +
        (body.coursesProcessed ?? 0) +
        ' courses and upserted ' +
        (body.assignmentsUpserted ?? 0) +
        ' assignments.';
      setCanvasResult(body.message ?? text);

      await loadAssignments();
      await loadCourses();
    } catch (err) {
      if (err instanceof Error) {
        setCanvasError(err.message);
      } else {
        setCanvasError('Unknown error fetching assignments');
      }
    } finally {
      setCanvasSyncing(false);
    }
  };

  const handleSaveTodoistConfig = async () => {
    try {
      setTodoistSaving(true);
      setTodoistError(null);
       const res = await fetch(`${API_BASE_URL}/api/todoist/config`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ accessToken: todoistToken }),
      });

      const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };

      if (!res.ok) {
        throw new Error(body.error || 'Request failed with status ' + res.status);
      }

      setTodoistResult(body.message ?? 'Todoist configuration saved.');
    } catch (err) {
      if (err instanceof Error) {
        setTodoistError(err.message);
      } else {
        setTodoistError('Unknown error saving Todoist configuration');
      }
    } finally {
      setTodoistSaving(false);
    }
  };

  const handleLoadTodoistProjects = async () => {
    try {
      setTodoistProjectsLoading(true);
      setTodoistError(null);
       const res = await fetch(`${API_BASE_URL}/api/todoist/projects`, {
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || 'Request failed with status ' + res.status);
      }

      const body = (await res.json()) as { projects?: TodoistProject[] };
      const projects = body.projects ?? [];
      setTodoistProjects(projects);
      if (projects.length > 0) {
        setTodoistResult(`Loaded ${projects.length} project${projects.length === 1 ? '' : 's'}.`);
      }

      if (courses.length === 0) {
        await loadCourses();
      }
    } catch (err) {
      if (err instanceof Error) {
        setTodoistError(err.message);
      } else {
        setTodoistError('Unknown error loading Todoist projects');
      }
    } finally {
      setTodoistProjectsLoading(false);
    }
  };

  const handleUpdateCourseProject = async (courseId: string, todoistProjectId: string | null) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/courses/map-project`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ courseId, todoistProjectId }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || 'Request failed with status ' + res.status);
      }

      const body = (await res.json()) as UiCourse;
      setCourses((prev) => prev.map((c) => (c.id === courseId ? body : c)));

      setSyncSelectedCourseIds((prev) => {
        if (body.todoistProjectId) {
          return prev.indexOf(body.id) >= 0 ? prev : prev.concat(body.id);
        }
        return prev.filter((id) => id !== body.id);
      });
    } catch (err) {
      if (err instanceof Error) {
        setCoursesError(err.message);
      } else {
        setCoursesError('Unknown error updating course mapping');
      }
    }
  };

  const handleToggleCourseForSync = (courseId: string, checked: boolean) => {
    setSyncSelectedCourseIds((prev) => {
      if (checked) {
        return prev.indexOf(courseId) >= 0 ? prev : prev.concat(courseId);
      }
      return prev.filter((id) => id !== courseId);
    });
  };

  const handleSyncToTodoist = async () => {
    try {
      setSyncLoading(true);
      setSyncError(null);
      setSyncResult(null);

      const res = await fetch(`${API_BASE_URL}/api/todoist/sync-assignments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ courseIds: syncSelectedCourseIds, prioritySettings }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || 'Request failed with status ' + res.status);
      }

      const body = (await res.json()) as { message?: string; created?: number; updated?: number; skipped?: number };
      const text =
        'Created ' +
        (body.created ?? 0) +
        ', updated ' +
        (body.updated ?? 0) +
        ' Todoist tasks, skipped ' +
        (body.skipped ?? 0) +
        ' (already synced or missing project).';
      setSyncResult(body.message ?? text);

      await loadAssignments();
      await loadSyncRuns();
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Unknown error syncing to Todoist');
    } finally {
      setSyncLoading(false);
    }
  };

  const handleSaveAutoSync = async (enabled: boolean, intervalMinutes: number) => {
    try {
      setAutoSyncSaving(true);
      const res = await fetch(`${API_BASE_URL}/api/auto-sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ enabled, intervalMinutes }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || 'Request failed with status ' + res.status);
      }

      const body = (await res.json()) as { enabled: boolean; intervalMinutes: number };
      setAutoSyncEnabled(body.enabled);
      setAutoSyncIntervalMinutes(body.intervalMinutes);
      setBackendStatus((prev) =>
        prev
          ? {
              ...prev,
              autoSyncEnabled: body.enabled,
              autoSyncIntervalMinutes: body.intervalMinutes,
            }
          : prev,
      );
    } catch (err) {
      if (err instanceof Error) {
        setMessage('Auto-sync error: ' + err.message);
      } else {
        setMessage('Auto-sync error: unknown error');
      }
    } finally {
      setAutoSyncSaving(false);
    }
  };

  // Mirror backend logic: compute a conceptual bucket (p1–p4), then adjust for disabled buckets
  // so the label matches the actual priority that will be used during sync.
  const formatPriorityLabel = (a: UiAssignment): { label: string; className: string } => {
    const buckets: PriorityKey[] = ['p1', 'p2', 'p3', 'p4'];

    const clampAndBucket = (diffDays: number): PriorityKey => {
      if (diffDays <= 0) return 'p1';
      const day: DayOption = clampDay(diffDays > 5 ? 5 : diffDays);
      const cuts = {
        p1: prioritySettings.p1.to,
        p2: prioritySettings.p2.to,
        p3: prioritySettings.p3.to,
      };
      if (day <= cuts.p1) return 'p1';
      if (day <= cuts.p2) return 'p2';
      if (day <= cuts.p3) return 'p3';
      return 'p4';
    };

    const adjustForEnabled = (bucket: PriorityKey): PriorityKey => {
      const idx = buckets.indexOf(bucket);
      // Search upward in urgency (toward p1), then downward.
      for (let i = idx; i >= 0; i -= 1) {
        const key = buckets[i];
        if (prioritySettings[key].enabled) return key;
      }
      for (let i = idx + 1; i < buckets.length; i += 1) {
        const key = buckets[i];
        if (prioritySettings[key].enabled) return key;
      }
      return bucket;
    };

    // No due date: treat as conceptual P4, then adjust based on enabled flags.
    if (!a.dueDate) {
      const effective = adjustForEnabled('p4');
      switch (effective) {
        case 'p1':
          return { label: 'P1', className: 'priority-p1' };
        case 'p2':
          return { label: 'P2', className: 'priority-p2' };
        case 'p3':
          return { label: 'P3', className: 'priority-p3' };
        case 'p4':
        default:
          return { label: 'P4', className: 'priority-p3' };
      }
    }

    const today = new Date();
    const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const due = new Date(a.dueDate);
    const dueMidnight = new Date(due.getFullYear(), due.getMonth(), due.getDate());
    const diffMs = dueMidnight.getTime() - todayMidnight.getTime();
    const rawDiffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

    const conceptual = clampAndBucket(rawDiffDays);
    const effective = adjustForEnabled(conceptual);

    switch (effective) {
      case 'p1':
        return { label: 'P1', className: 'priority-p1' };
      case 'p2':
        return { label: 'P2', className: 'priority-p2' };
      case 'p3':
        return { label: 'P3', className: 'priority-p3' };
      case 'p4':
      default:
        return { label: 'P4', className: 'priority-p3' };
    }
  };

  const loadSyncRuns = async () => {
    try {
      setSyncRunsLoading(true);
      setSyncRunsError(null);

      const res = await fetch(`${API_BASE_URL}/api/sync-runs`, {
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || 'Request failed with status ' + res.status);
      }

      const body = (await res.json()) as { runs?: UiSyncRun[] };
      setSyncRuns(body.runs ?? []);
    } catch (err) {
      if (err instanceof Error) {
        setSyncRunsError(err.message);
      } else {
        setSyncRunsError('Unknown error loading sync history');
      }
    } finally {
      setSyncRunsLoading(false);
    }
  };

  const handleChangeThemeMode = (mode: 'light' | 'dark' | 'system') => {
    setThemeMode(mode);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('tasklink-theme', mode);
    }
  };

  const persistPrioritySettings = (next: PrioritySettings) => {
    const normalized = normalizePriorityCuts(next);
    setPrioritySettings(normalized);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('tasklink-priority-settings', JSON.stringify(normalized));
    }
  };

  const persistDetectionSettings = (next: DetectionSettings) => {
    setDetectionSettings(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('tasklink-detection-settings', JSON.stringify(next));
    }
  };

  const effectiveTheme: 'light' | 'dark' =
    themeMode === 'system' ? (systemPrefersDark ? 'dark' : 'light') : themeMode;

  const handleSubmitAuth = async () => {
    try {
      setAuthLoading(true);
      setAuthError(null);

      const email = authEmail.trim();
      const password = authPassword;
      if (!email || !password) {
        setAuthError('Email and password are required.');
        return;
      }

      const endpoint = authMode === 'login' ? '/auth/login' : '/auth/register';
      const res = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ email, password, remember: rememberMe }),
      });

      const body = (await res.json().catch(() => ({}))) as { error?: string; user?: { email?: string | null } };

      if (!res.ok) {
        throw new Error(body.error || 'Authentication failed');
      }

      setAuthState('authenticated');
      setCurrentUser({ email: body.user?.email ?? email });
      setAuthPassword('');
    } catch (err) {
      if (err instanceof Error) {
        setAuthError(err.message);
      } else {
        setAuthError('Unknown authentication error');
      }
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch(`${API_BASE_URL}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // ignore
    }
    setAuthState('unauthenticated');
    setCurrentUser(null);
  };

  const renderHelpContent = (topic: HelpTopic) => {
    if (topic === 'canvasConfig') {
      return (
        <div>
          <p>
            Canvas configuration is used to securely connect to your school&apos;s Canvas instance. The base URL should
            match what you see in your browser (including your school subdomain), and the personal access token is only
            stored locally in Tasklink&apos;s database.
          </p>
          <p>
            Tasklink uses this connection to fetch upcoming assignments; it never modifies anything inside Canvas.
          </p>
        </div>
      );
    }
    if (topic === 'todoistConfig') {
      return (
        <div>
          <p>
            Todoist configuration lets Tasklink create and update tasks in your account. The personal API token is used
            to read your projects and create assignment tasks in the project you choose for each course.
          </p>
          <p>
            You can always change the mapping or priorities directly in Todoist; Tasklink will only adjust priorities and
            recreate missing tasks for upcoming assignments.
          </p>
        </div>
      );
    }
    if (topic === 'autoSync') {
      return (
        <div>
          <p>
            Auto-sync periodically pulls new assignments from Canvas and syncs mapped courses to Todoist in the
            background, using the frequency you choose.
          </p>
          <p>
            If you turn auto-sync off, nothing runs in the background—manual syncs from the main page will still work the
            same way.
          </p>
        </div>
      );
    }
    // assignments
    return (
      <div>
        <p>
          The assignments table shows everything Tasklink has stored from Canvas, along with sync status and priority.
          Dates may shift from late-night Canvas times (for example 1–3am) back to the previous day so they line up with
          how you think about due dates.
        </p>
        <p>
          Priorities follow the ranges you&apos;ve configured on the Settings page, and update automatically as due dates get
          closer.
        </p>
      </div>
    );
  };

  // Derive simple onboarding checklist state for the authenticated view.
  const canvasStepDone = !!backendStatus?.canvasConfigured;
  const todoistStepDone = !!backendStatus?.todoistConfigured;
  const coursesFetched = (backendStatus?.coursesCount ?? 0) > 0;
  const hasMappedCourse = courses.some((c) => c.todoistProjectId);
  const hasSyncHistory = syncRuns.length > 0;
  const allStepsDone = canvasStepDone && todoistStepDone && hasMappedCourse && hasSyncHistory;

  // If we don't yet know auth status, show a simple loading shell.
  if (authState === 'unknown') {
    return (
      <div className={"app-root " + (effectiveTheme === 'light' ? 'theme-light' : 'theme-dark')}>
        <div className="app-shell">
          <header className="app-header">
            <div>
              <div className="app-title">Tasklink</div>
              <div className="app-subtitle">Keep Canvas assignments and Todoist tasks in sync.</div>
            </div>
            <div className="badge-row">
              <span className={"badge " + (status === 'ok' ? 'badge-ok' : 'badge-warn')}>
                Backend: {status}
              </span>
            </div>
          </header>
          <section className="card">
            <div className="card-title">Loading…</div>
            <p className="status-text">Checking your session.</p>
          </section>
        </div>
      </div>
    );
  }

  // Unauthenticated landing page with email/password sign-in.
  if (authState === 'unauthenticated') {
    const isLogin = authMode === 'login';
    return (
      <div className={"app-root " + (effectiveTheme === 'light' ? 'theme-light' : 'theme-dark')}>
        <div className="app-shell">
          <header className="app-header">
            <div>
              <div className="app-title">Tasklink</div>
              <div className="app-subtitle">Keep Canvas assignments and Todoist tasks in sync.</div>
            </div>
            <div className="badge-row">
              <span className={"badge " + (status === 'ok' ? 'badge-ok' : 'badge-warn')}>
                Backend: {status}
              </span>
            </div>
          </header>

          <section className="card" style={{ maxWidth: '480px', margin: '0 auto' }}>
            <div className="card-header">
              <div className="card-title">{isLogin ? 'Sign in' : 'Create account'}</div>
            </div>
            <div className="card-description">
              {isLogin
                ? 'Sign in with your email and password to use Tasklink. Each account keeps its own Canvas and Todoist settings.'
                : 'Create a Tasklink account with your email and a password. You can then connect Canvas and Todoist for that account.'}
            </div>
            <div className="field-group">
              <label className="field-label">Email</label>
              <input
                className="input"
                type="email"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                autoComplete="email"
              />
            </div>
            <div className="field-group">
              <label className="field-label">Password</label>
              <input
                className="input"
                type="password"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                autoComplete={isLogin ? 'current-password' : 'new-password'}
              />
            </div>
            <div className="field-group">
              <label className="field-label">Session</label>
              <label style={{ fontSize: '0.85rem' }}>
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  style={{ marginRight: '0.4rem' }}
                />
                Keep me signed in on this device
              </label>
            </div>
            {authError && (
              <p className="status-text" style={{ color: '#f97373', marginTop: '0.4rem' }}>
                {authError}
              </p>
            )}
            <div className="button-row" style={{ marginTop: '0.5rem' }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSubmitAuth}
                disabled={authLoading}
              >
                {authLoading ? (isLogin ? 'Signing in…' : 'Creating account…') : isLogin ? 'Sign in' : 'Create account'}
              </button>
            </div>
            <div style={{ marginTop: '0.75rem', fontSize: '0.85rem' }}>
              {isLogin ? (
                <button
                  type="button"
                  className="link-button"
                  onClick={() => {
                    setAuthMode('register');
                    setAuthError(null);
                  }}
                >
                  New here? Create an account instead.
                </button>
              ) : (
                <button
                  type="button"
                  className="link-button"
                  onClick={() => {
                    setAuthMode('login');
                    setAuthError(null);
                  }}
                >
                  Already have an account? Sign in instead.
                </button>
              )}
            </div>
          </section>
        </div>
      </div>
    );
  }

  // Authenticated app
  return (
    <div className={"app-root " + (effectiveTheme === 'light' ? 'theme-light' : 'theme-dark')}>
      <div className="app-shell">
        <header className="app-header">
          <div>
            <div className="app-title">Tasklink</div>
            <div className="app-subtitle">Keep Canvas assignments and Todoist tasks in sync.</div>
          </div>
          <div className="badge-row">
            <span className={"badge " + (status === 'ok' ? 'badge-ok' : 'badge-warn')}>
              Backend: {status}
            </span>
            {backendStatus && (
              <>
                <span className={"badge " + (backendStatus.canvasConfigured ? 'badge-ok' : 'badge-error')}>
                  Canvas: {backendStatus.canvasConfigured ? 'Configured' : 'Not configured'}
                </span>
                <span className={"badge " + (backendStatus.todoistConfigured ? 'badge-ok' : 'badge-error')}>
                  Todoist: {backendStatus.todoistConfigured ? 'Configured' : 'Not configured'}
                </span>
              </>
            )}
            {currentUser && (
              <span className="badge badge-pill">{currentUser.email ?? 'Signed in'}</span>
            )}
            <button
              type="button"
              className="icon-button"
              onClick={() => setView('settings')}
            >
              ⚙ Settings
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={handleLogout}
            >
              Sign out
            </button>
          </div>
        </header>

        {view === 'settings' ? (
          <div className="settings-page">
            <div className="settings-header">
              <button
                type="button"
                className="icon-button"
                onClick={() => setView('main')}
              >
                ✕ Close
              </button>
              <div className="settings-title">Settings</div>
            </div>

            <section className="card">
              <div className="card-header">
                <div className="card-title">Theme</div>
              </div>
              <div className="card-description">Choose how Tasklink matches your system appearance.</div>
              <div className="theme-toggle-group">
                <button
                  type="button"
                  className={
                    'theme-toggle-button ' +
                    (themeMode === 'light' ? 'theme-toggle-button--active' : '')
                  }
                  onClick={() => handleChangeThemeMode('light')}
                >
                  Light
                </button>
                <button
                  type="button"
                  className={
                    'theme-toggle-button ' +
                    (themeMode === 'dark' ? 'theme-toggle-button--active' : '')
                  }
                  onClick={() => handleChangeThemeMode('dark')}
                >
                  Dark
                </button>
                <button
                  type="button"
                  className={
                    'theme-toggle-button ' +
                    (themeMode === 'system' ? 'theme-toggle-button--active' : '')
                  }
                  onClick={() => handleChangeThemeMode('system')}
                >
                  System
                </button>
              </div>
              <p className="status-text" style={{ marginTop: '0.4rem' }}>
                System mode follows your OS light/dark theme automatically.
              </p>
            </section>

            <section className="card">
              <div className="card-header">
                <div className="card-title">Auto-sync</div>
                <button
                  type="button"
                  className="help-icon-button"
                  onClick={() => setHelpTopic('autoSync')}
                  aria-label="Auto-sync help"
                >
                  ?
                </button>
              </div>
              <div className="card-description">
                Configure the automatic sync loop that periodically fetches from Canvas and syncs all mapped courses to
                Todoist.
              </div>
              <div className="field-group">
                <label className="field-label">Frequency</label>
                <select
                  className="select"
                  value={autoSyncEnabled ? autoSyncIntervalMinutes || 60 : 0}
                  onChange={(e) => {
                    const minutes = Number(e.target.value);
                    if (minutes <= 0) {
                      setAutoSyncEnabled(false);
                      setAutoSyncIntervalMinutes(0);
                    } else {
                      setAutoSyncEnabled(true);
                      setAutoSyncIntervalMinutes(minutes);
                    }
                  }}
                >
                  <option value={0}>Off</option>
                  <option value={15}>Every 15 minutes</option>
                  <option value={30}>Every 30 minutes</option>
                  <option value={60}>Every 60 minutes</option>
                  <option value={180}>Every 3 hours</option>
                  <option value={1440}>Every day</option>
                </select>
              </div>
              <div className="button-row">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={autoSyncSaving}
                  onClick={() => handleSaveAutoSync(autoSyncEnabled, autoSyncIntervalMinutes)}
                >
                  {autoSyncSaving ? 'Saving…' : 'Save auto-sync settings'}
                </button>
              </div>
              <p className="status-text" style={{ marginTop: '0.4rem' }}>
                Auto-sync uses all courses that have a linked Todoist project. You can still run manual syncs at any
                time.
              </p>
            </section>

            <section className="card">
              <div className="card-header">
                <div className="card-title">Assignments detection</div>
              </div>
              <div className="card-description">
                Control how far ahead Tasklink looks in Canvas and whether to include assignments with no due date.
              </div>
              <div className="field-group">
                <label className="field-label">Look ahead</label>
                <select
                  className="select"
                  value={detectionSettings.daysAhead === null ? 'all' : String(detectionSettings.daysAhead)}
                  onChange={(e) => {
                    const value = e.target.value;
                    const next: DetectionSettings = {
                      ...detectionSettings,
                      daysAhead: value === 'all' ? null : Number(value),
                    };
                    persistDetectionSettings(next);
                  }}
                >
                  <option value="30">30 days</option>
                  <option value="90">90 days</option>
                  <option value="180">180 days</option>
                  <option value="365">365 days</option>
                  <option value="all">All future</option>
                </select>
              </div>
              <div className="field-group">
                <label className="field-label">No due-date assignments</label>
                <label style={{ fontSize: '0.85rem' }}>
                  <input
                    type="checkbox"
                    checked={detectionSettings.includeNoDueDate}
                    onChange={(e) =>
                      persistDetectionSettings({
                        ...detectionSettings,
                        includeNoDueDate: e.target.checked,
                      })
                    }
                    style={{ marginRight: '0.4rem' }}
                  />
                  Include assignments with no due date
                </label>
              </div>
            </section>

            <section className="card">
              <div className="card-header">
                <div className="card-title">Priorities</div>
              </div>
              <div className="card-description">
                Configure how many days from today fall into each priority bucket, and how they map to Todoist
                priorities.
              </div>
              {(['p1', 'p2', 'p3', 'p4'] as PriorityKey[]).map((key, index) => {
                const config = prioritySettings[key];
                const label = key.toUpperCase();
                const fromDay = (() => {
                  if (key === 'p1') return 1 as DayOption;
                  if (key === 'p2') return (clampDay(prioritySettings.p1.to + 1) as DayOption);
                  if (key === 'p3') return (clampDay(prioritySettings.p2.to + 1) as DayOption);
                  return (clampDay(prioritySettings.p3.to + 1) as DayOption);
                })();
                const toDay = key === 'p4' ? (5 as DayOption) : config.to;

                const handleToChange = (newTo: DayOption) => {
                  if (key === 'p4') return;
                  const next: PrioritySettings = {
                    ...prioritySettings,
                    [key]: { ...config, to: newTo },
                  } as PrioritySettings;
                  persistPrioritySettings(next);
                };

                const todoistLabelFor = (p: 1 | 2 | 3 | 4) => {
                  if (p === 4) return 'Todoist P1 (highest)';
                  if (p === 3) return 'Todoist P2';
                  if (p === 2) return 'Todoist P3';
                  return 'Todoist P4 (lowest)';
                };

                const dayOptions: DayOption[] = [1, 2, 3, 4, 5];

                return (
                  <div key={key} style={{ borderTop: index === 0 ? 'none' : '1px solid rgba(148,163,184,0.25)', paddingTop: index === 0 ? 0 : '0.6rem', marginTop: index === 0 ? 0 : '0.6rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                      <div className="field-label" style={{ fontSize: '0.8rem' }}>
                        {label}
                      </div>
                      <button
                        type="button"
                        className={
                          'priority-toggle ' +
                          (config.enabled ? 'priority-toggle--on' : 'priority-toggle--off')
                        }
                        onClick={() =>
                          persistPrioritySettings({
                            ...prioritySettings,
                            [key]: { ...config, enabled: !config.enabled },
                          } as PrioritySettings)
                        }
                      >
                        <span className="priority-toggle-thumb" />
                      </button>
                    </div>

                    <div className="field-group" style={{ marginBottom: '0.4rem' }}>
                      <label className="field-label">Range</label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <select className="select" value={fromDay} disabled>
                          {dayOptions.map((d) => (
                            <option key={d} value={d}>
                              {d === 5 ? '5+ days' : `${d} day${d === 1 ? '' : 's'}`}
                            </option>
                          ))}
                        </select>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>to</span>
                        <select
                          className="select"
                          value={toDay}
                          disabled={key === 'p4'}
                          onChange={(e) => handleToChange(clampDay(Number(e.target.value)))}
                        >
                          {dayOptions.map((d) => (
                            <option key={d} value={d}>
                              {d === 5 ? '5+ days' : `${d} day${d === 1 ? '' : 's'}`}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="field-group" style={{ marginBottom: 0 }}>
                      <label className="field-label">Maps to Todoist</label>
                      <select
                        className="select"
                        value={config.todoistPriority}
                        onChange={(e) =>
                          persistPrioritySettings({
                            ...prioritySettings,
                            [key]: {
                              ...config,
                              todoistPriority: Number(e.target.value) as 1 | 2 | 3 | 4,
                            },
                          } as PrioritySettings)
                        }
                      >
                        {[4, 3, 2, 1].map((p) => (
                          <option key={p} value={p}>
                            {todoistLabelFor(p as 1 | 2 | 3 | 4)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                );
              })}
            </section>
          </div>
        ) : (
          <div className="app-main-grid">
          <div className="app-main-column">
            <section className="card">
              <div className="card-header">
                <div className="card-title">Overview</div>
              </div>
              <div className="status-text">
                {message && <div style={{ marginBottom: '0.4rem' }}>{message}</div>}
                {backendStatus && (
                  <div className="badge-row">
                    <span className="badge badge-pill">
                      Courses: {backendStatus.coursesCount} · Assignments: {backendStatus.assignmentsCount}
                    </span>
                    <span className="badge badge-pill">
                      Auto-sync: {backendStatus.autoSyncEnabled ? backendStatus.autoSyncIntervalMinutes + ' min' : 'Off'}
                    </span>
                  </div>
                )}
              </div>
            </section>

            <section className="card">
              <div className="card-header">
                <div className="card-title">Getting started</div>
              </div>
              <div className="card-description">
                Follow these steps to get Tasklink fully set up. You can always revisit them later.
              </div>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                <li style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.25rem' }}>
                  <span style={{ fontSize: '0.9rem' }}>{canvasStepDone ? '✅' : '⬜'}</span>
                  <span>Connect Canvas (save your Canvas base URL and token).</span>
                </li>
                <li style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.25rem' }}>
                  <span style={{ fontSize: '0.9rem' }}>{todoistStepDone ? '✅' : '⬜'}</span>
                  <span>Connect Todoist (save your Todoist API token).</span>
                </li>
                <li style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.25rem' }}>
                  <span style={{ fontSize: '0.9rem' }}>{coursesFetched ? '✅' : '⬜'}</span>
                  <span>Fetch assignments from Canvas at least once.</span>
                </li>
                <li style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.25rem' }}>
                  <span style={{ fontSize: '0.9rem' }}>{hasMappedCourse ? '✅' : '⬜'}</span>
                  <span>Map at least one Canvas course to a Todoist project.</span>
                </li>
                <li style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span style={{ fontSize: '0.9rem' }}>{hasSyncHistory ? '✅' : '⬜'}</span>
                  <span>Run your first sync to Todoist.</span>
                </li>
              </ul>
              {allStepsDone && (
                <p className="status-text" style={{ marginTop: '0.5rem' }}>
                  All set! You can tweak priorities, auto-sync, and detection settings any time.
                </p>
              )}
            </section>

            <section className="card">
              <div className="card-header">
                <div className="card-title">Canvas configuration</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <button
                    type="button"
                    className="help-icon-button"
                    onClick={() => setHelpTopic('canvasConfig')}
                    aria-label="Canvas configuration help"
                  >
                    ?
                  </button>
                  {backendStatus?.canvasConfigured && <span className="badge badge-ok">Configured</span>}
                </div>
              </div>
              <div className="card-description">
                Enter your Canvas base URL and personal access token. These are stored in your local SQLite database and
                used only from this backend.
              </div>
              <div className="field-group">
                <label className="field-label">Canvas base URL</label>
                <input
                  className="input"
                  type="text"
                  value={canvasBaseUrl}
                  onChange={(e) => setCanvasBaseUrl(e.target.value)}
                />
              </div>
              <div className="field-group">
                <label className="field-label">Canvas personal access token</label>
                <input
                  className="input"
                  type="password"
                  value={canvasToken}
                  onChange={(e) => setCanvasToken(e.target.value)}
                />
              </div>
              <div className="button-row">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleSaveCanvasConfig}
                  disabled={canvasSaving || !canvasToken}
                >
                  {canvasSaving ? 'Saving…' : 'Save config'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={handleFetchAssignments}
                  disabled={canvasSyncing}
                >
                  {canvasSyncing ? 'Fetching…' : 'Fetch upcoming assignments'}
                </button>
              </div>
              {canvasResult && (
                <p className="status-text" style={{ color: '#4ade80', marginTop: '0.4rem' }}>
                  {canvasResult}
                </p>
              )}
              {canvasError && (
                <p className="status-text" style={{ color: '#f97373', marginTop: '0.4rem' }}>
                  {canvasError}
                </p>
              )}
            </section>

            <section className="card">
              <div className="card-header">
                <div className="card-title">Todoist configuration</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <button
                    type="button"
                    className="help-icon-button"
                    onClick={() => setHelpTopic('todoistConfig')}
                    aria-label="Todoist configuration help"
                  >
                    ?
                  </button>
                  {backendStatus?.todoistConfigured && <span className="badge badge-ok">Configured</span>}
                </div>
              </div>
              <div className="card-description">
                Enter your Todoist personal API token so Tasklink can read your projects and create tasks.
              </div>
              <div className="field-group">
                <label className="field-label">Todoist personal API token</label>
                <input
                  className="input"
                  type="password"
                  value={todoistToken}
                  onChange={(e) => setTodoistToken(e.target.value)}
                />
              </div>
            <div className="button-row">
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSaveTodoistConfig}
                disabled={todoistSaving || !todoistToken}
              >
                {todoistSaving ? 'Saving…' : 'Save config'}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={handleLoadTodoistProjects}
                disabled={todoistProjectsLoading}
              >
                {todoistProjectsLoading ? 'Loading…' : 'Load projects'}
              </button>
            </div>
            {todoistResult && (
              <p className="status-text" style={{ color: '#4ade80', marginTop: '0.4rem' }}>
                {todoistResult}
              </p>
            )}
            {todoistError && (
              <p className="status-text" style={{ color: '#f97373', marginTop: '0.4rem' }}>
                {todoistError}
              </p>
            )}
            {todoistProjects.length > 0 && (
              <div style={{ marginTop: '0.9rem' }}>
                  <div className="field-label" style={{ marginBottom: '0.25rem' }}>
                    Todoist projects
                  </div>
                  <div className="project-list">
                    {todoistProjects.map((p) => (
                      <span key={p.id} className="project-pill">
                        {p.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </section>

            <section className="card">
              <div className="card-header">
                <div className="card-title">Sync to Todoist</div>
              </div>
              <div className="card-description">
                Select which mapped courses to sync. Only courses with a linked Todoist project appear here.
              </div>
              {syncError && (
                <p className="status-text" style={{ color: '#f97373' }}>{syncError}</p>
              )}
              {syncResult && (
                <p className="status-text" style={{ color: '#4ade80' }}>{syncResult}</p>
              )}
              {courses.filter((c) => c.todoistProjectId).length === 0 && (
                <p className="status-text">No courses have a linked Todoist project yet.</p>
              )}
              {courses.filter((c) => c.todoistProjectId).length > 0 && (
                <div style={{ marginTop: '0.75rem' }}>
                  <div style={{ marginBottom: '0.5rem', fontSize: '0.8rem' }}>
                    {courses
                      .filter((c) => c.todoistProjectId)
                      .map((c) => (
                        <label key={c.id} style={{ display: 'block', marginBottom: '0.25rem' }}>
                          <input
                            type="checkbox"
                            checked={syncSelectedCourseIds.indexOf(c.id) >= 0}
                            onChange={(e) => handleToggleCourseForSync(c.id, e.target.checked)}
                            style={{ marginRight: '0.4rem' }}
                          />
                          {c.name}
                        </label>
                      ))}
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleSyncToTodoist}
                    disabled={syncLoading || syncSelectedCourseIds.length === 0}
                  >
                    {syncLoading ? 'Syncing…' : 'Sync selected courses'}
                  </button>
                </div>
              )}
            </section>

          </div>

          <div className="app-side-column">
            <section className="card">
              <div className="card-header">
                <div className="card-title">Assignments</div>
                <button
                  type="button"
                  className="help-icon-button"
                  onClick={() => setHelpTopic('assignments')}
                  aria-label="Assignments help"
                >
                  ?
                </button>
              </div>
              <div className="card-description">
                Preview assignments currently stored in Tasklink after fetching from Canvas.
              </div>
              <div className="card-description">
                For each Canvas course, optionally choose a Todoist project. Courses without a selected project will not
                sync tasks. Todoist projects that you never choose here are left untouched.
              </div>
              <div className="button-row">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    void (async () => {
                      await loadCourses();
                      if (todoistProjects.length === 0) {
                        await handleLoadTodoistProjects();
                      }
                    })();
                  }}
                  disabled={coursesLoading}
                >
                  {coursesLoading ? 'Loading…' : 'Reload courses'}
                </button>
              </div>
              {coursesError && (
                <p className="status-text" style={{ color: '#f97373', marginTop: '0.4rem' }}>
                  {coursesError}
                </p>
              )}
              {courses.length === 0 && !coursesLoading && !coursesError && (
                <p className="status-text" style={{ marginTop: '0.75rem' }}>
                  No courses found yet. Try fetching from Canvas first.
                </p>
              )}
              {courses.length > 0 && (
                <table className="table" style={{ marginTop: '0.75rem' }}>
                  <thead>
                    <tr>
                      <th>Course</th>
                      <th>Linked Todoist project</th>
                    </tr>
                  </thead>
                  <tbody>
                    {courses.map((c) => (
                      <tr key={c.id}>
                        <td>{c.name}</td>
                        <td>
                          <select
                            className="select"
                            value={c.todoistProjectId ?? ''}
                            onChange={(e) =>
                              void handleUpdateCourseProject(c.id, e.target.value === '' ? null : e.target.value)
                            }
                          >
                            <option value="">No project (do not sync)</option>
                            {todoistProjects.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section className="card">
              <div className="card-header">
                <div className="card-title">Sync history</div>
              </div>
              <div className="card-description">Recent syncs with Todoist (manual or auto-sync).</div>
              <div className="button-row">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={loadSyncRuns}
                  disabled={syncRunsLoading}
                >
                  {syncRunsLoading ? 'Refreshing…' : 'Refresh history'}
                </button>
              </div>
              {syncRunsError && (
                <p className="status-text" style={{ color: '#f97373', marginTop: '0.4rem' }}>
                  {syncRunsError}
                </p>
              )}
              {syncRuns.length === 0 && !syncRunsLoading && !syncRunsError && (
                <p className="status-text" style={{ marginTop: '0.75rem' }}>
                  No syncs recorded yet. Try running a manual sync first.
                </p>
              )}
              {syncRuns.length > 0 && (
                <table className="table" style={{ marginTop: '0.75rem' }}>
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Status</th>
                      <th>Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {syncRuns.map((run) => {
                      const statusClass =
                        run.status === 'SUCCESS'
                          ? 'tag-success'
                          : run.status === 'ERROR'
                          ? 'tag-error'
                          : 'tag-running';
                      return (
                        <tr key={run.id}>
                          <td>{new Date(run.startedAt).toLocaleString()}</td>
                          <td>
                            <span className={'tag ' + statusClass}>{run.status}</span>
                          </td>
                          <td>{run.message ?? '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </section>

            <section className="card">
              <div className="card-description">
                Preview assignments currently stored in Tasklink after fetching from Canvas.
              </div>
              <div className="button-row">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={loadAssignments}
                  disabled={assignmentsLoading}
                >
                  {assignmentsLoading ? 'Loading…' : 'Reload assignments'}
                </button>
              </div>
              {assignmentsError && (
                <p className="status-text" style={{ color: '#f97373', marginTop: '0.4rem' }}>
                  {assignmentsError}
                </p>
              )}
              {assignments.length === 0 && !assignmentsLoading && !assignmentsError && (
                <p className="status-text" style={{ marginTop: '0.75rem' }}>
                  No assignments found yet. Try fetching from Canvas first.
                </p>
              )}
              {assignments.length > 0 && (
                <table className="table" style={{ marginTop: '0.75rem' }}>
                  <thead>
                    <tr>
                      <th>Course</th>
                      <th>Assignment</th>
                      <th>Due date</th>
                      <th>Sync</th>
                      <th>Priority</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assignments.map((a) => {
                      const priority = formatPriorityLabel(a);
                      return (
                        <tr key={a.id}>
                          <td>{a.courseName}</td>
                          <td>{a.name}</td>
                          <td>{a.dueDate ? new Date(a.dueDate).toLocaleDateString() : 'No due date'}</td>
                          <td>
                            <span className={'tag ' + (a.synced ? 'tag-synced' : 'tag-unsynced')}>
                              {a.synced ? 'Synced' : 'Not synced'}
                            </span>
                          </td>
                          <td>
                            <span className={'priority-pill ' + priority.className}>{priority.label}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </section>
          </div>
        </div>
        )}
        {helpTopic && (
          <div className="help-modal-backdrop" onClick={() => setHelpTopic(null)}>
            <div
              className="help-modal"
              onClick={(e) => {
                e.stopPropagation();
              }}
            >
              <div className="help-modal-header">
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => setHelpTopic(null)}
                >
                  ✕ Close
                </button>
                <div className="help-modal-title">Help</div>
              </div>
              <div className="help-modal-body">{renderHelpContent(helpTopic)}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
