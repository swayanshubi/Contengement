import fs from "fs";
import path from "path";
import type {
    Asset,
    AudioTrack,
    DrawingLayoutMode,
    MasterScriptBlock,
    MasterScriptBlockType,
    MasterScriptLocationType,
    MasterScriptModule,
    OverlaySlot,
    OverlaySlotType,
    Project,
    ProjectData,
    Scene,
    StoryboardAspect,
    StoryboardBlock,
    StoryboardBlockType,
    StoryboardGroup,
    StoryboardLink,
    StoryboardSelectionArea,
    StoryboardMode,
    StoryboardModule,
} from "./types";
import {
    DRAWING_LAYOUT_MODES,
    MASTER_SCRIPT_BLOCK_TYPES,
    MASTER_SCRIPT_LOCATION_TYPES,
    OVERLAY_SLOT_TYPES,
    STORYBOARD_BLOCK_TYPES,
    STORYBOARD_MODES,
} from "./types";
import { ensureStorageReady, getStorageLayout } from "./storage";

const PROJECTS_INDEX_FILE = "projects.json";
const CURRENT_PROJECT_SCHEMA_VERSION = 1;
const CURRENT_INDEX_SCHEMA_VERSION = 1;

interface DiskProjectRecordV1 {
    schemaVersion: number;
    data: ProjectData;
}

interface DiskProjectIndexV1 {
    schemaVersion: number;
    projects: Project[];
}

type JSONReadResult =
    | { kind: "missing" }
    | { kind: "ok"; value: unknown }
    | { kind: "invalid"; error: unknown };

function ensureDirs() {
    ensureStorageReady();
}

function getProjectsIndexPath(): string {
    return path.join(getStorageLayout().rootDir, PROJECTS_INDEX_FILE);
}

function getProjectFilePath(id: string): string {
    return path.join(getStorageLayout().projectsDir, `${id}.json`);
}

function readJSON(filePath: string): JSONReadResult {
    if (!fs.existsSync(filePath)) return { kind: "missing" };
    try {
        return { kind: "ok", value: JSON.parse(fs.readFileSync(filePath, "utf-8")) };
    } catch (error) {
        return { kind: "invalid", error };
    }
}

function writeJSON(filePath: string, data: unknown) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function isProjectDataShape(value: unknown): value is ProjectData {
    if (!isRecord(value)) return false;
    if (!isRecord(value.project)) return false;
    if (typeof value.project.id !== "string" || !value.project.id) return false;
    return Array.isArray(value.scenes) && Array.isArray(value.assets);
}

function isProjectSummaryShape(value: unknown): value is Project {
    return isRecord(value) && typeof value.id === "string" && value.id.length > 0;
}

function quarantineCorruptFile(filePath: string, reason: string, details?: unknown) {
    ensureDirs();
    if (!fs.existsSync(filePath)) return;

    const layout = getStorageLayout();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const base = path.basename(filePath);
    const quarantinedPath = path.join(layout.corruptDir, `${base}.${timestamp}.corrupt`);

    try {
        fs.renameSync(filePath, quarantinedPath);
    } catch {
        try {
            fs.cpSync(filePath, quarantinedPath);
            fs.unlinkSync(filePath);
        } catch {
            return;
        }
    }

    const metadataPath = `${quarantinedPath}.meta.json`;
    const metadata = {
        reason,
        sourcePath: filePath,
        quarantinedPath,
        quarantinedAt: new Date().toISOString(),
        details: details ? String(details) : undefined,
    };
    try {
        writeJSON(metadataPath, metadata);
    } catch {
        // Quarantine should never break request handling.
    }
}

function writeProjectRecord(filePath: string, data: ProjectData) {
    const envelope: DiskProjectRecordV1 = {
        schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
        data,
    };
    writeJSON(filePath, envelope);
}

function migrateProjectData(
    fromSchemaVersion: number,
    payload: unknown
): { data: ProjectData; migrated: boolean } | null {
    let version = fromSchemaVersion;
    let current = payload;
    let migrated = false;

    while (version < CURRENT_PROJECT_SCHEMA_VERSION) {
        switch (version) {
            case 0: {
                // Schema v0 stored raw ProjectData payload without an envelope.
                if (!isProjectDataShape(current)) return null;
                version = 1;
                migrated = true;
                break;
            }
            default:
                return null;
        }
    }

    if (version !== CURRENT_PROJECT_SCHEMA_VERSION) return null;
    if (!isProjectDataShape(current)) return null;
    return { data: current, migrated };
}

function decodeProjectRecord(raw: unknown): { data: ProjectData; needsRewrite: boolean } | null {
    if (isProjectDataShape(raw)) {
        // Legacy (v0) flat project file.
        return { data: raw, needsRewrite: true };
    }

    if (!isRecord(raw) || typeof raw.schemaVersion !== "number") return null;

    const schemaVersion = raw.schemaVersion;
    if (schemaVersion > CURRENT_PROJECT_SCHEMA_VERSION) return null;

    const migrated = migrateProjectData(schemaVersion, raw.data);
    if (!migrated) return null;
    return { data: migrated.data, needsRewrite: migrated.migrated };
}

function readProjectFromDisk(filePath: string): ProjectData | null {
    const readResult = readJSON(filePath);
    if (readResult.kind === "missing") return null;
    if (readResult.kind === "invalid") {
        quarantineCorruptFile(filePath, "Invalid project JSON", readResult.error);
        return null;
    }

    const decoded = decodeProjectRecord(readResult.value);
    if (!decoded) {
        quarantineCorruptFile(filePath, "Unsupported or invalid project schema");
        return null;
    }

    const normalized = normalizeProjectData(decoded.data);
    if (decoded.needsRewrite) {
        writeProjectRecord(filePath, normalized);
    }
    return normalized;
}

function writeProjectsIndex(projects: Project[]) {
    const payload: DiskProjectIndexV1 = {
        schemaVersion: CURRENT_INDEX_SCHEMA_VERSION,
        projects,
    };
    writeJSON(getProjectsIndexPath(), payload);
}

function migrateProjectIndex(
    fromSchemaVersion: number,
    payload: unknown
): { projects: Project[]; migrated: boolean } | null {
    let version = fromSchemaVersion;
    let current = payload;
    let migrated = false;

    while (version < CURRENT_INDEX_SCHEMA_VERSION) {
        switch (version) {
            case 0: {
                if (!Array.isArray(current)) return null;
                current = current.filter(isProjectSummaryShape);
                version = 1;
                migrated = true;
                break;
            }
            default:
                return null;
        }
    }

    if (version !== CURRENT_INDEX_SCHEMA_VERSION) return null;
    if (!Array.isArray(current)) return null;
    if (!current.every(isProjectSummaryShape)) return null;
    return { projects: current, migrated };
}

function decodeProjectIndex(raw: unknown): { projects: Project[]; needsRewrite: boolean } | null {
    if (Array.isArray(raw)) {
        // Legacy (v0) flat array index.
        const projects = raw.filter(isProjectSummaryShape).map((project) => normalizeProject(project));
        return { projects, needsRewrite: true };
    }

    if (!isRecord(raw) || typeof raw.schemaVersion !== "number") return null;
    if (raw.schemaVersion > CURRENT_INDEX_SCHEMA_VERSION) return null;

    const migrated = migrateProjectIndex(raw.schemaVersion, raw.projects);
    if (!migrated) return null;
    return {
        projects: migrated.projects.map((project) => normalizeProject(project)),
        needsRewrite: migrated.migrated,
    };
}

function listProjectFiles(): string[] {
    ensureDirs();
    const projectsDir = getStorageLayout().projectsDir;
    return fs
        .readdirSync(projectsDir)
        .filter((name) => name.toLowerCase().endsWith(".json"))
        .map((name) => path.join(projectsDir, name));
}

function rebuildProjectsIndexFromProjectFiles(): Project[] {
    const projects: Project[] = [];
    for (const filePath of listProjectFiles()) {
        const data = readProjectFromDisk(filePath);
        if (!data) continue;
        projects.push(normalizeProject(data.project));
    }

    writeProjectsIndex(projects);
    return projects;
}

function readProjectsIndex(): Project[] | null {
    ensureDirs();
    const indexPath = getProjectsIndexPath();
    const readResult = readJSON(indexPath);
    if (readResult.kind === "missing") return null;
    if (readResult.kind === "invalid") {
        quarantineCorruptFile(indexPath, "Invalid projects index JSON", readResult.error);
        return null;
    }

    const decoded = decodeProjectIndex(readResult.value);
    if (!decoded) {
        quarantineCorruptFile(indexPath, "Unsupported or invalid projects index schema");
        return null;
    }
    if (decoded.needsRewrite) {
        writeProjectsIndex(decoded.projects);
    }
    return decoded.projects;
}

function hasIndexDrift(projects: Project[]): boolean {
    const files = listProjectFiles();
    if (projects.length !== files.length) return true;
    return projects.some((project) => !fs.existsSync(getProjectFilePath(project.id)));
}

function removeProjectFromIndex(id: string) {
    const index = readProjectsIndex();
    if (!index) return;
    if (!index.some((p) => p.id === id)) return;
    writeProjectsIndex(index.filter((p) => p.id !== id));
}

function inferAspectFromTargetPlatform(targetPlatform: string): StoryboardAspect {
    const platform = (targetPlatform || "").toLowerCase();
    if (
        platform.includes("tiktok") ||
        platform.includes("reel") ||
        platform.includes("short") ||
        platform.includes("vertical")
    ) {
        return "9:16";
    }
    return "16:9";
}

function toStoryboardMode(value: unknown): StoryboardMode {
    if (typeof value === "string" && STORYBOARD_MODES.includes(value as StoryboardMode)) {
        return value as StoryboardMode;
    }
    return "hybrid";
}

function toStoryboardBlockType(value: unknown): StoryboardBlockType {
    if (typeof value === "string" && STORYBOARD_BLOCK_TYPES.includes(value as StoryboardBlockType)) {
        return value as StoryboardBlockType;
    }
    return "scene";
}

function toDrawingLayoutMode(value: unknown): DrawingLayoutMode {
    if (typeof value === "string" && DRAWING_LAYOUT_MODES.includes(value as DrawingLayoutMode)) {
        return value as DrawingLayoutMode;
    }
    return "standard";
}

function toMasterScriptBlockType(value: unknown): MasterScriptBlockType {
    if (typeof value === "string" && MASTER_SCRIPT_BLOCK_TYPES.includes(value as MasterScriptBlockType)) {
        return value as MasterScriptBlockType;
    }
    return "action";
}

function toMasterScriptLocationType(value: unknown): MasterScriptLocationType | undefined {
    if (typeof value === "string" && MASTER_SCRIPT_LOCATION_TYPES.includes(value as MasterScriptLocationType)) {
        return value as MasterScriptLocationType;
    }
    return undefined;
}

function sanitizeStoryboardBlock(value: unknown, idx: number): StoryboardBlock | null {
    if (!isRecord(value)) return null;
    if (typeof value.sceneId !== "string" || !value.sceneId) return null;

    const tags = Array.isArray(value.tags)
        ? value.tags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
        : [];

    const brollMarkers = Array.isArray(value.brollMarkers)
        ? value.brollMarkers.filter(
            (marker): marker is string => typeof marker === "string" && marker.trim().length > 0
        )
        : [];

    const rawAudioRef = isRecord(value.audioRef) ? value.audioRef : null;
    const startSec = rawAudioRef ? Number(rawAudioRef.startSec) : NaN;
    const endSec = rawAudioRef ? Number(rawAudioRef.endSec) : NaN;
    const audioRef =
        rawAudioRef && (Number.isFinite(startSec) || Number.isFinite(endSec) || typeof rawAudioRef.snapToBeat === "boolean")
            ? {
                startSec: Number.isFinite(startSec) ? Math.max(0, startSec) : undefined,
                endSec: Number.isFinite(endSec) ? Math.max(0, endSec) : undefined,
                snapToBeat: Boolean(rawAudioRef.snapToBeat),
            }
            : undefined;

    const rawShotDetails = isRecord(value.shotDetails) ? value.shotDetails : null;
    let priority: "must" | "nice" | undefined;
    if (rawShotDetails?.priority === "must" || rawShotDetails?.priority === "nice") {
        priority = rawShotDetails.priority;
    }
    const shotDetails = rawShotDetails
        ? {
            camera: typeof rawShotDetails.camera === "string" ? rawShotDetails.camera : undefined,
            lens: typeof rawShotDetails.lens === "string" ? rawShotDetails.lens : undefined,
            movement: typeof rawShotDetails.movement === "string" ? rawShotDetails.movement : undefined,
            framing: typeof rawShotDetails.framing === "string" ? rawShotDetails.framing : undefined,
            angle: typeof rawShotDetails.angle === "string" ? rawShotDetails.angle : undefined,
            lighting: typeof rawShotDetails.lighting === "string" ? rawShotDetails.lighting : undefined,
            colorPalette:
                typeof rawShotDetails.colorPalette === "string"
                    ? rawShotDetails.colorPalette
                    : undefined,
            location: typeof rawShotDetails.location === "string" ? rawShotDetails.location : undefined,
            priority,
        }
        : undefined;

    const rawScriptRef = isRecord(value.scriptRef) ? value.scriptRef : null;
    const scriptRef = rawScriptRef
        ? {
            sceneId:
                typeof rawScriptRef.sceneId === "string" && rawScriptRef.sceneId
                    ? rawScriptRef.sceneId
                    : value.sceneId,
            startChar:
                Number.isFinite(Number(rawScriptRef.startChar)) && Number(rawScriptRef.startChar) >= 0
                    ? Number(rawScriptRef.startChar)
                    : undefined,
            endChar:
                Number.isFinite(Number(rawScriptRef.endChar)) && Number(rawScriptRef.endChar) >= 0
                    ? Number(rawScriptRef.endChar)
                    : undefined,
        }
        : undefined;

    const rawDurationPlan = Number(value.durationPlanSec);
    const rawSequenceIndex = Number(value.sequenceIndex);
    const rawX = Number(value.x);
    const rawY = Number(value.y);
    const rawW = Number(value.w);
    const rawH = Number(value.h);
    const rawZ = Number(value.z);
    const shotTypePreset =
        value.shotTypePreset === "a-roll" ||
        value.shotTypePreset === "b-roll" ||
        value.shotTypePreset === "animated" ||
        value.shotTypePreset === "custom"
            ? value.shotTypePreset
            : undefined;
    const rawCustomLayout = isRecord(value.customLayout) ? value.customLayout : null;
    const customLayout = rawCustomLayout
        ? {
            showVisual:
                typeof rawCustomLayout.showVisual === "boolean"
                    ? rawCustomLayout.showVisual
                    : undefined,
            showText:
                typeof rawCustomLayout.showText === "boolean"
                    ? rawCustomLayout.showText
                    : undefined,
            showNotes:
                typeof rawCustomLayout.showNotes === "boolean"
                    ? rawCustomLayout.showNotes
                    : undefined,
        }
        : undefined;

    return {
        id: typeof value.id === "string" && value.id ? value.id : `sb-${Date.now()}-${idx}`,
        sceneId: value.sceneId,
        type: toStoryboardBlockType(value.type),
        x: Number.isFinite(rawX) ? rawX : idx * 340,
        y: Number.isFinite(rawY) ? rawY : 40,
        w: Number.isFinite(rawW) ? Math.max(220, rawW) : 320,
        h: Number.isFinite(rawH) ? Math.max(160, rawH) : 220,
        z: Number.isFinite(rawZ) ? rawZ : undefined,
        layoutMode: toDrawingLayoutMode(value.layoutMode),
        scriptRef,
        visualAssetId: typeof value.visualAssetId === "string" ? value.visualAssetId : undefined,
        audioAssetId: typeof value.audioAssetId === "string" ? value.audioAssetId : undefined,
        audioClipPath: typeof value.audioClipPath === "string" ? value.audioClipPath : undefined,
        drawingData: typeof value.drawingData === "string" ? value.drawingData : undefined,
        notes: typeof value.notes === "string" ? value.notes : "",
        tags,
        brollMarkers,
        durationPlanSec:
            Number.isFinite(rawDurationPlan) && rawDurationPlan >= 0 ? rawDurationPlan : undefined,
        audioRef,
        shotDetails,
        shotTypePreset,
        shotTypeCustom: typeof value.shotTypeCustom === "string" ? value.shotTypeCustom : undefined,
        category: typeof value.category === "string" ? value.category : undefined,
        blockKind: value.blockKind === "details" ? "details" : "primary",
        detailForBlockId:
            typeof value.detailForBlockId === "string" ? value.detailForBlockId : undefined,
        isTextOnly: Boolean(value.isTextOnly),
        customLayout,
        sequenceIndex: Number.isFinite(rawSequenceIndex) ? rawSequenceIndex : undefined,
        groupId: typeof value.groupId === "string" ? value.groupId : undefined,
    };
}

function sanitizeStoryboardGroup(value: unknown, idx: number): StoryboardGroup | null {
    if (!isRecord(value)) return null;
    const blockIds = Array.isArray(value.blockIds)
        ? value.blockIds.filter((id): id is string => typeof id === "string" && id.length > 0)
        : [];
    return {
        id: typeof value.id === "string" && value.id ? value.id : `group-${Date.now()}-${idx}`,
        title: typeof value.title === "string" && value.title.trim() ? value.title : `Group ${idx + 1}`,
        blockIds,
        color: typeof value.color === "string" ? value.color : undefined,
        collapsed: Boolean(value.collapsed),
    };
}

function sanitizeStoryboardLink(value: unknown, idx: number): StoryboardLink | null {
    if (!isRecord(value)) return null;
    if (typeof value.fromBlockId !== "string" || typeof value.toBlockId !== "string") return null;
    if (!value.fromBlockId || !value.toBlockId) return null;
    return {
        id: typeof value.id === "string" && value.id ? value.id : `link-${Date.now()}-${idx}`,
        fromBlockId: value.fromBlockId,
        toBlockId: value.toBlockId,
        kind: value.kind === "dependency" ? "dependency" : "sequence",
    };
}

function sanitizeStoryboardSelectionArea(value: unknown, idx: number): StoryboardSelectionArea | null {
    if (!isRecord(value)) return null;
    const rawX = Number(value.x);
    const rawY = Number(value.y);
    const rawW = Number(value.w);
    const rawH = Number(value.h);
    if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) return null;
    if (!Number.isFinite(rawW) || !Number.isFinite(rawH)) return null;
    return {
        id: typeof value.id === "string" && value.id ? value.id : `area-${Date.now()}-${idx}`,
        x: rawX,
        y: rawY,
        w: Math.max(20, rawW),
        h: Math.max(20, rawH),
        title: typeof value.title === "string" ? value.title : undefined,
        color: typeof value.color === "string" ? value.color : undefined,
    };
}

function normalizeStoryboard(value: unknown): StoryboardModule | undefined {
    if (!isRecord(value)) return undefined;

    const blocks = Array.isArray(value.blocks)
        ? value.blocks
            .map((block, idx) => sanitizeStoryboardBlock(block, idx))
            .filter((block): block is StoryboardBlock => Boolean(block))
        : [];

    const groups = Array.isArray(value.groups)
        ? value.groups
            .map((group, idx) => sanitizeStoryboardGroup(group, idx))
            .filter((group): group is StoryboardGroup => Boolean(group))
        : [];

    const links = Array.isArray(value.links)
        ? value.links
            .map((link, idx) => sanitizeStoryboardLink(link, idx))
            .filter((link): link is StoryboardLink => Boolean(link))
        : [];

    const selectionAreas = Array.isArray(value.selectionAreas)
        ? value.selectionAreas
            .map((area, idx) => sanitizeStoryboardSelectionArea(area, idx))
            .filter((area): area is StoryboardSelectionArea => Boolean(area))
        : [];

    return {
        version: 1,
        modePreference: toStoryboardMode(value.modePreference),
        drawingLayoutDefault: toDrawingLayoutMode(value.drawingLayoutDefault),
        gridSnap: Boolean(value.gridSnap),
        showLinks: value.showLinks !== false,
        showScriptInDetails: Boolean(value.showScriptInDetails),
        showMiniMap: value.showMiniMap !== false,
        showTimelineStrip: value.showTimelineStrip !== false,
        showSceneNumbers: value.showSceneNumbers !== false,
        autoDurationFromAudioEnabled: Boolean(value.autoDurationFromAudioEnabled),
        blocks,
        groups,
        links,
        selectionAreas,
    };
}

function sanitizeMasterScriptBlock(value: unknown, idx: number): MasterScriptBlock | null {
    if (!isRecord(value)) return null;
    const rawMeta = isRecord(value.headingMeta) ? value.headingMeta : null;
    const headingMeta = rawMeta
        ? {
            locationType: toMasterScriptLocationType(rawMeta.locationType),
            location: typeof rawMeta.location === "string" ? rawMeta.location : undefined,
            timeOfDay: typeof rawMeta.timeOfDay === "string" ? rawMeta.timeOfDay : undefined,
        }
        : undefined;

    return {
        id: typeof value.id === "string" && value.id ? value.id : `ms-${Date.now()}-${idx}`,
        type: toMasterScriptBlockType(value.type),
        text: typeof value.text === "string" ? value.text : "",
        headingMeta,
        linkedSceneId: typeof value.linkedSceneId === "string" ? value.linkedSceneId : undefined,
    };
}

function normalizeMasterScript(value: unknown): MasterScriptModule | undefined {
    if (!isRecord(value)) return undefined;
    if (typeof value.documentHtml === "string") {
        return {
            version: 2,
            documentHtml: value.documentHtml,
        };
    }
    const blocks = Array.isArray(value.blocks)
        ? value.blocks
            .map((block, idx) => sanitizeMasterScriptBlock(block, idx))
            .filter((block): block is MasterScriptBlock => Boolean(block))
        : [];

    return {
        version: 1,
        blocks,
    };
}

function normalizeProject(project: Project): Project {
    let audioTrack: AudioTrack | undefined;
    const rawTrack = project.audioTrack as unknown;
    if (rawTrack && typeof rawTrack === "object") {
        const candidate = rawTrack as Partial<AudioTrack>;
        audioTrack = {
            filePath: typeof candidate.filePath === "string" ? candidate.filePath : "",
            duration:
                typeof candidate.duration === "number" && Number.isFinite(candidate.duration)
                    ? Math.max(0, candidate.duration)
                    : 0,
            beatMarkers: Array.isArray(candidate.beatMarkers)
                ? candidate.beatMarkers
                    .map((v) => Number(v))
                    .filter((v) => Number.isFinite(v) && v >= 0)
                    .sort((a, b) => a - b)
                : [],
        };
    }

    return {
        ...project,
        storyboardEnabled: project.storyboardEnabled ?? false,
        storyboardAspect: project.storyboardAspect ?? inferAspectFromTargetPlatform(project.targetPlatform),
        storyboardSafeZone: project.storyboardSafeZone ?? false,
        storyboard: normalizeStoryboard((project as Project & { storyboard?: unknown }).storyboard),
        masterScript: normalizeMasterScript((project as Project & { masterScript?: unknown }).masterScript),
        notesPad: typeof project.notesPad === "string" ? project.notesPad : "",
        audioTrack,
    };
}

function toOverlayType(value: unknown): OverlaySlotType {
    if (typeof value === "string" && OVERLAY_SLOT_TYPES.includes(value as OverlaySlotType)) {
        return value as OverlaySlotType;
    }
    return "text";
}

function sanitizeOverlaySlots(
    slots: unknown,
    durationSec: number,
    assetIds: Set<string>
): OverlaySlot[] {
    if (!Array.isArray(slots)) return [];
    const maxTime = Math.max(0, Number.isFinite(durationSec) ? durationSec : 0);
    const output: OverlaySlot[] = [];

    for (let i = 0; i < slots.length; i += 1) {
        const raw = slots[i] as Partial<OverlaySlot> | null | undefined;
        if (!raw || typeof raw !== "object") continue;

        const startRaw = Number(raw.startTime);
        const endRaw = Number(raw.endTime);
        const safeStart = Number.isFinite(startRaw) ? Math.max(0, Math.min(startRaw, maxTime)) : 0;
        const safeEndBase = Number.isFinite(endRaw) ? endRaw : safeStart;
        const safeEnd = Math.max(safeStart, Math.min(safeEndBase, maxTime));

        const linkedId =
            typeof raw.linkedAssetId === "string" && assetIds.has(raw.linkedAssetId)
                ? raw.linkedAssetId
                : undefined;

        output.push({
            id: typeof raw.id === "string" && raw.id ? raw.id : `slot-${Date.now()}-${i}`,
            type: toOverlayType(raw.type),
            description: typeof raw.description === "string" ? raw.description : "",
            startTime: safeStart,
            endTime: safeEnd,
            linkedAssetId: linkedId,
        });
    }

    return output;
}

function normalizeScene(scene: Scene, projectId: string, assetIds: Set<string>): Scene {
    const duration =
        typeof scene.estimatedDurationSec === "number" && Number.isFinite(scene.estimatedDurationSec)
            ? Math.max(0, scene.estimatedDurationSec)
            : 0;

    return {
        ...scene,
        projectId,
        estimatedDurationSec: duration,
        cameraDirectionNotes:
            typeof scene.cameraDirectionNotes === "string" ? scene.cameraDirectionNotes : "",
        framingNotes: typeof scene.framingNotes === "string" ? scene.framingNotes : "",
        overlaySlots: sanitizeOverlaySlots(scene.overlaySlots, duration, assetIds),
        hookType: typeof scene.hookType === "string" ? scene.hookType : "",
        hookStrength:
            typeof scene.hookStrength === "number" && Number.isFinite(scene.hookStrength)
                ? scene.hookStrength
                : undefined,
        hookNotes: typeof scene.hookNotes === "string" ? scene.hookNotes : "",
        snapToBeat: Boolean(scene.snapToBeat),
    };
}

function normalizeProjectData(data: ProjectData): ProjectData {
    const assets = Array.isArray(data.assets) ? data.assets : [];
    const assetIds = new Set(assets.map((a) => a.id));
    const scenes = Array.isArray(data.scenes)
        ? data.scenes.map((scene) => normalizeScene(scene, data.project.id, assetIds))
        : [];

    return {
        project: normalizeProject(data.project),
        scenes,
        assets,
    };
}

export function getAllProjects(): Project[] {
    ensureDirs();
    const indexed = readProjectsIndex();
    if (indexed && !hasIndexDrift(indexed)) {
        const allReadable = indexed.every((project) => readProjectFromDisk(getProjectFilePath(project.id)));
        if (allReadable) return indexed.map((project) => normalizeProject(project));
    }
    return rebuildProjectsIndexFromProjectFiles();
}

export function getProject(id: string): ProjectData | null {
    ensureDirs();
    const filePath = getProjectFilePath(id);
    const data = readProjectFromDisk(filePath);
    if (!data) {
        removeProjectFromIndex(id);
        return null;
    }
    return data;
}

export function saveProject(data: ProjectData) {
    ensureDirs();
    const normalized = normalizeProjectData(data);
    const filePath = getProjectFilePath(normalized.project.id);
    writeProjectRecord(filePath, normalized);

    const projects = getAllProjects();
    const idx = projects.findIndex((p) => p.id === normalized.project.id);
    if (idx >= 0) {
        projects[idx] = normalized.project;
    } else {
        projects.push(normalized.project);
    }
    writeProjectsIndex(projects);
}

export function deleteProject(id: string) {
    ensureDirs();
    const filePath = getProjectFilePath(id);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    const uploadDir = path.join(getStorageLayout().uploadsDir, id);
    if (fs.existsSync(uploadDir)) {
        fs.rmSync(uploadDir, { recursive: true, force: true });
    }

    const projects = getAllProjects().filter((p) => p.id !== id);
    writeProjectsIndex(projects);
}

export function addScene(projectId: string, scene: Scene): ProjectData | null {
    const data = getProject(projectId);
    if (!data) return null;
    const assetIds = new Set(data.assets.map((a) => a.id));
    data.scenes.push(normalizeScene(scene, projectId, assetIds));
    data.project.updatedAt = new Date().toISOString();
    saveProject(data);
    return data;
}

export function updateScene(projectId: string, sceneId: string, updates: Partial<Scene>): ProjectData | null {
    const data = getProject(projectId);
    if (!data) return null;
    const idx = data.scenes.findIndex((s) => s.id === sceneId);
    if (idx < 0) return null;

    const assetIds = new Set(data.assets.map((a) => a.id));
    const merged: Scene = {
        ...data.scenes[idx],
        ...updates,
        id: sceneId,
        projectId,
    };
    data.scenes[idx] = normalizeScene(merged, projectId, assetIds);
    data.project.updatedAt = new Date().toISOString();
    saveProject(data);
    return data;
}

export function deleteScene(projectId: string, sceneId: string): ProjectData | null {
    const data = getProject(projectId);
    if (!data) return null;

    data.scenes = data.scenes.filter((s) => s.id !== sceneId);
    data.assets = data.assets.map((a) => ({
        ...a,
        sceneIds: a.sceneIds.filter((sid) => sid !== sceneId),
    }));

    data.scenes
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .forEach((s, i) => {
            s.sortOrder = i;
        });

    data.project.updatedAt = new Date().toISOString();
    saveProject(data);
    return data;
}

export function reorderScenes(projectId: string, orderedIds: string[]): ProjectData | null {
    const data = getProject(projectId);
    if (!data) return null;

    const sceneMap = new Map(data.scenes.map((s) => [s.id, s]));
    data.scenes = orderedIds
        .map((id, i) => {
            const scene = sceneMap.get(id);
            if (!scene) return null;
            return { ...scene, sortOrder: i };
        })
        .filter(Boolean) as Scene[];

    data.project.updatedAt = new Date().toISOString();
    saveProject(data);
    return data;
}

export function getUploadsDir(projectId: string): string {
    ensureDirs();
    const dir = path.join(getStorageLayout().uploadsDir, projectId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}

export function getAssetFilePath(projectId: string, fileName: string): string {
    const safeName = path.basename(fileName);
    return path.join(getUploadsDir(projectId), safeName);
}

export function addAsset(projectId: string, asset: Asset): ProjectData | null {
    const data = getProject(projectId);
    if (!data) return null;
    data.assets.push(asset);
    data.project.updatedAt = new Date().toISOString();
    saveProject(data);
    return data;
}

export function deleteAsset(projectId: string, assetId: string): ProjectData | null {
    const data = getProject(projectId);
    if (!data) return null;

    const asset = data.assets.find((a) => a.id === assetId);
    if (asset) {
        const filePath = getAssetFilePath(projectId, asset.fileName);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    data.assets = data.assets.filter((a) => a.id !== assetId);
    data.scenes = data.scenes.map((scene) => ({
        ...scene,
        overlaySlots: (scene.overlaySlots || []).map((slot) =>
            slot.linkedAssetId === assetId ? { ...slot, linkedAssetId: undefined } : slot
        ),
    }));

    data.project.updatedAt = new Date().toISOString();
    saveProject(data);
    return data;
}

export function updateAssetType(projectId: string, assetId: string, type: Asset["type"]): ProjectData | null {
    const data = getProject(projectId);
    if (!data) return null;
    const asset = data.assets.find((a) => a.id === assetId);
    if (!asset) return null;
    asset.type = type;
    data.project.updatedAt = new Date().toISOString();
    saveProject(data);
    return data;
}

export function linkAssetToScene(projectId: string, assetId: string, sceneId: string): ProjectData | null {
    const data = getProject(projectId);
    if (!data) return null;
    const asset = data.assets.find((a) => a.id === assetId);
    if (!asset) return null;
    if (!asset.sceneIds.includes(sceneId)) {
        asset.sceneIds.push(sceneId);
    }
    data.project.updatedAt = new Date().toISOString();
    saveProject(data);
    return data;
}

export function unlinkAssetFromScene(projectId: string, assetId: string, sceneId: string): ProjectData | null {
    const data = getProject(projectId);
    if (!data) return null;
    const asset = data.assets.find((a) => a.id === assetId);
    if (!asset) return null;
    asset.sceneIds = asset.sceneIds.filter((sid) => sid !== sceneId);
    data.project.updatedAt = new Date().toISOString();
    saveProject(data);
    return data;
}
