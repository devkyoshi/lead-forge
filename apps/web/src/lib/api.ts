const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(`${BASE}/api/v1${path}`, {
    credentials: "include",
    ...rest,
    headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? res.statusText);
  return data as T;
}

export interface Me {
  id: string;
  email: string;
  name: string;
  workspaceId: string;
}

export interface Lead {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  category: string | null;
  area: string | null;
  rating: number | null;
  reviewCount: number | null;
  websiteUrl: string | null;
  websiteStatus: string;
  websiteScore: number | null;
  status: string;
  score: number;
  tags: string[];
  createdAt: string;
  contacts?: { value: string }[];
  needsManualOutreach?: boolean;
}

export interface LeadDetail extends Lead {
  scoreBreakdown: { key: string; label: string; points: number; max: number; detail: string }[] | null;
  audits: { websiteStatus: string; websiteScore: number | null; issues: { code: string; message: string }[]; fetchedAt: string }[];
  checklist: { id: string; key: string; label: string; done: boolean }[];
  history: { id: string; fromStatus: string | null; toStatus: string; actor: string; reason: string | null; createdAt: string }[];
  notes: { id: string; body: string; createdAt: string }[];
}

export interface StageLog {
  id: string;
  stage: string;
  status: string;
  counts: Record<string, number>;
  logs: string[];
  error: string | null;
}

export interface Run {
  id: string;
  status: string;
  trigger: string;
  currentStage: string | null;
  counts: Record<string, number>;
  error: string | null;
  createdAt: string;
  stages?: StageLog[];
  campaign?: { id: string; name: string };
}

export interface Campaign {
  id: string;
  name: string;
  status: string;
  categories: string[];
  area: { type: string; label: string };
  approvalMode: string;
  dailySendLimit: number;
  runs: Run[];
  _count: { leads: number };
}
