// ---------------------------------------------------------------------------
// API status
// ---------------------------------------------------------------------------

export type ApiStatus = "checking" | "connected" | "error";

export interface HealthResponse {
  ok: boolean;
  db?: boolean;
  gemini?: boolean;
  image_backends?: Record<string, boolean>;
  mesh?: { ready: boolean; method: string; missing: string[] };
}

// ---------------------------------------------------------------------------
// Image generation
// ---------------------------------------------------------------------------

export interface GenerateRequest {
  prompt: string;
  negative_prompt?: string;
  model?: string;
  width?: number;
  height?: number;
  reference_image?: string | null;
  backend?: string;
}

export interface GenerateResponse {
  image: string;
  prompt: string;
  elapsed_ms: number;
}

// ---------------------------------------------------------------------------
// 3D mesh
// ---------------------------------------------------------------------------

export interface MeshParams {
  mesh_quality: "draft" | "balanced" | "high";
  mesh_device: "auto" | "cpu" | "cuda";
  bake_texture: boolean;
  texture_resolution: number;
}

export interface MeshResponse {
  glb_available: boolean;
  vertices: number;
  faces: number;
  elapsed_ms: number;
  glb_id: string;
  watertight: boolean;
  method: string;
  warnings: string[];
}

export interface MeshJob {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  stage: string;
  progress: number;
  error: string | null;
  result: MeshResponse | null;
  image_url: string;
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export interface ProjectRecord {
  id: string;
  name: string;
  prompt: string;
  negative_prompt: string;
  settings_json: string;
  image_data_url: string | null;
  mesh_params_json: string | null;
  glb_available: boolean;
  glb_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectSave {
  id?: string;
  name: string;
  prompt: string;
  negative_prompt: string;
  settings_json: string;
  image_data_url?: string | null;
  mesh_params_json?: string | null;
  glb_id?: string | null;
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

export interface HistoryEntry {
  id: string;
  project_id: string;
  action: string;
  prompt: string;
  image_data_url: string | null;
  settings_json: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface AppSettings extends MeshParams {
  backend: string;
  model: string;
  subdivisions: number;
  height_scale: number;
  smooth: boolean;
  allow_adult_art: boolean;
  safety_mode: string;
}

// ---------------------------------------------------------------------------
// AI Assistant chat
// ---------------------------------------------------------------------------

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface ChatRequest {
  message: string;
  context?: string;
}

export interface ChatResponse {
  reply: string;
  elapsed_ms: number;
}

// ---------------------------------------------------------------------------
// View modes
// ---------------------------------------------------------------------------

export type ViewMode = "2d" | "3d";

// ---------------------------------------------------------------------------
// Toolbar actions
// ---------------------------------------------------------------------------

export type ToolbarAction =
  | "new"
  | "open"
  | "import"
  | "save"
  | "undo"
  | "redo"
  | "2d"
  | "3d"
  | "enhance"
  | "edit"
  | "regenerate"
  | "history"
  | "zoom"
  | "export-glb"
  | "settings"
  | "assistant";
