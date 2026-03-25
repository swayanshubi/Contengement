// Scene status
export const SCENE_STATUSES = ["planned", "scripted", "shot", "edited", "published"] as const;
export type SceneStatus = (typeof SCENE_STATUSES)[number];

// Shot types
export const SHOT_TYPES = ["a-roll", "b-roll", "screen-share", "animation"] as const;
export type ShotType = (typeof SHOT_TYPES)[number];

// Storyboard overlays
export const OVERLAY_SLOT_TYPES = ["broll", "text", "graphic"] as const;
export type OverlaySlotType = (typeof OVERLAY_SLOT_TYPES)[number];

// Asset types
export const ASSET_TYPES = ["footage", "reference", "audio", "graphic", "overlay"] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

// Project status
export const PROJECT_STATUSES = ["draft", "production", "completed", "archived"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

// Storyboard frame aspect
export const STORYBOARD_ASPECTS = ["16:9", "9:16"] as const;
export type StoryboardAspect = (typeof STORYBOARD_ASPECTS)[number];

// Storyboard planning mode
export const STORYBOARD_MODES = ["text", "image", "audio", "hybrid"] as const;
export type StoryboardMode = (typeof STORYBOARD_MODES)[number];

// Master script block types
export const MASTER_SCRIPT_BLOCK_TYPES = [
    "heading",
    "action",
    "character",
    "dialogue",
    "parenthetical",
    "transition",
] as const;
export type MasterScriptBlockType = (typeof MASTER_SCRIPT_BLOCK_TYPES)[number];

export const MASTER_SCRIPT_LOCATION_TYPES = ["INT", "EXT", "I/E"] as const;
export type MasterScriptLocationType = (typeof MASTER_SCRIPT_LOCATION_TYPES)[number];

// Storyboard block types
export const STORYBOARD_BLOCK_TYPES = [
    "scene",
    "hook",
    "broll",
    "transition",
    "cta",
] as const;
export type StoryboardBlockType = (typeof STORYBOARD_BLOCK_TYPES)[number];

// Drawing layout mode inside a block
export const DRAWING_LAYOUT_MODES = ["standard", "thumbnail", "custom"] as const;
export type DrawingLayoutMode = (typeof DRAWING_LAYOUT_MODES)[number];

// Entities
export interface OverlaySlot {
    id: string;
    type: OverlaySlotType;
    description: string;
    startTime: number;
    endTime: number;
    linkedAssetId?: string;
}

export interface AudioTrack {
    filePath: string;
    duration: number;
    beatMarkers: number[];
}

export interface StoryboardScriptRef {
    sceneId: string;
    startChar?: number;
    endChar?: number;
}

export interface StoryboardAudioRef {
    startSec?: number;
    endSec?: number;
    snapToBeat?: boolean;
}

export interface StoryboardShotDetails {
    camera?: string;
    lens?: string;
    movement?: string;
    framing?: string;
    angle?: string;
    lighting?: string;
    colorPalette?: string;
    location?: string;
    priority?: "must" | "nice";
}

export interface StoryboardBlock {
    id: string;
    sceneId: string;
    type: StoryboardBlockType;
    x: number;
    y: number;
    w: number;
    h: number;
    z?: number;
    layoutMode?: DrawingLayoutMode;
    scriptRef?: StoryboardScriptRef;
    visualAssetId?: string;
    audioAssetId?: string;
    audioClipPath?: string;
    drawingData?: string;
    notes?: string;
    tags?: string[];
    brollMarkers?: string[];
    durationPlanSec?: number;
    audioRef?: StoryboardAudioRef;
    shotDetails?: StoryboardShotDetails;
    shotTypePreset?: "a-roll" | "b-roll" | "animated" | "custom";
    shotTypeCustom?: string;
    category?: string;
    blockKind?: "primary" | "details";
    detailForBlockId?: string;
    isTextOnly?: boolean;
    customLayout?: {
        showVisual?: boolean;
        showText?: boolean;
        showNotes?: boolean;
    };
    sequenceIndex?: number;
    groupId?: string;
}

export interface StoryboardGroup {
    id: string;
    title: string;
    blockIds: string[];
    color?: string;
    collapsed?: boolean;
}

export interface StoryboardLink {
    id: string;
    fromBlockId: string;
    toBlockId: string;
    kind?: "sequence" | "dependency";
}

export interface StoryboardSelectionArea {
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
    title?: string;
    color?: string;
}

export interface StoryboardModule {
    version: 1;
    modePreference?: StoryboardMode;
    drawingLayoutDefault?: DrawingLayoutMode;
    gridSnap?: boolean;
    showLinks?: boolean;
    showScriptInDetails?: boolean;
    showMiniMap?: boolean;
    showTimelineStrip?: boolean;
    showSceneNumbers?: boolean;
    autoDurationFromAudioEnabled?: boolean;
    blocks?: StoryboardBlock[];
    groups?: StoryboardGroup[];
    links?: StoryboardLink[];
    selectionAreas?: StoryboardSelectionArea[];
}

export interface MasterScriptHeadingMeta {
    locationType?: MasterScriptLocationType;
    location?: string;
    timeOfDay?: string;
}

export interface MasterScriptBlock {
    id: string;
    type: MasterScriptBlockType;
    text: string;
    headingMeta?: MasterScriptHeadingMeta;
    linkedSceneId?: string;
}

export interface MasterScriptModule {
    version: 1 | 2;
    blocks?: MasterScriptBlock[]; // legacy support
    documentHtml?: string;
}

export interface Project {
    id: string;
    title: string;
    status: ProjectStatus;
    hook: string;
    targetPlatform: string;
    storyboardEnabled?: boolean;
    storyboardAspect?: StoryboardAspect;
    storyboardSafeZone?: boolean;
    storyboard?: StoryboardModule;
    masterScript?: MasterScriptModule;
    notesPad?: string;
    audioTrack?: AudioTrack;
    createdAt: string;
    updatedAt: string;
}

export interface Scene {
    id: string;
    projectId: string;
    sortOrder: number;
    title: string;
    goal: string;
    shotType: ShotType;
    estimatedDurationSec: number;
    status: SceneStatus;
    scriptBody: string;
    notes: string;
    cta: string;
    cameraDirectionNotes?: string;
    framingNotes?: string;
    overlaySlots?: OverlaySlot[];
    hookType?: string;
    hookStrength?: number;
    hookNotes?: string;
    snapToBeat?: boolean;
}

export interface Asset {
    id: string;
    projectId: string;
    type: AssetType;
    name: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    sceneIds: string[];
    createdAt: string;
}

export interface ProjectData {
    project: Project;
    scenes: Scene[];
    assets: Asset[];
}

// Helpers
export const STATUS_LABELS: Record<SceneStatus, string> = {
    planned: "Planned",
    scripted: "Scripted",
    shot: "Shot",
    edited: "Edited",
    published: "Published",
};

export const STATUS_COLORS: Record<SceneStatus, string> = {
    planned: "#71717a",
    scripted: "#f59e0b",
    shot: "#22c55e",
    edited: "#8b5cf6",
    published: "#3b82f6",
};

export const SHOT_TYPE_LABELS: Record<ShotType, string> = {
    "a-roll": "A-Roll",
    "b-roll": "B-Roll",
    "screen-share": "Screen Share",
    animation: "Animation",
};

export function formatDuration(totalSec: number): string {
    if (totalSec <= 0) return "0:00";
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
}

export function wordCount(text: string): number {
    if (!text || !text.trim()) return 0;
    return text.trim().split(/\s+/).length;
}

export function estimateDurationFromWords(words: number, wpm = 150): number {
    if (words <= 0) return 0;
    return Math.round((words / wpm) * 60);
}
