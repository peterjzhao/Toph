export type EmployeeLog = {
  id: string;
  employee: { id: string; name: string };
  activity: string;
  date: string;
  field: { id: string; name: string; mapImageUrl: string };
  startAt: string;
  endAt: string;
  summary: string;
  recording: { url: string; durationSeconds: number; clips?: Array<{ url: string; durationSeconds: number }> };
  tags: string[];
  isNew: boolean;
};

export type DashboardData = {
  farm: { id: string; name: string; role: string; avatarUrl: string; timezone?: string };
  metrics: { recordingsToday: number; newRecordings: number; activeWorkers: number; responseAccuracy: number | null; asOf: string };
  logs: EmployeeLog[];
};
