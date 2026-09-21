import { create } from "zustand";
import type {
  AppSettings,
  ChatMessage,
  HistoryEntry,
  MeshParams,
  ProjectRecord,
  ViewMode,
} from "@/types";

// ---------------------------------------------------------------------------
// History stack entry (for undo/redo)
// ---------------------------------------------------------------------------

interface HistoryStackEntry {
  image: string | null;
  prompt: string;
  negativePrompt: string;
  meshParams: MeshParams;
  viewMode: ViewMode;
}

// ---------------------------------------------------------------------------
// Store state
// ---------------------------------------------------------------------------

interface AppState {
  // API status
  apiConnected: boolean;
  dbConnected: boolean;
  geminiConnected: boolean;

  // Current project
  projectId: string | null;
  projectName: string;
  prompt: string;
  negativePrompt: string;

  // Generated image
  image: string | null;
  isGenerating: boolean;
  generateProgress: number;
  generateError: string | null;
  lastElapsedMs: number;

  // Mesh / GLB
  meshParams: MeshParams;
  glbId: string | null;
  isMeshGenerating: boolean;
  meshError: string | null;
  meshInfo: { vertices: number; faces: number; elapsed_ms: number } | null;

  // View
  viewMode: ViewMode;
  zoom: number;

  // Settings
  settings: AppSettings;
  settingsOpen: boolean;

  // Panels
  assistantOpen: boolean;
  historyOpen: boolean;
  projectsOpen: boolean;

  // History
  historyEntries: HistoryEntry[];
  undoStack: HistoryStackEntry[];
  redoStack: HistoryStackEntry[];

  // Chat
  chatMessages: ChatMessage[];
  isChatting: boolean;

  // Projects list
  projects: ProjectRecord[];

  // Actions
  setApiStatus: (connected: boolean, db: boolean, gemini: boolean) => void;
  setProjectId: (id: string | null) => void;
  setProjectName: (name: string) => void;
  setPrompt: (prompt: string) => void;
  setNegativePrompt: (np: string) => void;
  setImage: (img: string | null) => void;
  setGenerating: (v: boolean) => void;
  setGenerateProgress: (v: number) => void;
  setGenerateError: (e: string | null) => void;
  setLastElapsed: (ms: number) => void;
  setMeshParams: (p: Partial<MeshParams>) => void;
  setGlbId: (id: string | null) => void;
  setMeshGenerating: (v: boolean) => void;
  setMeshError: (e: string | null) => void;
  setMeshInfo: (info: { vertices: number; faces: number; elapsed_ms: number } | null) => void;
  setViewMode: (m: ViewMode) => void;
  setZoom: (z: number) => void;
  setSettings: (s: Partial<AppSettings>) => void;
  setSettingsOpen: (v: boolean) => void;
  setAssistantOpen: (v: boolean) => void;
  setHistoryOpen: (v: boolean) => void;
  setProjectsOpen: (v: boolean) => void;
  setHistoryEntries: (entries: HistoryEntry[]) => void;
  setProjects: (projects: ProjectRecord[]) => void;
  setChatMessages: (msgs: ChatMessage[]) => void;
  addChatMessage: (msg: ChatMessage) => void;
  setIsChatting: (v: boolean) => void;

  // Undo/redo
  pushUndo: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // New project
  newProject: () => void;
}

const defaultMeshParams: MeshParams = {
  subdivisions: 128,
  height_scale: 0.3,
  smooth: true,
};

const defaultSettings: AppSettings = {
  backend: "gemini",
  model: "gemini-3.1-flash-image",
  subdivisions: 128,
  height_scale: 0.3,
  smooth: true,
  allow_adult_art: true,
  safety_mode: "standard",
};

export const useStore = create<AppState>((set, get) => ({
  // API
  apiConnected: false,
  dbConnected: false,
  geminiConnected: false,

  // Project
  projectId: null,
  projectName: "Untitled",
  prompt: "",
  negativePrompt: "",

  // Image
  image: null,
  isGenerating: false,
  generateProgress: 0,
  generateError: null,
  lastElapsedMs: 0,

  // Mesh
  meshParams: defaultMeshParams,
  glbId: null,
  isMeshGenerating: false,
  meshError: null,
  meshInfo: null,

  // View
  viewMode: "2d",
  zoom: 1,

  // Settings
  settings: defaultSettings,
  settingsOpen: false,

  // Panels
  assistantOpen: false,
  historyOpen: false,
  projectsOpen: false,

  // History
  historyEntries: [],
  undoStack: [],
  redoStack: [],

  // Chat
  chatMessages: [],
  isChatting: false,

  // Projects
  projects: [],

  // Actions
  setApiStatus: (connected, db, gemini) =>
    set({ apiConnected: connected, dbConnected: db, geminiConnected: gemini }),
  setProjectId: (id) => set({ projectId: id }),
  setProjectName: (name) => set({ projectName: name }),
  setPrompt: (prompt) => set({ prompt }),
  setNegativePrompt: (negativePrompt) => set({ negativePrompt }),
  setImage: (image) => set({ image }),
  setGenerating: (isGenerating) => set({ isGenerating }),
  setGenerateProgress: (generateProgress) => set({ generateProgress }),
  setGenerateError: (generateError) => set({ generateError }),
  setLastElapsed: (lastElapsedMs) => set({ lastElapsedMs }),
  setMeshParams: (p) => set((s) => ({ meshParams: { ...s.meshParams, ...p } })),
  setGlbId: (glbId) => set({ glbId }),
  setMeshGenerating: (isMeshGenerating) => set({ isMeshGenerating }),
  setMeshError: (meshError) => set({ meshError }),
  setMeshInfo: (meshInfo) => set({ meshInfo }),
  setViewMode: (viewMode) => set({ viewMode }),
  setZoom: (zoom) => set({ zoom }),
  setSettings: (s) => set((state) => ({ settings: { ...state.settings, ...s } })),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setAssistantOpen: (assistantOpen) => set({ assistantOpen }),
  setHistoryOpen: (historyOpen) => set({ historyOpen }),
  setProjectsOpen: (projectsOpen) => set({ projectsOpen }),
  setHistoryEntries: (historyEntries) => set({ historyEntries }),
  setProjects: (projects) => set({ projects }),
  setChatMessages: (chatMessages) => set({ chatMessages }),
  addChatMessage: (msg) => set((s) => ({ chatMessages: [...s.chatMessages, msg] })),
  setIsChatting: (isChatting) => set({ isChatting }),

  // Undo/redo
  pushUndo: () => {
    const s = get();
    const entry: HistoryStackEntry = {
      image: s.image,
      prompt: s.prompt,
      negativePrompt: s.negativePrompt,
      meshParams: { ...s.meshParams },
      viewMode: s.viewMode,
    };
    set({ undoStack: [...s.undoStack, entry], redoStack: [] });
  },

  undo: () => {
    const s = get();
    if (s.undoStack.length === 0) return;
    const current: HistoryStackEntry = {
      image: s.image,
      prompt: s.prompt,
      negativePrompt: s.negativePrompt,
      meshParams: { ...s.meshParams },
      viewMode: s.viewMode,
    };
    const prev = s.undoStack[s.undoStack.length - 1];
    set({
      image: prev.image,
      prompt: prev.prompt,
      negativePrompt: prev.negativePrompt,
      meshParams: prev.meshParams,
      viewMode: prev.viewMode,
      undoStack: s.undoStack.slice(0, -1),
      redoStack: [...s.redoStack, current],
    });
  },

  redo: () => {
    const s = get();
    if (s.redoStack.length === 0) return;
    const current: HistoryStackEntry = {
      image: s.image,
      prompt: s.prompt,
      negativePrompt: s.negativePrompt,
      meshParams: { ...s.meshParams },
      viewMode: s.viewMode,
    };
    const next = s.redoStack[s.redoStack.length - 1];
    set({
      image: next.image,
      prompt: next.prompt,
      negativePrompt: next.negativePrompt,
      meshParams: next.meshParams,
      viewMode: next.viewMode,
      undoStack: [...s.undoStack, current],
      redoStack: s.redoStack.slice(0, -1),
    });
  },

  canUndo: () => get().undoStack.length > 0,
  canRedo: () => get().redoStack.length > 0,

  newProject: () => {
    const s = get();
    s.pushUndo();
    set({
      projectId: null,
      projectName: "Untitled",
      prompt: "",
      negativePrompt: "",
      image: null,
      glbId: null,
      meshInfo: null,
      meshError: null,
      generateError: null,
      historyEntries: [],
      undoStack: [],
      redoStack: [],
      viewMode: "2d",
      zoom: 1,
    });
  },
}));

export { defaultMeshParams, defaultSettings };
