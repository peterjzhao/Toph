export type EmployeeLog = {
  id: string;
  employee: { id: string; name: string };
  activity: string;
  date: string;
  field: { id: string; name: string; mapImageUrl: string; boundary?: Array<{ x: number; y: number }> };
  startAt: string;
  endAt: string;
  summary: string;
  recording: {
    url: string; durationSeconds: number; clips?: Array<{ url: string; durationSeconds: number }>;
    /** A stored waveform image. Only the synthesized demo clip has one (the design's); others are drawn from their audio. */
    waveformAssetUrl?: string | null;
  };
  tags: string[];
  isNew: boolean;
};

export type DashboardData = {
  farm: { id: string; name: string; role: string; avatarUrl: string; timezone?: string };
  metrics: { recordingsToday: number; newRecordings: number; activeWorkers: number; responseAccuracy: number | null; asOf: string };
  logs: EmployeeLog[];
  fields?: EmployeeLog["field"][];
};
