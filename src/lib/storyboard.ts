import type {
    Asset,
    Scene,
    StoryboardBlock,
    StoryboardBlockType,
    StoryboardGroup,
    StoryboardLink,
    StoryboardModule,
} from "./types";

const BLOCK_TYPE_ORDER: Record<StoryboardBlockType, number> = {
    hook: 0,
    scene: 1,
    broll: 2,
    transition: 3,
    cta: 4,
};

export const DEFAULT_BLOCK_SIZE = {
    width: 320,
    height: 220,
};

export const CANVAS_GRID_SIZE = 24;

function safeNumber(value: number, fallback: number): number {
    return Number.isFinite(value) ? value : fallback;
}

function blockSortValue(sceneOrder: number, sequenceIndex: number | undefined, type: StoryboardBlockType) {
    const seq = Number.isFinite(sequenceIndex) ? sequenceIndex ?? 0 : sceneOrder * 10 + BLOCK_TYPE_ORDER[type];
    return seq;
}

function shotTypeLabel(block: StoryboardBlock): string {
    if (block.shotTypePreset === "a-roll") return "A-Roll";
    if (block.shotTypePreset === "b-roll") return "B-Roll";
    if (block.shotTypePreset === "animated") return "Animated";
    if (block.shotTypePreset === "custom") {
        return block.shotTypeCustom?.trim() || "Custom";
    }
    return "";
}

export function getSortedScenes(scenes: Scene[]): Scene[] {
    return [...scenes].sort((a, b) => a.sortOrder - b.sortOrder);
}

export function makeStoryboardId(prefix: "block" | "group" | "link"): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createSceneBlock(scene: Scene, sequenceIndex: number): StoryboardBlock {
    return {
        id: makeStoryboardId("block"),
        sceneId: scene.id,
        type: "scene",
        x: 40 + sequenceIndex * 360,
        y: 40,
        w: DEFAULT_BLOCK_SIZE.width,
        h: DEFAULT_BLOCK_SIZE.height,
        sequenceIndex,
        scriptRef: {
            sceneId: scene.id,
            startChar: 0,
            endChar: 160,
        },
        notes: "",
        tags: [],
        brollMarkers: [],
    };
}

export function withStoryboardDefaults(storyboard: StoryboardModule | undefined, scenes: Scene[]): StoryboardModule {
    const base: StoryboardModule = {
        version: 1,
        modePreference: "hybrid",
        drawingLayoutDefault: "standard",
        gridSnap: false,
        showLinks: true,
        showScriptInDetails: false,
        showMiniMap: true,
        showTimelineStrip: false,
        showSceneNumbers: true,
        autoDurationFromAudioEnabled: false,
        blocks: [],
        groups: [],
        links: [],
        selectionAreas: [],
    };

    const merged: StoryboardModule = {
        ...base,
        ...(storyboard || {}),
        blocks: [...(storyboard?.blocks || [])],
        groups: [...(storyboard?.groups || [])],
        links: [...(storyboard?.links || [])],
        selectionAreas: [...(storyboard?.selectionAreas || [])],
    };
    const blocks =
        merged.blocks && merged.blocks.length > 0
            ? merged.blocks
            : getSortedScenes(scenes).map((scene, index) => createSceneBlock(scene, index));

    const normalizedBlocks = blocks.map((block, index) => ({
        ...block,
        sequenceIndex: Number.isFinite(block.sequenceIndex) ? block.sequenceIndex : index,
        w: Math.max(220, safeNumber(block.w, DEFAULT_BLOCK_SIZE.width)),
        h: Math.max(160, safeNumber(block.h, DEFAULT_BLOCK_SIZE.height)),
        x: safeNumber(block.x, 40 + index * 360),
        y: safeNumber(block.y, 40),
    }));

    return {
        ...merged,
        blocks: normalizedBlocks,
        groups: merged.groups || [],
        links: merged.links || [],
        selectionAreas: merged.selectionAreas || [],
    };
}

export function addMissingSceneBlocks(storyboard: StoryboardModule, scenes: Scene[]): StoryboardModule {
    const sceneIdsWithBlock = new Set(
        (storyboard.blocks || []).filter((block) => block.type === "scene").map((block) => block.sceneId)
    );
    const sortedScenes = getSortedScenes(scenes);
    const additions = sortedScenes
        .filter((scene) => !sceneIdsWithBlock.has(scene.id))
        .map((scene, index) => createSceneBlock(scene, (storyboard.blocks || []).length + index));

    if (additions.length === 0) return storyboard;

    return {
        ...storyboard,
        blocks: [...(storyboard.blocks || []), ...additions],
    };
}

export function snapValue(value: number, gridSnap: boolean, gridSize = CANVAS_GRID_SIZE): number {
    if (!gridSnap) return value;
    return Math.round(value / gridSize) * gridSize;
}

export function autoAlignToSequence(storyboard: StoryboardModule, scenes: Scene[]): StoryboardModule {
    const sceneOrder = new Map(getSortedScenes(scenes).map((scene, index) => [scene.id, index]));
    const ordered = [...(storyboard.blocks || [])].sort((a, b) => {
        const aScene = sceneOrder.get(a.sceneId) ?? Number.MAX_SAFE_INTEGER;
        const bScene = sceneOrder.get(b.sceneId) ?? Number.MAX_SAFE_INTEGER;
        const aSort = blockSortValue(aScene, a.sequenceIndex, a.type);
        const bSort = blockSortValue(bScene, b.sequenceIndex, b.type);
        return aSort - bSort;
    });

    const next = ordered.map((block, index) => ({
        ...block,
        sequenceIndex: index,
        x: 40 + (index % 4) * 360,
        y: 40 + Math.floor(index / 4) * 280,
    }));

    return {
        ...storyboard,
        blocks: next,
    };
}

export function resyncWithSceneOrder(storyboard: StoryboardModule, scenes: Scene[]): StoryboardModule {
    const sceneOrder = new Map(getSortedScenes(scenes).map((scene, index) => [scene.id, index]));
    const ordered = [...(storyboard.blocks || [])].sort((a, b) => {
        const aScene = sceneOrder.get(a.sceneId) ?? Number.MAX_SAFE_INTEGER;
        const bScene = sceneOrder.get(b.sceneId) ?? Number.MAX_SAFE_INTEGER;
        if (aScene !== bScene) return aScene - bScene;
        return BLOCK_TYPE_ORDER[a.type] - BLOCK_TYPE_ORDER[b.type];
    });

    return {
        ...storyboard,
        blocks: ordered.map((block, index) => ({
            ...block,
            sequenceIndex: index,
        })),
    };
}

export function applyTimelineLayout(storyboard: StoryboardModule, scenes: Scene[]): StoryboardModule {
    const sceneOrder = new Map(getSortedScenes(scenes).map((scene, index) => [scene.id, index]));
    const ordered = [...(storyboard.blocks || [])].sort((a, b) => {
        const aSort = blockSortValue(sceneOrder.get(a.sceneId) ?? Number.MAX_SAFE_INTEGER, a.sequenceIndex, a.type);
        const bSort = blockSortValue(sceneOrder.get(b.sceneId) ?? Number.MAX_SAFE_INTEGER, b.sequenceIndex, b.type);
        return aSort - bSort;
    });

    return {
        ...storyboard,
        blocks: ordered.map((block, index) => ({
            ...block,
            sequenceIndex: index,
            x: 60 + index * 300,
            y: 80,
            w: 280,
            h: 200,
        })),
    };
}

export interface LinearStoryboardRow {
    blockId: string;
    sequenceIndex: number;
    type: StoryboardBlockType;
    sceneId: string;
    sceneOrder: number | null;
    sceneTitle: string;
    durationPlanSec: number;
    sceneDurationSec: number;
    notes: string;
    shotSummary: string;
    missingScene: boolean;
    missingAsset: boolean;
}

export function deriveLinearStoryboardRows(
    scenes: Scene[],
    blocks: StoryboardBlock[],
    assets: Asset[]
): LinearStoryboardRow[] {
    const sortedScenes = getSortedScenes(scenes);
    const sceneMap = new Map(sortedScenes.map((scene, index) => [scene.id, { scene, index }]));
    const assetIdSet = new Set(assets.map((asset) => asset.id));

    return [...blocks]
        .filter((block) => !block.isTextOnly)
        .sort((a, b) => {
            const aSceneOrder = sceneMap.get(a.sceneId)?.index ?? Number.MAX_SAFE_INTEGER;
            const bSceneOrder = sceneMap.get(b.sceneId)?.index ?? Number.MAX_SAFE_INTEGER;
            const aSort = blockSortValue(aSceneOrder, a.sequenceIndex, a.type);
            const bSort = blockSortValue(bSceneOrder, b.sequenceIndex, b.type);
            return aSort - bSort;
        })
        .map((block, index) => {
            const sceneEntry = sceneMap.get(block.sceneId);
            const scene = sceneEntry?.scene;
            const shotSummary = [
                shotTypeLabel(block),
                block.shotDetails?.camera,
                block.shotDetails?.movement,
                block.shotDetails?.framing,
            ]
                .filter(Boolean)
                .join(" / ");

            return {
                blockId: block.id,
                sequenceIndex: Number.isFinite(block.sequenceIndex) ? block.sequenceIndex ?? index : index,
                type: block.type,
                sceneId: block.sceneId,
                sceneOrder: sceneEntry?.index ?? null,
                sceneTitle: scene?.title || "Missing scene",
                durationPlanSec:
                    Number.isFinite(block.durationPlanSec) && (block.durationPlanSec || 0) >= 0
                        ? block.durationPlanSec || 0
                        : scene?.estimatedDurationSec || 0,
                sceneDurationSec: scene?.estimatedDurationSec || 0,
                notes: block.notes || "",
                shotSummary,
                missingScene: !scene,
                missingAsset: Boolean(block.visualAssetId) && !assetIdSet.has(block.visualAssetId || ""),
            };
        });
}

export interface ShotChecklistItem {
    id: string;
    blockId: string;
    sceneId: string;
    sceneTitle: string;
    label: string;
    priority: "must" | "nice";
    done: boolean;
    missingScene: boolean;
}

export function deriveShotChecklist(rows: LinearStoryboardRow[]): ShotChecklistItem[] {
    return rows.map((row) => ({
        id: `check-${row.blockId}`,
        blockId: row.blockId,
        sceneId: row.sceneId,
        sceneTitle: row.sceneTitle,
        label: `${row.type.toUpperCase()} ${row.shotSummary || "Capture planned shot"}`,
        priority: "must",
        done: false,
        missingScene: row.missingScene,
    }));
}

export function buildTeleprompterScript(
    scenes: Scene[],
    rows: LinearStoryboardRow[],
    links: StoryboardLink[]
): string {
    const sceneMap = new Map(getSortedScenes(scenes).map((scene) => [scene.id, scene]));
    const sceneRows = new Map<string, LinearStoryboardRow[]>();

    rows.forEach((row) => {
        const bucket = sceneRows.get(row.sceneId) || [];
        bucket.push(row);
        sceneRows.set(row.sceneId, bucket);
    });

    const linkMap = new Map<string, StoryboardLink[]>();
    links.forEach((link) => {
        const bucket = linkMap.get(link.fromBlockId) || [];
        bucket.push(link);
        linkMap.set(link.fromBlockId, bucket);
    });

    const lines: string[] = [];
    getSortedScenes(scenes).forEach((scene, idx) => {
        lines.push(`SCENE ${idx + 1}: ${scene.title}`);
        const plannedRows = sceneRows.get(scene.id) || [];
        plannedRows.forEach((row) => {
            lines.push(`Cue: ${row.type.toUpperCase()} | Plan ${row.durationPlanSec}s`);
            const transitions = linkMap.get(row.blockId) || [];
            if (transitions.length > 0) {
                lines.push(`Transition count: ${transitions.length}`);
            }
        });
        lines.push(scene.scriptBody || "[No script entered]");
        if (scene.cta) lines.push(`CTA: ${scene.cta}`);
        lines.push("");
    });

    for (const row of rows) {
        if (sceneMap.has(row.sceneId)) continue;
        lines.push(`ORPHAN BLOCK ${row.blockId} -> Missing scene ${row.sceneId}`);
    }

    return lines.join("\n").trim();
}

export function rowsToShotSheetCsv(rows: LinearStoryboardRow[]): string {
    const header = [
        "sequenceIndex",
        "blockId",
        "type",
        "sceneId",
        "sceneTitle",
        "sceneOrder",
        "durationPlanSec",
        "sceneDurationSec",
        "missingScene",
        "missingAsset",
        "shotSummary",
        "notes",
    ];

    const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const lines = [
        header.join(","),
        ...rows.map((row) =>
            [
                row.sequenceIndex,
                row.blockId,
                row.type,
                row.sceneId,
                row.sceneTitle,
                row.sceneOrder ?? "",
                row.durationPlanSec,
                row.sceneDurationSec,
                row.missingScene,
                row.missingAsset,
                row.shotSummary,
                row.notes,
            ]
                .map(escape)
                .join(",")
        ),
    ];
    return lines.join("\n");
}

export function saveTextAsFile(fileName: string, content: string, mimeType = "text/plain;charset=utf-8") {
    if (typeof window === "undefined") return;
    const blob = new Blob([content], { type: mimeType });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
}

export function createGroup(title: string, selectedBlockIds: string[]): StoryboardGroup {
    return {
        id: makeStoryboardId("group"),
        title,
        blockIds: selectedBlockIds,
        collapsed: false,
    };
}
