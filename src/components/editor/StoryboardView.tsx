"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
    ArrowDown,
    ArrowLeft,
    ArrowRight,
    CheckSquare,
    Download,
    FileText,
    Grid3X3,
    Map as MapIcon,
    Maximize2,
    Minimize2,
    Music2,
    Pencil,
    Plus,
    RefreshCw,
    X,
} from "lucide-react";
import type {
    Asset,
    AudioTrack,
    DrawingLayoutMode,
    Project,
    Scene,
    StoryboardBlock,
    StoryboardBlockType,
    StoryboardMode,
    StoryboardModule,
    StoryboardSelectionArea,
} from "@/lib/types";
import {
    DRAWING_LAYOUT_MODES,
    STORYBOARD_MODES,
    formatDuration,
} from "@/lib/types";
import {
    addMissingSceneBlocks,
    autoAlignToSequence,
    buildTeleprompterScript,
    CANVAS_GRID_SIZE,
    createGroup,
    deriveLinearStoryboardRows,
    deriveShotChecklist,
    getSortedScenes,
    makeStoryboardId,
    resyncWithSceneOrder,
    rowsToShotSheetCsv,
    saveTextAsFile,
    snapValue,
    withStoryboardDefaults,
} from "@/lib/storyboard";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

interface StoryboardViewProps {
    project: Project;
    scenes: Scene[];
    assets: Asset[];
    onUpdateProject: (updates: Record<string, unknown>) => void;
    onUpdateScene: (sceneId: string, updates: Partial<Scene>) => void;
    onReorderScenes: (orderedIds: string[]) => void;
    onClose?: () => void;
}

type RenderMode = "canvas" | "timeline" | "shot-list" | "teleprompter";

type ShotPreset = "a-roll" | "b-roll" | "animated" | "custom";

const SHOT_PRESETS: Array<{ value: ShotPreset; label: string }> = [
    { value: "a-roll", label: "A-roll" },
    { value: "b-roll", label: "B-roll" },
    { value: "animated", label: "Animated" },
    { value: "custom", label: "Custom" },
];

const ROLE_COLORS: Record<StoryboardBlockType, string> = {
    scene: "#9ca3af",
    hook: "#f59e0b",
    broll: "#10b981",
    transition: "#ec4899",
    cta: "#8b5cf6",
};

const ROLE_OPTIONS: Array<{ value: StoryboardBlockType; label: string }> = [
    { value: "scene", label: "Scene" },
    { value: "hook", label: "Hook" },
    { value: "broll", label: "B-roll" },
    { value: "transition", label: "Transition" },
    { value: "cta", label: "CTA" },
];

const CATEGORY_OPTIONS = ["general", "camera", "timing", "dialogue", "action"];
const BRUSH_SWATCHES = ["#0f172a", "#ef4444", "#2563eb", "#16a34a", "#f59e0b", "#a21caf"];
const DETAILS_CARD_GAP = 18;
const DETAILS_MAGNET_RADIUS = 88;

const UNASSIGNED_SCENE_ID = "__unassigned__";

const MODE_LABELS: Record<StoryboardMode, string> = {
    text: "Text",
    image: "Drawing",
    audio: "Audio",
    hybrid: "Hybrid",
};

const MODE_HINTS: Record<StoryboardMode, string> = {
    text: "Script-first planning: double-click a wireframe to open its Text Card, then connect arrows for flow.",
    image: "Visual-first planning: double-click a wireframe to draw, then connect arrows for flow.",
    audio: "Timing-first planning: double-click a wireframe to open its Audio Card, then connect arrows for flow.",
    hybrid: "Balanced planning: combine script, drawing, and audio timing.",
};

type Interaction =
    | {
        mode: "pan";
        startX: number;
        startY: number;
        offsetX: number;
        offsetY: number;
    }
    | {
        mode: "move";
        blockId: string;
        startX: number;
        startY: number;
        blockX: number;
        blockY: number;
    }
    | {
        mode: "resize";
        blockId: string;
        startX: number;
        startY: number;
        blockW: number;
        blockH: number;
        axis: "xy" | "x" | "y";
    }
    | {
        mode: "area-resize";
        areaId: string;
        handle: "nw" | "ne" | "sw" | "se";
        startX: number;
        startY: number;
        areaX: number;
        areaY: number;
        areaW: number;
        areaH: number;
    };

interface ContextMenuState {
    open: boolean;
    x: number;
    y: number;
    blockId: string | null;
}

interface LinkDraft {
    fromBlockId: string;
    anchor: "right" | "bottom";
    cursorX: number;
    cursorY: number;
}

interface DrawingPoint {
    x: number;
    y: number;
}

interface DrawingStroke {
    id: string;
    points: DrawingPoint[];
    color?: string;
    size?: number;
    opacity?: number;
    tool?: "brush" | "eraser";
}

interface SelectionAreaDraft {
    startX: number;
    startY: number;
    endX: number;
    endY: number;
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function parseBeatMarkers(raw: string): number[] {
    return raw
        .split(",")
        .map((v) => Number(v.trim()))
        .filter((v) => Number.isFinite(v) && v >= 0)
        .sort((a, b) => a - b);
}

function nearestBeat(time: number, markers: number[]): number {
    if (!markers.length) return time;
    let best = markers[0];
    let minDistance = Math.abs(markers[0] - time);
    for (let i = 1; i < markers.length; i += 1) {
        const distance = Math.abs(markers[i] - time);
        if (distance < minDistance) {
            minDistance = distance;
            best = markers[i];
        }
    }
    return best;
}

function splitTags(raw: string): string[] {
    return raw
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}

function parseDrawingData(raw: string | undefined): DrawingStroke[] {
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed
            .map((entry) => {
                if (!entry || typeof entry !== "object") return null;
                const pointsRaw = (entry as { points?: unknown }).points;
                if (!Array.isArray(pointsRaw)) return null;
                const points = pointsRaw
                    .map((point) => {
                        if (!point || typeof point !== "object") return null;
                        const px = Number((point as { x?: unknown }).x);
                        const py = Number((point as { y?: unknown }).y);
                        if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
                        return {
                            x: clamp(px, 0, 1),
                            y: clamp(py, 0, 1),
                        };
                    })
                    .filter((point): point is DrawingPoint => Boolean(point));
                if (points.length < 2) return null;
                const stroke: DrawingStroke = {
                    id:
                        typeof (entry as { id?: unknown }).id === "string"
                            ? ((entry as { id: string }).id || makeStoryboardId("block"))
                            : makeStoryboardId("block"),
                    points,
                    tool: (entry as { tool?: unknown }).tool === "eraser" ? "eraser" : "brush",
                };
                if (typeof (entry as { color?: unknown }).color === "string") {
                    stroke.color = (entry as { color: string }).color;
                }
                if (Number.isFinite(Number((entry as { size?: unknown }).size))) {
                    stroke.size = Math.max(0.3, Number((entry as { size?: unknown }).size));
                }
                if (Number.isFinite(Number((entry as { opacity?: unknown }).opacity))) {
                    stroke.opacity = clamp(Number((entry as { opacity?: unknown }).opacity), 0.05, 1);
                }
                return stroke;
            })
            .filter((stroke): stroke is DrawingStroke => Boolean(stroke));
    } catch {
        return [];
    }
}

function stringifyDrawingData(strokes: DrawingStroke[]): string | undefined {
    if (!strokes.length) return undefined;
    return JSON.stringify(
        strokes.map((stroke) => ({
            id: stroke.id,
            color: stroke.color,
            size: stroke.size,
            opacity: stroke.opacity,
            tool: stroke.tool,
            points: stroke.points.map((point) => ({
                x: Number(point.x.toFixed(4)),
                y: Number(point.y.toFixed(4)),
            })),
        }))
    );
}

function toPolylinePoints(points: DrawingPoint[]): string {
    return points
        .map((point) => `${(point.x * 100).toFixed(3)},${(point.y * 100).toFixed(3)}`)
        .join(" ");
}

function eraseStrokesByPath(
    strokes: DrawingStroke[],
    path: DrawingPoint[],
    radiusPx: number
): DrawingStroke[] {
    if (!path.length || !strokes.length) return strokes;
    const r = Math.max(0.001, radiusPx / 100);
    const r2 = r * r;
    return strokes.filter((stroke) => {
        for (const sPoint of stroke.points) {
            for (const pPoint of path) {
                const dx = sPoint.x - pPoint.x;
                const dy = sPoint.y - pPoint.y;
                if (dx * dx + dy * dy <= r2) return false;
            }
        }
        return true;
    });
}

function colorWithAlpha(hexOrRgb: string | undefined, alpha: number): string {
    if (!hexOrRgb) return `rgba(59,130,246,${alpha})`;
    if (hexOrRgb.startsWith("#")) {
        const hex = hexOrRgb.replace("#", "");
        const full = hex.length === 3 ? hex.split("").map((ch) => ch + ch).join("") : hex;
        if (full.length === 6) {
            const r = Number.parseInt(full.slice(0, 2), 16);
            const g = Number.parseInt(full.slice(2, 4), 16);
            const b = Number.parseInt(full.slice(4, 6), 16);
            if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
                return `rgba(${r},${g},${b},${alpha})`;
            }
        }
    }
    return hexOrRgb;
}

function computeSegmentSuggestions(scenes: Scene[], duration: number, beats: number[]) {
    if (!scenes.length || duration <= 0) return [] as Array<{ sceneId: string; start: number; end: number }>;
    const sorted = getSortedScenes(scenes);
    const perScene = duration / sorted.length;
    return sorted.map((scene, idx) => {
        let start = idx * perScene;
        let end = idx === sorted.length - 1 ? duration : (idx + 1) * perScene;
        if (beats.length > 0) {
            start = nearestBeat(start, beats);
            end = nearestBeat(end, beats);
            if (end <= start) end = Math.min(duration, start + Math.max(1, perScene));
        }
        return { sceneId: scene.id, start, end };
    });
}

function createWireframe(sceneId: string, sequenceIndex: number, x: number, y: number, layout: DrawingLayoutMode): StoryboardBlock {
    return {
        id: makeStoryboardId("block"),
        sceneId,
        type: "scene",
        x,
        y,
        w: 220,
        h: 140,
        sequenceIndex,
        layoutMode: layout,
        notes: "",
        tags: [],
        brollMarkers: [],
        shotTypePreset: "a-roll",
        blockKind: "primary",
        scriptRef: {
            sceneId,
            startChar: 0,
            endChar: 200,
        },
        customLayout: {
            showText: true,
            showVisual: true,
            showNotes: false,
        },
    };
}

function createDetailsWireframe(parent: StoryboardBlock, sequenceIndex: number): StoryboardBlock {
    return {
        id: makeStoryboardId("block"),
        sceneId: parent.sceneId,
        type: "scene",
        x: parent.x,
        y: parent.y + parent.h + DETAILS_CARD_GAP,
        w: Math.max(260, parent.w),
        h: 196,
        sequenceIndex,
        layoutMode: parent.layoutMode || "standard",
        notes: "",
        category: "filming-details",
        blockKind: "details",
        detailForBlockId: parent.id,
        isTextOnly: true,
        shotDetails: {
            framing: "",
            angle: "",
            movement: "",
            camera: "",
            lens: "",
            lighting: "",
            colorPalette: "",
            location: "",
        },
    };
}

export default function StoryboardView({
    project,
    scenes,
    assets,
    onUpdateProject,
    onUpdateScene,
    onReorderScenes,
    onClose,
}: StoryboardViewProps) {
    const boardShellRef = useRef<HTMLElement>(null);
    const orderedScenes = useMemo(() => getSortedScenes(scenes), [scenes]);

    const storyboardFromProject = useMemo(() => {
        const seeded = withStoryboardDefaults(project.storyboard, orderedScenes);
        return addMissingSceneBlocks(seeded, orderedScenes);
    }, [project.storyboard, orderedScenes]);

    const [storyboard, setStoryboard] = useState<StoryboardModule>(storyboardFromProject);
    const storyboardRef = useRef(storyboardFromProject);
    const persistTimer = useRef<NodeJS.Timeout | null>(null);

    const [renderMode, setRenderMode] = useState<RenderMode>("canvas");
    const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
    const [showInspector, setShowInspector] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [contextMenu, setContextMenu] = useState<ContextMenuState>({
        open: false,
        x: 0,
        y: 0,
        blockId: null,
    });
    const [pencilEnabled, setPencilEnabled] = useState(false);
    const [drawingBlockId, setDrawingBlockId] = useState<string | null>(null);
    const [textBlockId, setTextBlockId] = useState<string | null>(null);
    const [audioBlockId, setAudioBlockId] = useState<string | null>(null);
    const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
    const [selectionDraft, setSelectionDraft] = useState<SelectionAreaDraft | null>(null);
    const [pendingSelectionConfirm, setPendingSelectionConfirm] = useState<SelectionAreaDraft | null>(null);
    const [activeStroke, setActiveStroke] = useState<DrawingStroke | null>(null);
    const [drawTool, setDrawTool] = useState<"brush" | "eraser">("brush");
    const [brushColor, setBrushColor] = useState("#0f172a");
    const [brushSize, setBrushSize] = useState(2.6);
    const [brushOpacity, setBrushOpacity] = useState(1);
    const [linkDraft, setLinkDraft] = useState<LinkDraft | null>(null);
    const [customShotValue, setCustomShotValue] = useState("");
    const [customCategoryValue, setCustomCategoryValue] = useState("");
    const [groupName, setGroupName] = useState("");
    const [checklistState, setChecklistState] = useState<Record<string, boolean>>({});

    const [audioFilePath, setAudioFilePath] = useState(project.audioTrack?.filePath || "");
    const [audioDuration, setAudioDuration] = useState(project.audioTrack?.duration || 0);
    const [beatInput, setBeatInput] = useState((project.audioTrack?.beatMarkers || []).join(", "));

    const [scale, setScale] = useState(1);
    const [offset, setOffset] = useState({ x: 120, y: 110 });
    const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

    const canvasRef = useRef<HTMLDivElement | null>(null);
    const drawingSurfaceRef = useRef<HTMLDivElement | null>(null);
    const drawingSvgRef = useRef<SVGSVGElement | null>(null);
    const interactionRef = useRef<Interaction | null>(null);
    const activeStrokeRef = useRef<DrawingStroke | null>(null);
    const drawRafRef = useRef<number | null>(null);

    const blocks = storyboard.blocks || [];
    const groups = storyboard.groups || [];
    const links = storyboard.links || [];
    const selectionAreas = storyboard.selectionAreas || [];

    const beatMarkers = useMemo(() => parseBeatMarkers(beatInput), [beatInput]);
    const blockById = useMemo(() => new Map(blocks.map((block) => [block.id, block])), [blocks]);

    const selectedBlock = useMemo(
        () => (selectedBlockId ? blocks.find((block) => block.id === selectedBlockId) || null : null),
        [blocks, selectedBlockId]
    );
    const activeMode = storyboard.modePreference || "hybrid";
    const modeHint = MODE_HINTS[activeMode];
    const drawingModeEnabled = activeMode === "image" || activeMode === "hybrid";
    const textModeEnabled = activeMode === "text" || activeMode === "hybrid";
    const audioModeEnabled = activeMode === "audio" || activeMode === "hybrid";
    const drawingBlock = useMemo(
        () => (drawingBlockId ? blockById.get(drawingBlockId) || null : null),
        [blockById, drawingBlockId]
    );
    const textBlock = useMemo(
        () => (textBlockId ? blockById.get(textBlockId) || null : null),
        [blockById, textBlockId]
    );
    const audioBlock = useMemo(
        () => (audioBlockId ? blockById.get(audioBlockId) || null : null),
        [blockById, audioBlockId]
    );
    const selectedArea = useMemo(
        () => (selectedAreaId ? selectionAreas.find((area) => area.id === selectedAreaId) || null : null),
        [selectionAreas, selectedAreaId]
    );
    const drawingStrokes = useMemo(
        () => parseDrawingData(drawingBlock?.drawingData),
        [drawingBlock?.drawingData]
    );
    const isSelectedDetailsCard = Boolean(selectedBlock?.blockKind === "details");
    const drawingAsset = useMemo(
        () =>
            drawingBlock?.visualAssetId
                ? assets.find((asset) => asset.id === drawingBlock.visualAssetId)
                : undefined,
        [drawingBlock?.visualAssetId, assets]
    );
    const audioAssets = useMemo(
        () => assets.filter((asset) => asset.mimeType.startsWith("audio/") || asset.type === "audio"),
        [assets]
    );

    function commitSelectionArea(draft: SelectionAreaDraft) {
        const x = Math.min(draft.startX, draft.endX);
        const y = Math.min(draft.startY, draft.endY);
        const w = Math.abs(draft.endX - draft.startX);
        const h = Math.abs(draft.endY - draft.startY);
        if (w < 14 || h < 14) return;
        const nextArea: StoryboardSelectionArea = {
            id: makeStoryboardId("group"),
            x,
            y,
            w,
            h,
            title: `Area ${(storyboardRef.current.selectionAreas || []).length + 1}`,
            color: "#60a5fa",
        };
        mutateStoryboard((current) => ({
            ...current,
            selectionAreas: [...(current.selectionAreas || []), nextArea],
        }));
        setSelectedAreaId(nextArea.id);
    }

    const linearRows = useMemo(
        () => deriveLinearStoryboardRows(orderedScenes, blocks, assets),
        [orderedScenes, blocks, assets]
    );
    const shotChecklist = useMemo(() => deriveShotChecklist(linearRows), [linearRows]);
    const teleprompterScript = useMemo(
        () => buildTeleprompterScript(orderedScenes, linearRows, links),
        [orderedScenes, linearRows, links]
    );
    const segmentSuggestions = useMemo(
        () => computeSegmentSuggestions(orderedScenes, audioDuration, beatMarkers),
        [orderedScenes, audioDuration, beatMarkers]
    );

    useEffect(() => {
        setStoryboard(storyboardFromProject);
        storyboardRef.current = storyboardFromProject;
        if (selectedBlockId && !storyboardFromProject.blocks?.some((b) => b.id === selectedBlockId)) {
            setSelectedBlockId(null);
        }
        if (drawingBlockId && !storyboardFromProject.blocks?.some((b) => b.id === drawingBlockId)) {
            setDrawingBlockId(null);
            setActiveStroke(null);
        }
        if (textBlockId && !storyboardFromProject.blocks?.some((b) => b.id === textBlockId)) {
            setTextBlockId(null);
        }
        if (audioBlockId && !storyboardFromProject.blocks?.some((b) => b.id === audioBlockId)) {
            setAudioBlockId(null);
        }
        if (selectedAreaId && !storyboardFromProject.selectionAreas?.some((area) => area.id === selectedAreaId)) {
            setSelectedAreaId(null);
        }
    }, [storyboardFromProject, selectedBlockId, drawingBlockId, textBlockId, audioBlockId, selectedAreaId]);

    useEffect(() => {
        setAudioFilePath(project.audioTrack?.filePath || "");
        setAudioDuration(project.audioTrack?.duration || 0);
        setBeatInput((project.audioTrack?.beatMarkers || []).join(", "));
    }, [project.audioTrack]);

    useEffect(() => {
        if (!canvasRef.current) return;
        const observer = new ResizeObserver((entries) => {
            const rect = entries[0]?.contentRect;
            if (!rect) return;
            setCanvasSize({ width: rect.width, height: rect.height });
        });
        observer.observe(canvasRef.current);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        return () => {
            if (persistTimer.current) clearTimeout(persistTimer.current);
            if (drawRafRef.current !== null && typeof window !== "undefined") {
                window.cancelAnimationFrame(drawRafRef.current);
            }
        };
    }, []);

    useEffect(() => {
        function onMouseMove(event: MouseEvent) {
            const current = interactionRef.current;
            if (!current) return;

            if (current.mode === "pan") {
                const dx = event.clientX - current.startX;
                const dy = event.clientY - current.startY;
                setOffset({ x: current.offsetX + dx, y: current.offsetY + dy });
                return;
            }

            if (current.mode === "move") {
                const dx = (event.clientX - current.startX) / scale;
                const dy = (event.clientY - current.startY) / scale;
                const nextX = snapValue(current.blockX + dx, Boolean(storyboardRef.current.gridSnap));
                const nextY = snapValue(current.blockY + dy, Boolean(storyboardRef.current.gridSnap));
                setStoryboard((prev) => {
                    const currentBlocks = prev.blocks || [];
                    const movingBlock = currentBlocks.find((block) => block.id === current.blockId);
                    if (!movingBlock) return prev;

                    let resolvedX = nextX;
                    let resolvedY = nextY;
                    let resolvedDetailFor = movingBlock.detailForBlockId;

                    if (movingBlock.blockKind === "details") {
                        const movingCenterX = nextX + movingBlock.w / 2;
                        const movingTopY = nextY;
                        let bestTarget: StoryboardBlock | null = null;
                        let bestDistance = Number.POSITIVE_INFINITY;

                        for (const candidate of currentBlocks) {
                            if (candidate.id === movingBlock.id || candidate.blockKind === "details") continue;
                            const anchorX = candidate.x + candidate.w / 2;
                            const anchorY = candidate.y + candidate.h + DETAILS_CARD_GAP;
                            const distance = Math.hypot(movingCenterX - anchorX, movingTopY - anchorY);
                            if (distance < DETAILS_MAGNET_RADIUS && distance < bestDistance) {
                                bestDistance = distance;
                                bestTarget = candidate;
                            }
                        }

                        if (bestTarget) {
                            resolvedX = bestTarget.x;
                            resolvedY = bestTarget.y + bestTarget.h + DETAILS_CARD_GAP;
                            resolvedDetailFor = bestTarget.id;
                        } else {
                            resolvedDetailFor = undefined;
                        }
                    }

                    const nextBlocks = currentBlocks.map((block) =>
                        block.id === current.blockId
                            ? {
                                ...block,
                                x: resolvedX,
                                y: resolvedY,
                                detailForBlockId: resolvedDetailFor,
                            }
                            : block
                    );

                    let nextLinks = prev.links || [];
                    if (movingBlock.blockKind === "details") {
                        nextLinks = nextLinks.filter((link) => {
                            if (link.toBlockId !== movingBlock.id) return true;
                            return resolvedDetailFor && link.fromBlockId === resolvedDetailFor;
                        });

                        if (resolvedDetailFor) {
                            const linkExists = nextLinks.some(
                                (link) =>
                                    link.fromBlockId === resolvedDetailFor &&
                                    link.toBlockId === movingBlock.id
                            );
                            if (!linkExists) {
                                nextLinks = [
                                    ...nextLinks,
                                    {
                                        id: makeStoryboardId("link"),
                                        fromBlockId: resolvedDetailFor,
                                        toBlockId: movingBlock.id,
                                        kind: "dependency",
                                    },
                                ];
                            }
                        }
                    }

                    const next = {
                        ...prev,
                        blocks: nextBlocks,
                        links: nextLinks,
                    };
                    storyboardRef.current = next;
                    return next;
                });
                return;
            }

            const dx = (event.clientX - current.startX) / scale;
            const dy = (event.clientY - current.startY) / scale;
            if (current.mode === "area-resize") {
                const minW = 40;
                const minH = 30;
                let x = current.areaX;
                let y = current.areaY;
                let w = current.areaW;
                let h = current.areaH;

                if (current.handle === "se") {
                    w = Math.max(minW, current.areaW + dx);
                    h = Math.max(minH, current.areaH + dy);
                } else if (current.handle === "sw") {
                    w = Math.max(minW, current.areaW - dx);
                    h = Math.max(minH, current.areaH + dy);
                    x = current.areaX + (current.areaW - w);
                } else if (current.handle === "ne") {
                    w = Math.max(minW, current.areaW + dx);
                    h = Math.max(minH, current.areaH - dy);
                    y = current.areaY + (current.areaH - h);
                } else {
                    w = Math.max(minW, current.areaW - dx);
                    h = Math.max(minH, current.areaH - dy);
                    x = current.areaX + (current.areaW - w);
                    y = current.areaY + (current.areaH - h);
                }

                const nextX = snapValue(x, Boolean(storyboardRef.current.gridSnap));
                const nextY = snapValue(y, Boolean(storyboardRef.current.gridSnap));
                const nextW = snapValue(w, Boolean(storyboardRef.current.gridSnap));
                const nextH = snapValue(h, Boolean(storyboardRef.current.gridSnap));

                setStoryboard((prev) => {
                    const next = {
                        ...prev,
                        selectionAreas: (prev.selectionAreas || []).map((area) =>
                            area.id === current.areaId
                                ? { ...area, x: nextX, y: nextY, w: Math.max(minW, nextW), h: Math.max(minH, nextH) }
                                : area
                        ),
                    };
                    storyboardRef.current = next;
                    return next;
                });
                return;
            }

            const nextW =
                current.axis === "y"
                    ? current.blockW
                    : Math.max(160, current.blockW + dx);
            const nextH =
                current.axis === "x"
                    ? current.blockH
                    : Math.max(110, current.blockH + dy);
            setStoryboard((prev) => {
                const next = {
                    ...prev,
                    blocks: (prev.blocks || []).map((block) =>
                        block.id === current.blockId ? { ...block, w: nextW, h: nextH } : block
                    ),
                };
                storyboardRef.current = next;
                return next;
            });
        }

        function onMouseUp() {
            if (!interactionRef.current) return;
            interactionRef.current = null;
            queuePersist(storyboardRef.current);
        }

        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
        return () => {
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", onMouseUp);
        };
    }, [scale]);

    useEffect(() => {
        setChecklistState((prev) => {
            const next: Record<string, boolean> = {};
            for (const item of shotChecklist) next[item.id] = Boolean(prev[item.id]);
            return next;
        });
    }, [shotChecklist]);

    useEffect(() => {
        function closeMenu() {
            setContextMenu((prev) => ({ ...prev, open: false }));
        }
        window.addEventListener("click", closeMenu);
        return () => window.removeEventListener("click", closeMenu);
    }, []);

    useEffect(() => {
        if (!linkDraft) return;

        function handleMove(event: MouseEvent) {
            const point = toCanvasWorldPoint(event.clientX, event.clientY);
            if (!point) return;
            setLinkDraft((prev) =>
                prev ? { ...prev, cursorX: point.x, cursorY: point.y } : prev
            );
        }

        function handleCancel(event: MouseEvent) {
            const target = event.target as HTMLElement | null;
            if (!target) return;
            if (
                target.closest("[data-wireframe]") ||
                target.closest("[data-connector]") ||
                target.closest("[data-context-menu]")
            ) {
                return;
            }
            setLinkDraft(null);
        }

        window.addEventListener("mousemove", handleMove);
        window.addEventListener("mousedown", handleCancel);
        return () => {
            window.removeEventListener("mousemove", handleMove);
            window.removeEventListener("mousedown", handleCancel);
        };
    }, [linkDraft, offset.x, offset.y, scale]);

    useEffect(() => {
        if (!selectionDraft) return;

        function handleMove(event: MouseEvent) {
            const point = toCanvasWorldPoint(event.clientX, event.clientY);
            if (!point) return;
            setSelectionDraft((prev) => (prev ? { ...prev, endX: point.x, endY: point.y } : prev));
        }

        function handleUp() {
            setSelectionDraft((prev) => {
                if (!prev) return prev;
                const w = Math.abs(prev.endX - prev.startX);
                const h = Math.abs(prev.endY - prev.startY);
                if (w < 14 || h < 14) return null;
                setPendingSelectionConfirm(prev);
                return null;
            });
        }

        window.addEventListener("mousemove", handleMove);
        window.addEventListener("mouseup", handleUp);
        return () => {
            window.removeEventListener("mousemove", handleMove);
            window.removeEventListener("mouseup", handleUp);
        };
    }, [selectionDraft, offset.x, offset.y, scale]);

    useEffect(() => {
        if (renderMode === "canvas") return;
        setDrawingBlockId(null);
        setTextBlockId(null);
        setAudioBlockId(null);
        setActiveStroke(null);
    }, [renderMode]);

    useEffect(() => {
        if (drawingModeEnabled) return;
        setPencilEnabled(false);
        setDrawingBlockId(null);
        setActiveStroke(null);
    }, [drawingModeEnabled]);

    useEffect(() => {
        if (textModeEnabled) return;
        setTextBlockId(null);
    }, [textModeEnabled]);

    useEffect(() => {
        if (audioModeEnabled) return;
        setAudioBlockId(null);
    }, [audioModeEnabled]);

    useEffect(() => {
        function onKeyDown(event: KeyboardEvent) {
            if (event.key !== "Delete" && event.key !== "Backspace") return;
            if (!selectedAreaId) return;
            const target = event.target as HTMLElement | null;
            if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
            event.preventDefault();
            removeSelectionArea(selectedAreaId);
        }
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [selectedAreaId]);

    function queuePersist(next: StoryboardModule) {
        if (persistTimer.current) clearTimeout(persistTimer.current);
        persistTimer.current = setTimeout(() => {
            onUpdateProject({ storyboard: next });
        }, 320);
    }

    function mutateStoryboard(mutator: (current: StoryboardModule) => StoryboardModule) {
        setStoryboard((prev) => {
            const next = mutator(prev);
            storyboardRef.current = next;
            queuePersist(next);
            return next;
        });
    }

    function setMode(mode: StoryboardMode) {
        setRenderMode("canvas");
        if (mode === "text" || mode === "audio") {
            setPencilEnabled(false);
            closeDrawingCard();
            closeTextCard();
            closeAudioCard();
        }
        if (mode === "image" || mode === "hybrid") {
            setRenderMode("canvas");
        }
        if (mode === "image") setPencilEnabled(true);
        if (mode === "hybrid") {
            closeTextCard();
            closeAudioCard();
        }

        mutateStoryboard((prev) => {
            const base = { ...prev, modePreference: mode };
            if (mode === "text") {
                return {
                    ...base,
                    showScriptInDetails: true,
                    showLinks: true,
                    showTimelineStrip: false,
                    showMiniMap: false,
                    autoDurationFromAudioEnabled: false,
                };
            }
            if (mode === "image") {
                return {
                    ...base,
                    showScriptInDetails: false,
                    showLinks: true,
                    showTimelineStrip: false,
                    showMiniMap: true,
                    autoDurationFromAudioEnabled: false,
                };
            }
            if (mode === "audio") {
                return {
                    ...base,
                    showScriptInDetails: false,
                    showLinks: true,
                    showTimelineStrip: false,
                    showMiniMap: true,
                    autoDurationFromAudioEnabled: true,
                };
            }
            return {
                ...base,
                showScriptInDetails: true,
                showLinks: true,
                showTimelineStrip: false,
                showMiniMap: true,
            };
        });
    }

    function setDrawingLayout(layout: DrawingLayoutMode) {
        mutateStoryboard((prev) => ({ ...prev, drawingLayoutDefault: layout }));
    }

    function updateSelectedBlock(updates: Partial<StoryboardBlock>) {
        if (!selectedBlockId) return;
        mutateStoryboard((prev) => ({
            ...prev,
            blocks: (prev.blocks || []).map((block) =>
                block.id === selectedBlockId ? { ...block, ...updates } : block
            ),
        }));
    }

    function updateBlockById(blockId: string, updates: Partial<StoryboardBlock>) {
        mutateStoryboard((prev) => ({
            ...prev,
            blocks: (prev.blocks || []).map((block) =>
                block.id === blockId ? { ...block, ...updates } : block
            ),
        }));
    }

    function openDrawingCard(blockId: string) {
        setTextBlockId(null);
        setAudioBlockId(null);
        setDrawingBlockId(blockId);
        setActiveStroke(null);
    }

    function closeDrawingCard() {
        setDrawingBlockId(null);
        setActiveStroke(null);
    }

    function openTextCard(blockId: string) {
        setDrawingBlockId(null);
        setAudioBlockId(null);
        setActiveStroke(null);
        setTextBlockId(blockId);
    }

    function closeTextCard() {
        setTextBlockId(null);
    }

    function openAudioCard(blockId: string) {
        setDrawingBlockId(null);
        setTextBlockId(null);
        setActiveStroke(null);
        setAudioBlockId(blockId);
    }

    function closeAudioCard() {
        setAudioBlockId(null);
    }

    function openModeCardForBlock(blockId: string) {
        const block = blockById.get(blockId);
        if (!block || block.isTextOnly) return;
        if (activeMode === "audio") {
            openAudioCard(blockId);
            return;
        }
        if (activeMode === "text") {
            openTextCard(blockId);
            return;
        }
        if (activeMode === "image" || (activeMode === "hybrid" && pencilEnabled)) {
            openDrawingCard(blockId);
        }
    }

    function writeDrawingData(blockId: string, strokes: DrawingStroke[]) {
        updateBlockById(blockId, { drawingData: stringifyDrawingData(strokes) });
    }

    function getDrawingPoint(clientX: number, clientY: number): DrawingPoint | null {
        const svg = drawingSvgRef.current;
        if (svg) {
            const ctm = svg.getScreenCTM();
            if (ctm) {
                const point = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
                return {
                    x: clamp(point.x / 100, 0, 1),
                    y: clamp(point.y / 100, 0, 1),
                };
            }
        }
        const rect = drawingSurfaceRef.current?.getBoundingClientRect();
        if (!rect || rect.width <= 0 || rect.height <= 0) return null;
        return {
            x: clamp((clientX - rect.left) / rect.width, 0, 1),
            y: clamp((clientY - rect.top) / rect.height, 0, 1),
        };
    }

    function startDrawingStroke(event: React.PointerEvent<HTMLDivElement>) {
        if (!drawingBlockId) return;
        const point = getDrawingPoint(event.clientX, event.clientY);
        if (!point) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        const stroke: DrawingStroke = {
            id: makeStoryboardId("link"),
            points: [point],
            color: brushColor,
            size: brushSize,
            opacity: brushOpacity,
            tool: drawTool,
        };
        activeStrokeRef.current = stroke;
        setActiveStroke(stroke);
    }

    function moveDrawingStroke(event: React.PointerEvent<HTMLDivElement>) {
        if (!activeStrokeRef.current) return;
        const point = getDrawingPoint(event.clientX, event.clientY);
        if (!point) return;
        event.preventDefault();
        event.stopPropagation();
        const stroke = activeStrokeRef.current;
        const last = stroke.points[stroke.points.length - 1];
        if (Math.abs(last.x - point.x) + Math.abs(last.y - point.y) < 0.0012) return;
        stroke.points.push(point);

        if (drawRafRef.current !== null) return;
        drawRafRef.current = window.requestAnimationFrame(() => {
            drawRafRef.current = null;
            const snapshot = activeStrokeRef.current;
            if (!snapshot) return;
            setActiveStroke({
                ...snapshot,
                points: [...snapshot.points],
            });
        });
    }

    function endDrawingStroke(event: React.PointerEvent<HTMLDivElement>) {
        if (!drawingBlockId) return;
        const finishedStroke = activeStrokeRef.current;
        if (!finishedStroke) return;
        event.preventDefault();
        event.stopPropagation();
        if (drawRafRef.current !== null) {
            window.cancelAnimationFrame(drawRafRef.current);
            drawRafRef.current = null;
        }
        if (finishedStroke.points.length >= 2) {
            if (finishedStroke.tool === "eraser") {
                writeDrawingData(
                    drawingBlockId,
                    eraseStrokesByPath(drawingStrokes, finishedStroke.points, (finishedStroke.size || brushSize) * 1.6)
                );
            } else {
                writeDrawingData(drawingBlockId, [...drawingStrokes, { ...finishedStroke, points: [...finishedStroke.points] }]);
            }
        }
        activeStrokeRef.current = null;
        setActiveStroke(null);
    }

    function clearDrawingForBlock(blockId: string) {
        writeDrawingData(blockId, []);
        activeStrokeRef.current = null;
        setActiveStroke(null);
    }

    function undoDrawingForBlock(blockId: string) {
        if (!drawingStrokes.length) return;
        writeDrawingData(blockId, drawingStrokes.slice(0, -1));
    }

    function addWireframe() {
        const primarySceneId = selectedBlock?.sceneId || orderedScenes[0]?.id || UNASSIGNED_SCENE_ID;
        const x = canvasSize.width ? (-offset.x + canvasSize.width / 2) / scale - 110 : 50;
        const y = canvasSize.height ? (-offset.y + canvasSize.height / 2) / scale - 70 : 50;
        const block = createWireframe(
            primarySceneId,
            blocks.length,
            x,
            y,
            storyboard.drawingLayoutDefault || "standard"
        );
        mutateStoryboard((prev) => ({ ...prev, blocks: [...(prev.blocks || []), block] }));
        setSelectedBlockId(block.id);
        setContextMenu({ open: false, x: 0, y: 0, blockId: null });
    }

    function duplicateBlock(block: StoryboardBlock) {
        const copy: StoryboardBlock = {
            ...block,
            id: makeStoryboardId("block"),
            x: block.x + 26,
            y: block.y + 26,
            sequenceIndex: blocks.length,
            detailForBlockId: undefined,
        };
        mutateStoryboard((prev) => ({ ...prev, blocks: [...(prev.blocks || []), copy] }));
        setSelectedBlockId(copy.id);
    }

    function addDetailsCard(parentBlockId: string) {
        const parent = blockById.get(parentBlockId);
        if (!parent || parent.blockKind === "details") return;

        const existing = (storyboardRef.current.blocks || []).find(
            (block) => block.blockKind === "details" && block.detailForBlockId === parent.id
        );
        if (existing) {
            setSelectedBlockId(existing.id);
            setShowInspector(true);
            return;
        }

        const detailsCard = createDetailsWireframe(parent, blocks.length);
        mutateStoryboard((prev) => ({
            ...prev,
            blocks: [...(prev.blocks || []), detailsCard],
            links: [
                ...(prev.links || []),
                {
                    id: makeStoryboardId("link"),
                    fromBlockId: parent.id,
                    toBlockId: detailsCard.id,
                    kind: "dependency",
                },
            ],
        }));
        setSelectedBlockId(detailsCard.id);
        setShowInspector(true);
    }

    function detachDetailsCard(blockId: string) {
        mutateStoryboard((prev) => ({
            ...prev,
            blocks: (prev.blocks || []).map((block) =>
                block.id === blockId ? { ...block, detailForBlockId: undefined } : block
            ),
            links: (prev.links || []).filter((link) => link.toBlockId !== blockId),
        }));
    }

    function removeBlock(blockId: string) {
        mutateStoryboard((prev) => ({
            ...prev,
            blocks: (prev.blocks || []).filter((block) => block.id !== blockId),
            links: (prev.links || []).filter((link) => link.fromBlockId !== blockId && link.toBlockId !== blockId),
            groups: (prev.groups || [])
                .map((group) => ({ ...group, blockIds: group.blockIds.filter((id) => id !== blockId) }))
                .filter((group) => group.blockIds.length > 0),
        }));
        if (selectedBlockId === blockId) {
            setSelectedBlockId(blocks.find((block) => block.id !== blockId)?.id || null);
        }
        setLinkDraft((prev) => (prev?.fromBlockId === blockId ? null : prev));
    }

    function applyShotPreset(blockId: string, preset: ShotPreset, customValue?: string) {
        mutateStoryboard((prev) => ({
            ...prev,
            blocks: (prev.blocks || []).map((block) =>
                block.id === blockId
                    ? {
                        ...block,
                        shotTypePreset: preset,
                        shotTypeCustom: preset === "custom" ? (customValue || block.shotTypeCustom || "") : undefined,
                    }
                    : block
            ),
        }));
    }

    function applyRole(blockId: string, type: StoryboardBlockType) {
        mutateStoryboard((prev) => ({
            ...prev,
            blocks: (prev.blocks || []).map((block) => (block.id === blockId ? { ...block, type } : block)),
        }));
    }

    function applyConnectionSequence(
        currentBlocks: StoryboardBlock[],
        fromBlockId: string,
        toBlockId: string
    ): StoryboardBlock[] {
        const fromBlock = currentBlocks.find((block) => block.id === fromBlockId);
        const toBlock = currentBlocks.find((block) => block.id === toBlockId);
        if (!fromBlock || !toBlock) return currentBlocks;
        if (fromBlock.isTextOnly || toBlock.isTextOnly) return currentBlocks;

        const sourceSeq = Number.isFinite(fromBlock.sequenceIndex) ? fromBlock.sequenceIndex || 0 : 0;
        const oldTargetSeq = Number.isFinite(toBlock.sequenceIndex)
            ? toBlock.sequenceIndex || 0
            : currentBlocks.length;
        const targetSeq = sourceSeq + 1;

        return currentBlocks.map((block) => {
            if (block.id === toBlockId) {
                return { ...block, sequenceIndex: targetSeq };
            }

            const seq = Number.isFinite(block.sequenceIndex) ? block.sequenceIndex || 0 : 0;
            let nextSeq = seq;

            if (oldTargetSeq > targetSeq) {
                if (seq >= targetSeq && seq < oldTargetSeq) nextSeq = seq + 1;
            } else if (oldTargetSeq < targetSeq) {
                if (seq > oldTargetSeq && seq <= targetSeq) nextSeq = seq - 1;
            }

            return nextSeq === seq ? block : { ...block, sequenceIndex: nextSeq };
        });
    }

    function connectBlocks(fromBlockId: string, toBlockId: string) {
        if (!fromBlockId || !toBlockId || fromBlockId === toBlockId) return;
        mutateStoryboard((prev) => {
            const fromBlock = (prev.blocks || []).find((block) => block.id === fromBlockId);
            const toBlock = (prev.blocks || []).find((block) => block.id === toBlockId);
            if (!fromBlock || !toBlock) return prev;

            const alreadyExists = (prev.links || []).some(
                (link) => link.fromBlockId === fromBlockId && link.toBlockId === toBlockId
            );
            const nextLinks = alreadyExists
                ? prev.links || []
                : [
                    ...(prev.links || []),
                    {
                        id: makeStoryboardId("link"),
                        fromBlockId,
                        toBlockId,
                        kind: "sequence" as const,
                    },
                ];

            return {
                ...prev,
                links: nextLinks,
                blocks: applyConnectionSequence(prev.blocks || [], fromBlockId, toBlockId),
            };
        });
    }

    function beginLinkFromBlock(block: StoryboardBlock) {
        const anchor = block.isTextOnly ? "bottom" : "right";
        const fromX = anchor === "right" ? block.x + block.w : block.x + block.w / 2;
        const fromY = anchor === "right" ? block.y + block.h / 2 : block.y + block.h;
        const previewX = anchor === "right" ? fromX + 72 : fromX;
        const previewY = anchor === "right" ? fromY : fromY + 72;

        setLinkDraft((prev) => {
            if (prev?.fromBlockId === block.id && prev.anchor === anchor) return null;
            return {
                fromBlockId: block.id,
                anchor,
                cursorX: previewX,
                cursorY: previewY,
            };
        });
    }

    function startMove(event: React.MouseEvent<HTMLElement>, block: StoryboardBlock) {
        event.preventDefault();
        event.stopPropagation();
        interactionRef.current = {
            mode: "move",
            blockId: block.id,
            startX: event.clientX,
            startY: event.clientY,
            blockX: block.x,
            blockY: block.y,
        };
    }

    function startResize(
        event: React.MouseEvent<HTMLButtonElement>,
        block: StoryboardBlock,
        axis: "xy" | "x" | "y" = "xy"
    ) {
        event.preventDefault();
        event.stopPropagation();
        interactionRef.current = {
            mode: "resize",
            blockId: block.id,
            startX: event.clientX,
            startY: event.clientY,
            blockW: block.w,
            blockH: block.h,
            axis,
        };
    }

    function startPan(event: React.MouseEvent<HTMLElement>) {
        if (event.button !== 0) return;
        const target = event.target as HTMLElement;
        if (
            target.closest("[data-wireframe]") ||
            target.closest("[data-connector]") ||
            target.closest("[data-selection-handle]") ||
            target.closest("[data-context-menu]") ||
            target.closest("button,input,select,textarea,a")
        ) {
            return;
        }
        interactionRef.current = {
            mode: "pan",
            startX: event.clientX,
            startY: event.clientY,
            offsetX: offset.x,
            offsetY: offset.y,
        };
        setSelectedBlockId(null);
        setSelectedAreaId(null);
        setContextMenu({ open: false, x: 0, y: 0, blockId: null });
    }

    function startAreaSelection(event: React.MouseEvent<HTMLElement>) {
        if (event.button !== 2) return;
        if (event.altKey) return;
        const target = event.target as HTMLElement;
        if (
            target.closest("aside,button,input,select,textarea,a,[data-context-menu]") ||
            target.closest("[data-wireframe]") ||
            target.closest("[data-connector]") ||
            target.closest("[data-selection-handle]")
        ) {
            return;
        }
        const point = toCanvasWorldPoint(event.clientX, event.clientY);
        if (!point) return;
        event.preventDefault();
        event.stopPropagation();
        setSelectionDraft({
            startX: point.x,
            startY: point.y,
            endX: point.x,
            endY: point.y,
        });
        setSelectedBlockId(null);
        setSelectedAreaId(null);
        setContextMenu({ open: false, x: 0, y: 0, blockId: null });
    }

    function updateSelectionAreaById(areaId: string, updates: Partial<StoryboardSelectionArea>) {
        mutateStoryboard((prev) => ({
            ...prev,
            selectionAreas: (prev.selectionAreas || []).map((area) =>
                area.id === areaId ? { ...area, ...updates } : area
            ),
        }));
    }

    function removeSelectionArea(areaId: string) {
        mutateStoryboard((prev) => ({
            ...prev,
            selectionAreas: (prev.selectionAreas || []).filter((area) => area.id !== areaId),
        }));
        setSelectedAreaId((prev) => (prev === areaId ? null : prev));
    }

    function clearSelectionAreas() {
        mutateStoryboard((prev) => ({
            ...prev,
            selectionAreas: [],
        }));
        setSelectedAreaId(null);
    }

    function startAreaResize(
        event: React.MouseEvent<HTMLButtonElement>,
        area: StoryboardSelectionArea,
        handle: "nw" | "ne" | "sw" | "se"
    ) {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        interactionRef.current = {
            mode: "area-resize",
            areaId: area.id,
            handle,
            startX: event.clientX,
            startY: event.clientY,
            areaX: area.x,
            areaY: area.y,
            areaW: area.w,
            areaH: area.h,
        };
        setSelectedAreaId(area.id);
        setSelectedBlockId(null);
    }

    function onWheel(event: React.WheelEvent<HTMLDivElement>) {
        event.preventDefault();
        if (event.ctrlKey || event.metaKey) {
            setScale((prev) => clamp(prev + (event.deltaY < 0 ? 0.08 : -0.08), 0.4, 2.1));
            return;
        }
        setOffset((prev) => ({ x: prev.x - event.deltaX, y: prev.y - event.deltaY }));
    }

    function toCanvasWorldPoint(clientX: number, clientY: number): { x: number; y: number } | null {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return null;
        return {
            x: (clientX - rect.left - offset.x) / scale,
            y: (clientY - rect.top - offset.y) / scale,
        };
    }

    function beginLinkDrag(blockId: string, event: React.MouseEvent<HTMLElement>) {
        event.preventDefault();
        event.stopPropagation();
        const block = blockById.get(blockId);
        if (!block) return;
        const anchor = block.isTextOnly ? "bottom" : "right";
        if (linkDraft?.fromBlockId === block.id && linkDraft.anchor === anchor) {
            setLinkDraft(null);
            return;
        }
        const point = toCanvasWorldPoint(event.clientX, event.clientY);
        if (!point) {
            beginLinkFromBlock(block);
            return;
        }
        setLinkDraft({
            fromBlockId: block.id,
            anchor,
            cursorX: point.x,
            cursorY: point.y,
        });
    }

    function removeLinksForBlock(blockId: string, mode: "outgoing" | "incoming" | "all") {
        mutateStoryboard((prev) => ({
            ...prev,
            links: (prev.links || []).filter((link) => {
                if (mode === "outgoing") return link.fromBlockId !== blockId;
                if (mode === "incoming") return link.toBlockId !== blockId;
                return link.fromBlockId !== blockId && link.toBlockId !== blockId;
            }),
        }));
        setLinkDraft((prev) => (prev?.fromBlockId === blockId ? null : prev));
    }

    function removeLinkById(linkId: string) {
        mutateStoryboard((prev) => ({
            ...prev,
            links: (prev.links || []).filter((link) => link.id !== linkId),
        }));
    }

    function saveAudioTrack() {
        const nextTrack: AudioTrack = {
            filePath: audioFilePath.trim(),
            duration: Math.max(0, Number(audioDuration) || 0),
            beatMarkers,
        };
        onUpdateProject({ audioTrack: nextTrack });
    }

    function applyAudioSuggestions() {
        const suggestionByScene = new Map(segmentSuggestions.map((entry) => [entry.sceneId, entry]));
        mutateStoryboard((prev) => ({
            ...prev,
            blocks: (prev.blocks || []).map((block) => {
                const suggestion = suggestionByScene.get(block.sceneId);
                if (!suggestion) return block;
                return {
                    ...block,
                    durationPlanSec: Number((suggestion.end - suggestion.start).toFixed(1)),
                    audioRef: {
                        ...(block.audioRef || {}),
                        startSec: Number(suggestion.start.toFixed(2)),
                        endSec: Number(suggestion.end.toFixed(2)),
                    },
                };
            }),
        }));

        if (!storyboard.autoDurationFromAudioEnabled) return;
        for (const suggestion of segmentSuggestions) {
            onUpdateScene(suggestion.sceneId, {
                estimatedDurationSec: Math.round(Math.max(0, suggestion.end - suggestion.start)),
            });
        }
    }

    function exportShotSheet() {
        saveTextAsFile(
            `${project.title.replace(/\s+/g, "-").toLowerCase()}-shot-sheet.csv`,
            rowsToShotSheetCsv(linearRows),
            "text/csv;charset=utf-8"
        );
    }

    function exportTeleprompter() {
        saveTextAsFile(
            `${project.title.replace(/\s+/g, "-").toLowerCase()}-teleprompter.txt`,
            teleprompterScript,
            "text/plain;charset=utf-8"
        );
    }

    function reapplySceneOrderFromTimeline() {
        const ordered = linearRows
            .filter((row) => !row.missingScene)
            .map((row) => row.sceneId)
            .filter((id, index, arr) => arr.indexOf(id) === index);
        if (!ordered.length) return;
        for (const scene of orderedScenes) {
            if (!ordered.includes(scene.id)) ordered.push(scene.id);
        }
        onReorderScenes(ordered);
    }

    const boardBounds = useMemo(() => {
        if (!blocks.length) return { minX: 0, minY: 0, width: 1600, height: 1000 };
        const minX = Math.min(...blocks.map((block) => block.x)) - 60;
        const minY = Math.min(...blocks.map((block) => block.y)) - 60;
        const maxX = Math.max(...blocks.map((block) => block.x + block.w)) + 60;
        const maxY = Math.max(...blocks.map((block) => block.y + block.h)) + 60;
        return { minX, minY, width: Math.max(600, maxX - minX), height: Math.max(480, maxY - minY) };
    }, [blocks]);

    const minimapScale = Math.min(220 / boardBounds.width, 130 / boardBounds.height);
    const visible = {
        x: (-offset.x) / scale,
        y: (-offset.y) / scale,
        w: canvasSize.width > 0 ? canvasSize.width / scale : 0,
        h: canvasSize.height > 0 ? canvasSize.height / scale : 0,
    };

    useEffect(() => {
        function syncFullscreenState() {
            setIsFullscreen(document.fullscreenElement === boardShellRef.current);
        }

        syncFullscreenState();
        document.addEventListener("fullscreenchange", syncFullscreenState);
        return () => {
            document.removeEventListener("fullscreenchange", syncFullscreenState);
        };
    }, []);

    async function toggleFullscreen() {
        try {
            if (document.fullscreenElement === boardShellRef.current) {
                await document.exitFullscreen();
                return;
            }

            await boardShellRef.current?.requestFullscreen();
        } catch (error) {
            console.error("Fullscreen request failed", error);
        }
    }

    return (
        <main ref={boardShellRef} className="h-full w-full overflow-hidden bg-zinc-100">
            <div className="h-full w-full relative">
                {onClose && (
                    <div className="absolute top-3 left-3 z-50">
                        <button
                            onClick={onClose}
                            className="rounded-full bg-zinc-900 text-white p-2.5 shadow-lg transition-all duration-200 hover:bg-zinc-700 hover:scale-[1.03]"
                            title="Back"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                )}

                <div className="absolute top-3 left-1/2 -translate-x-1/2 z-40 w-[min(1200px,calc(100%-7rem))]">
                    <div className="rounded-2xl bg-white/95 backdrop-blur border border-zinc-300 shadow-lg px-2 py-2 flex items-center gap-1 overflow-x-auto whitespace-nowrap">
                        {STORYBOARD_MODES.map((mode) => (
                            <button
                                key={mode}
                                onClick={() => setMode(mode)}
                                className={`text-[11px] px-2.5 py-1.5 rounded-full transition-colors ${activeMode === mode ? "bg-zinc-900 text-white" : "text-zinc-700 hover:bg-zinc-200"}`}
                            >
                                {MODE_LABELS[mode]}
                            </button>
                        ))}
                        {drawingModeEnabled &&
                            DRAWING_LAYOUT_MODES.map((layout) => (
                                <button
                                    key={layout}
                                    onClick={() => setDrawingLayout(layout)}
                                    className={`text-[11px] px-2.5 py-1.5 rounded-full transition-colors ${storyboard.drawingLayoutDefault === layout ? "bg-zinc-900 text-white" : "text-zinc-700 hover:bg-zinc-200"}`}
                                >
                                    {layout}
                                </button>
                            ))}
                        <div className="h-5 w-px bg-zinc-300 mx-1" />
                        <button
                            onClick={() => mutateStoryboard((prev) => ({ ...prev, gridSnap: !prev.gridSnap }))}
                            className={`text-[11px] px-2.5 py-1.5 rounded-full transition-colors ${storyboard.gridSnap ? "bg-zinc-900 text-white" : "text-zinc-700 hover:bg-zinc-200"}`}
                        >
                            Grid
                        </button>
                        <button
                            onClick={() => mutateStoryboard((prev) => ({ ...prev, showMiniMap: !prev.showMiniMap }))}
                            className={`text-[11px] px-2.5 py-1.5 rounded-full transition-colors ${storyboard.showMiniMap ? "bg-zinc-900 text-white" : "text-zinc-700 hover:bg-zinc-200"}`}
                        >
                            <MapIcon className="w-3 h-3 inline mr-1" />
                            Mini
                        </button>
                        <button
                            onClick={() => mutateStoryboard((prev) => autoAlignToSequence(prev, orderedScenes))}
                            className="text-[11px] px-2.5 py-1.5 rounded-full text-zinc-700 hover:bg-zinc-200 transition-colors"
                        >
                            <Grid3X3 className="w-3 h-3 inline mr-1" />
                            Align
                        </button>
                        <button
                            onClick={() => mutateStoryboard((prev) => resyncWithSceneOrder(prev, orderedScenes))}
                            className="text-[11px] px-2.5 py-1.5 rounded-full text-zinc-700 hover:bg-zinc-200 transition-colors"
                        >
                            <RefreshCw className="w-3 h-3 inline mr-1" />
                            Re-sync
                        </button>
                        <button
                            onClick={toggleFullscreen}
                            className="text-[11px] px-2.5 py-1.5 rounded-full text-zinc-700 hover:bg-zinc-200 transition-colors"
                            title={isFullscreen ? "Exit fullscreen" : "Open fullscreen"}
                        >
                            {isFullscreen ? (
                                <Minimize2 className="w-3 h-3 inline mr-1" />
                            ) : (
                                <Maximize2 className="w-3 h-3 inline mr-1" />
                            )}
                            {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
                        </button>
                    </div>
                    <div className="mt-1.5 rounded-xl bg-white/90 border border-zinc-300 px-3 py-1.5 text-[11px] text-zinc-600">
                        <span className="font-medium text-zinc-800">{MODE_LABELS[activeMode]} mode:</span> {modeHint}
                    </div>
                </div>

                <div className="absolute top-3 right-3 z-50 flex items-center gap-2">
                    {(activeMode === "image" || activeMode === "hybrid") && (
                        <button
                            onClick={() => {
                                if (!drawingModeEnabled) return;
                                setPencilEnabled((prev) => !prev);
                                setLinkDraft(null);
                            }}
                            disabled={!drawingModeEnabled}
                            className={`rounded-full border px-3 py-2 text-xs shadow-lg transition-all duration-200 hover:scale-[1.03] ${
                                !drawingModeEnabled
                                    ? "bg-zinc-100 text-zinc-400 border-zinc-200 cursor-not-allowed"
                                    : pencilEnabled
                                        ? "bg-zinc-900 text-white border-zinc-900"
                                        : "bg-white/95 text-zinc-700 border-zinc-300 hover:bg-white"
                            }`}
                            title={drawingModeEnabled ? "Pencil mode" : "Enable Drawing or Hybrid mode"}
                        >
                            <Pencil className="w-3.5 h-3.5 inline mr-1" />
                            Draw
                        </button>
                    )}
                    {activeMode === "text" && (
                        <button
                            onClick={() => {
                                if (!selectedBlockId) return;
                                openTextCard(selectedBlockId);
                            }}
                            disabled={!selectedBlockId}
                            className={`rounded-full border px-3 py-2 text-xs shadow-lg transition-all duration-200 hover:scale-[1.03] ${
                                selectedBlockId
                                    ? "bg-white/95 text-zinc-700 border-zinc-300 hover:bg-white"
                                    : "bg-zinc-100 text-zinc-400 border-zinc-200 cursor-not-allowed"
                            }`}
                            title="Open text card for selected wireframe"
                        >
                            <FileText className="w-3.5 h-3.5 inline mr-1" />
                            Text Card
                        </button>
                    )}
                    {activeMode === "audio" && (
                        <button
                            onClick={() => {
                                if (!selectedBlockId) return;
                                openAudioCard(selectedBlockId);
                            }}
                            disabled={!selectedBlockId}
                            className={`rounded-full border px-3 py-2 text-xs shadow-lg transition-all duration-200 hover:scale-[1.03] ${
                                selectedBlockId
                                    ? "bg-white/95 text-zinc-700 border-zinc-300 hover:bg-white"
                                    : "bg-zinc-100 text-zinc-400 border-zinc-200 cursor-not-allowed"
                            }`}
                            title="Open audio card for selected wireframe"
                        >
                            <Music2 className="w-3.5 h-3.5 inline mr-1" />
                            Audio Card
                        </button>
                    )}
                    <button
                        onClick={() => setShowInspector((prev) => !prev)}
                        className="rounded-full bg-white/95 border border-zinc-300 px-3 py-2 text-xs text-zinc-700 shadow-lg transition-all duration-200 hover:bg-white hover:scale-[1.03]"
                    >
                        Inspector
                    </button>
                    <div className="rounded-full bg-white/95 border border-zinc-300 px-3 py-2 text-[11px] text-zinc-700 shadow-lg">
                        Zoom {Math.round(scale * 100)}%
                    </div>
                </div>
                {selectedArea && (
                    <div className="absolute top-14 right-3 z-50 w-[300px] rounded-xl border border-zinc-300 bg-white/95 backdrop-blur p-3 shadow-xl space-y-2">
                        <div className="flex items-center justify-between">
                            <p className="text-xs font-medium text-zinc-700">Selected Area</p>
                            <button
                                className="text-[11px] text-zinc-500 hover:text-zinc-700"
                                onClick={() => setSelectedAreaId(null)}
                            >
                                Deselect
                            </button>
                        </div>
                        <input
                            className="input-field text-xs"
                            value={selectedArea.title || ""}
                            onChange={(event) =>
                                updateSelectionAreaById(selectedArea.id, { title: event.target.value })
                            }
                            placeholder="Area title"
                        />
                        <div className="grid grid-cols-[1fr_auto] gap-2">
                            <input
                                type="color"
                                value={selectedArea.color || "#60a5fa"}
                                onChange={(event) =>
                                    updateSelectionAreaById(selectedArea.id, { color: event.target.value })
                                }
                                className="h-9 w-full rounded border border-zinc-300 bg-white"
                            />
                            <button
                                className="btn-ghost text-xs px-2 py-1.5"
                                onClick={() => {
                                    const copy: StoryboardSelectionArea = {
                                        ...selectedArea,
                                        id: makeStoryboardId("group"),
                                        x: selectedArea.x + 24,
                                        y: selectedArea.y + 24,
                                        title: `${selectedArea.title || "Area"} Copy`,
                                    };
                                    mutateStoryboard((prev) => ({
                                        ...prev,
                                        selectionAreas: [...(prev.selectionAreas || []), copy],
                                    }));
                                    setSelectedAreaId(copy.id);
                                }}
                            >
                                Duplicate
                            </button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                className="btn-ghost text-xs px-2 py-1.5 text-red-600"
                                onClick={() => removeSelectionArea(selectedArea.id)}
                            >
                                Remove Area
                            </button>
                            <button
                                className="btn-ghost text-xs px-2 py-1.5 text-red-600"
                                onClick={clearSelectionAreas}
                            >
                                Clear All Areas
                            </button>
                        </div>
                    </div>
                )}

                {renderMode === "canvas" && (
                    <section
                        className="h-full w-full relative overflow-hidden"
                        ref={canvasRef}
                        onWheel={onWheel}
                        onMouseDown={startPan}
                        onMouseDownCapture={startAreaSelection}
                        onContextMenu={(event) => event.preventDefault()}
                    >
                            <div
                                className="absolute inset-0 cursor-grab active:cursor-grabbing"
                                style={{
                                    backgroundColor: "#ffffff",
                                    background:
                                        "radial-gradient(circle at top left, rgba(34,211,238,0.15), transparent 26%), radial-gradient(circle at bottom right, rgba(59,130,246,0.14), transparent 24%), linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%)",
                                    backgroundImage: storyboard.gridSnap
                                        ? "linear-gradient(to right, rgba(15,23,42,0.07) 1px, transparent 1px), linear-gradient(to bottom, rgba(15,23,42,0.07) 1px, transparent 1px)"
                                        : undefined,
                                    backgroundSize: storyboard.gridSnap ? `${CANVAS_GRID_SIZE}px ${CANVAS_GRID_SIZE}px` : undefined,
                                }}
                            />

                            <div
                                className="absolute left-0 top-0"
                                style={{
                                    width: 5200,
                                    height: 3200,
                                    transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                                    transformOrigin: "0 0",
                                }}
                            >
                                {(selectionAreas.length > 0 || selectionDraft) && (
                                    <div className="absolute inset-0 z-[1] pointer-events-none">
                                        {selectionAreas.map((area) => {
                                            const color = area.color || "#60a5fa";
                                            const isSelected = selectedAreaId === area.id;
                                            return (
                                                <div
                                                    key={area.id}
                                                    data-selection-area="true"
                                                    className="absolute rounded-lg border pointer-events-none"
                                                    style={{
                                                        left: area.x,
                                                        top: area.y,
                                                        width: area.w,
                                                        height: area.h,
                                                        borderColor: color,
                                                        backgroundColor: colorWithAlpha(color, 0.12),
                                                        boxShadow: isSelected
                                                            ? `0 0 0 2px ${colorWithAlpha(color, 0.35)}`
                                                            : "none",
                                                    }}
                                                >
                                                    <div
                                                        className="absolute left-2 top-1 text-[10px] font-medium px-1.5 py-0.5 rounded pointer-events-auto cursor-default"
                                                        style={{
                                                            backgroundColor: colorWithAlpha(color, 0.2),
                                                            color: "#111827",
                                                        }}
                                                        onContextMenu={(event) => {
                                                            event.preventDefault();
                                                            event.stopPropagation();
                                                            setSelectedAreaId(area.id);
                                                            setSelectedBlockId(null);
                                                        }}
                                                    >
                                                        {area.title || "Selection"}
                                                    </div>
                                                    {isSelected && (
                                                        <>
                                                            <button
                                                                data-selection-handle="nw"
                                                                className="absolute -left-2 -top-2 w-3.5 h-3.5 rounded-sm border border-zinc-700 bg-white pointer-events-auto"
                                                                onMouseDown={(event) => startAreaResize(event, area, "nw")}
                                                                title="Resize area"
                                                            />
                                                            <button
                                                                data-selection-handle="ne"
                                                                className="absolute -right-2 -top-2 w-3.5 h-3.5 rounded-sm border border-zinc-700 bg-white pointer-events-auto"
                                                                onMouseDown={(event) => startAreaResize(event, area, "ne")}
                                                                title="Resize area"
                                                            />
                                                            <button
                                                                data-selection-handle="sw"
                                                                className="absolute -left-2 -bottom-2 w-3.5 h-3.5 rounded-sm border border-zinc-700 bg-white pointer-events-auto"
                                                                onMouseDown={(event) => startAreaResize(event, area, "sw")}
                                                                title="Resize area"
                                                            />
                                                            <button
                                                                data-selection-handle="se"
                                                                className="absolute -right-2 -bottom-2 w-3.5 h-3.5 rounded-sm border border-zinc-700 bg-white pointer-events-auto"
                                                                onMouseDown={(event) => startAreaResize(event, area, "se")}
                                                                title="Resize area"
                                                            />
                                                        </>
                                                    )}
                                                </div>
                                            );
                                        })}
                                        {selectionDraft && (
                                            <div
                                                className="absolute rounded-lg border-2 border-dashed border-blue-500 bg-blue-100/30"
                                                style={{
                                                    left: Math.min(selectionDraft.startX, selectionDraft.endX),
                                                    top: Math.min(selectionDraft.startY, selectionDraft.endY),
                                                    width: Math.abs(selectionDraft.endX - selectionDraft.startX),
                                                    height: Math.abs(selectionDraft.endY - selectionDraft.startY),
                                                }}
                                            />
                                        )}
                                    </div>
                                )}
                                {storyboard.showLinks !== false && (
                                    <svg className="absolute inset-0 z-20 pointer-events-none" width={5200} height={3200}>
                                        <defs>
                                            <marker
                                                id="sb-arrow-head-connected"
                                                viewBox="0 0 10 10"
                                                refX="9"
                                                refY="5"
                                                markerWidth="7"
                                                markerHeight="7"
                                                orient="auto-start-reverse"
                                            >
                                                <path d="M 0 0 L 10 5 L 0 10 z" fill="#1f2937" />
                                            </marker>
                                            <marker
                                                id="sb-arrow-head-draft"
                                                viewBox="0 0 10 10"
                                                refX="8"
                                                refY="5"
                                                markerWidth="6"
                                                markerHeight="6"
                                                orient="auto-start-reverse"
                                            >
                                                <path d="M 0 0 L 10 5 L 0 10 z" fill="#4b5563" />
                                            </marker>
                                        </defs>
                                        {links.map((link) => {
                                            const from = blockById.get(link.fromBlockId);
                                            const to = blockById.get(link.toBlockId);
                                            if (!from || !to) return null;
                                            const fromCenterX = from.x + from.w / 2;
                                            const fromCenterY = from.y + from.h / 2;
                                            const toCenterX = to.x + to.w / 2;
                                            const toCenterY = to.y + to.h / 2;
                                            const deltaX = toCenterX - fromCenterX;
                                            const deltaY = toCenterY - fromCenterY;
                                            const mostlyHorizontal = Math.abs(deltaX) >= Math.abs(deltaY);
                                            const endPad = 3;
                                            let x1 = from.x + from.w;
                                            let y1 = fromCenterY;
                                            let x2 = to.x - endPad;
                                            let y2 = toCenterY;

                                            if (from.isTextOnly) {
                                                x1 = fromCenterX;
                                                y1 = deltaY >= 0 ? from.y + from.h : from.y;
                                            } else if (!mostlyHorizontal) {
                                                x1 = fromCenterX;
                                                y1 = deltaY >= 0 ? from.y + from.h : from.y;
                                            } else if (deltaX < 0) {
                                                x1 = from.x;
                                            }

                                            if (to.isTextOnly) {
                                                x2 = toCenterX;
                                                y2 = deltaY >= 0 ? to.y - endPad : to.y + to.h + endPad;
                                            } else if (!mostlyHorizontal) {
                                                x2 = toCenterX;
                                                y2 = deltaY >= 0 ? to.y - endPad : to.y + to.h + endPad;
                                            } else if (deltaX < 0) {
                                                x2 = to.x + to.w + endPad;
                                            }

                                            const dx = Math.abs(x2 - x1);
                                            const dy = Math.abs(y2 - y1);
                                            const horizontalFlow = dx >= dy;
                                            const c1x = horizontalFlow
                                                ? x1 + Math.max(30, dx * 0.35) * (x2 >= x1 ? 1 : -1)
                                                : x1;
                                            const c1y = horizontalFlow
                                                ? y1
                                                : y1 + Math.max(30, dy * 0.35) * (y2 >= y1 ? 1 : -1);
                                            const c2x = horizontalFlow
                                                ? x2 - Math.max(30, dx * 0.35) * (x2 >= x1 ? 1 : -1)
                                                : x2;
                                            const c2y = horizontalFlow
                                                ? y2
                                                : y2 - Math.max(30, dy * 0.35) * (y2 >= y1 ? 1 : -1);
                                            const d = `M ${x1} ${y1} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y2}`;
                                            return (
                                                <g key={link.id}>
                                                    <path
                                                    d={d}
                                                    stroke="#4b5563"
                                                    strokeWidth="2"
                                                    fill="none"
                                                    markerEnd="url(#sb-arrow-head-connected)"
                                                    strokeLinecap="round"
                                                    opacity={0.9}
                                                    pointerEvents="none"
                                                />
                                                </g>
                                            );
                                        })}
                                        {linkDraft && (() => {
                                            const source = blockById.get(linkDraft.fromBlockId);
                                            if (!source) return null;
                                            const sx =
                                                linkDraft.anchor === "right"
                                                    ? source.x + source.w
                                                    : source.x + source.w / 2;
                                            const sy =
                                                linkDraft.anchor === "right"
                                                    ? source.y + source.h / 2
                                                    : source.y + source.h;
                                            const ex = linkDraft.cursorX;
                                            const ey = linkDraft.cursorY;
                                            const dx = Math.abs(ex - sx);
                                            const dy = Math.abs(ey - sy);
                                            const c1x =
                                                linkDraft.anchor === "right"
                                                    ? sx + Math.max(22, dx * 0.35) * (ex >= sx ? 1 : -1)
                                                    : sx;
                                            const c1y =
                                                linkDraft.anchor === "right"
                                                    ? sy
                                                    : sy + Math.max(22, dy * 0.35) * (ey >= sy ? 1 : -1);
                                            const c2x =
                                                linkDraft.anchor === "right"
                                                    ? ex - Math.max(22, dx * 0.35) * (ex >= sx ? 1 : -1)
                                                    : ex;
                                            const c2y =
                                                linkDraft.anchor === "right"
                                                    ? ey
                                                    : ey - Math.max(22, dy * 0.35) * (ey >= sy ? 1 : -1);
                                            const d = `M ${sx} ${sy} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${ex} ${ey}`;
                                            return (
                                                <path
                                                    d={d}
                                                    stroke="#2563eb"
                                                    strokeWidth="2.2"
                                                    fill="none"
                                                    markerEnd="url(#sb-arrow-head-draft)"
                                                    strokeDasharray="4 4"
                                                    opacity={0.95}
                                                    pointerEvents="none"
                                                />
                                            );
                                        })()}
                                    </svg>
                                )}
                                {blocks.map((block) => {
                                    const color = ROLE_COLORS[block.type];
                                    const isDetailsCard = block.blockKind === "details";
                                    const sceneTitle =
                                        orderedScenes.find((scene) => scene.id === block.sceneId)?.title ||
                                        "Unassigned scene";
                                    const blockTitle = isDetailsCard ? "FILMING DETAILS" : block.category || block.type.toUpperCase();
                                    const blockSummary = block.notes?.trim() || "Build the camera move, framing, and story beat here.";
                                    const blockTags = (block.tags || []).slice(0, 2);
                                    const blockDuration = block.durationPlanSec
                                        ? formatDuration(Math.round(block.durationPlanSec))
                                        : "Draft";
                                    const linkedAsset = block.visualAssetId
                                        ? assets.find((asset) => asset.id === block.visualAssetId)
                                        : undefined;
                                    const drawingPreviewStrokes = parseDrawingData(block.drawingData);
                                    const incomingLinks = links.filter((link) => link.toBlockId === block.id);
                                    const latestIncomingLink =
                                        incomingLinks.length > 0
                                            ? incomingLinks[incomingLinks.length - 1]
                                            : null;
                                    const showDropTarget =
                                        Boolean(linkDraft) && linkDraft?.fromBlockId !== block.id;
                                    return (
                                        <article
                                            key={block.id}
                                            data-wireframe="true"
                                            className={`absolute overflow-visible cursor-move transition-[box-shadow,border-color,transform,background] duration-200 ${selectedBlockId === block.id ? "scale-[1.01]" : "hover:-translate-y-1 hover:scale-[1.01]"}`}
                                            style={{
                                                left: block.x,
                                                top: block.y,
                                                width: block.w,
                                                height: block.h,
                                                borderRadius: 24,
                                                border: `1px solid ${selectedBlockId === block.id ? color : `${color}55`}`,
                                                background:
                                                    "linear-gradient(180deg, rgba(255,255,255,0.96) 0%, rgba(244,247,255,0.92) 100%)",
                                                boxShadow:
                                                    selectedBlockId === block.id
                                                        ? `0 22px 56px rgba(15,23,42,0.28), 0 0 0 1px ${color}44`
                                                        : "0 18px 40px rgba(15,23,42,0.18)",
                                            }}
                                            onMouseDown={(event) => {
                                                if (event.button !== 0) return;
                                                const target = event.target as HTMLElement;
                                                if (target.closest("button,input,select,textarea,a")) return;
                                                const currentDraft = linkDraft;
                                                if (currentDraft) {
                                                    event.stopPropagation();
                                                    if (currentDraft.fromBlockId !== block.id) {
                                                        connectBlocks(currentDraft.fromBlockId, block.id);
                                                        setLinkDraft(null);
                                                    }
                                                    return;
                                                }
                                                event.stopPropagation();
                                                setSelectedBlockId(block.id);
                                                setSelectedAreaId(null);
                                                setShowInspector(true);
                                                startMove(event, block);
                                            }}
                                            onDoubleClick={(event) => {
                                                const target = event.target as HTMLElement;
                                                if (target.closest("button,input,select,textarea,a")) return;
                                                event.stopPropagation();
                                                setSelectedBlockId(block.id);
                                                setSelectedAreaId(null);
                                                setShowInspector(true);
                                                openModeCardForBlock(block.id);
                                            }}
                                            onContextMenu={(event) => {
                                                if (!event.altKey) return;
                                                event.preventDefault();
                                                event.stopPropagation();
                                                setSelectedBlockId(block.id);
                                                setShowInspector(true);
                                                setContextMenu({
                                                    open: true,
                                                    x: event.clientX,
                                                    y: event.clientY,
                                                    blockId: block.id,
                                                });
                                            }}
                                            onMouseUp={(event) => {
                                                const currentDraft = linkDraft;
                                                if (!currentDraft) return;
                                                event.stopPropagation();
                                                if (currentDraft.fromBlockId !== block.id) {
                                                    connectBlocks(currentDraft.fromBlockId, block.id);
                                                    setLinkDraft(null);
                                                }
                                            }}
                                        >
                                            <div className="relative h-full overflow-hidden rounded-[inherit]">
                                                <div
                                                    className="absolute inset-0 opacity-90"
                                                    style={{
                                                        background: `radial-gradient(circle at top left, ${color}33, transparent 34%), linear-gradient(180deg, rgba(255,255,255,0.72) 0%, rgba(255,255,255,0.08) 100%)`,
                                                    }}
                                                />
                                                <div className="absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-2 px-3 py-3">
                                                    <div className="min-w-0">
                                                        <div
                                                            className="inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-900"
                                                            style={{
                                                                backgroundColor: `${color}22`,
                                                                boxShadow: `inset 0 0 0 1px ${color}55`,
                                                            }}
                                                        >
                                                            {blockTitle}
                                                        </div>
                                                        <p className="mt-2 truncate text-sm font-semibold text-slate-900">
                                                            {isDetailsCard ? "Technical Direction Card" : sceneTitle}
                                                        </p>
                                                    </div>
                                                    <div className="rounded-full bg-slate-950/90 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-white shadow-lg">
                                                        {blockDuration}
                                                    </div>
                                                </div>

                                                {block.isTextOnly ? (
                                                    <div className="flex h-full w-full flex-col justify-between bg-[linear-gradient(180deg,rgba(255,255,255,0.92)_0%,rgba(240,249,255,0.9)_100%)] px-3 pb-3 pt-16">
                                                        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">
                                                            {isDetailsCard ? "Director Note Card" : "Text card"}
                                                        </p>
                                                        <p className="mt-2 text-[12px] leading-snug text-slate-700 line-clamp-[8]">
                                                            {block.notes ||
                                                                (isDetailsCard
                                                                    ? "Capture full filming instructions here: framing, angle, movement, color, lighting, lens, and location."
                                                                    : "Add text notes, VO beats, or motion cues.")}
                                                        </p>
                                                    </div>
                                                ) : activeMode === "text" ? (
                                                    <div className="flex h-full w-full flex-col justify-between bg-[linear-gradient(180deg,rgba(255,255,255,0.95)_0%,rgba(239,246,255,0.92)_100%)] px-3 pb-3 pt-16">
                                                        <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                                                            {block.category || "text plan"}
                                                        </p>
                                                        <p className="mt-2 text-[12px] leading-snug text-slate-800 line-clamp-[8]">
                                                            {blockSummary}
                                                        </p>
                                                        {blockTags.length > 0 && (
                                                            <div className="mt-3 flex flex-wrap gap-1.5">
                                                                {blockTags.map((tag) => (
                                                                    <span
                                                                        key={`${block.id}-${tag}`}
                                                                        className="rounded-full bg-slate-900/6 px-2 py-1 text-[10px] text-slate-600"
                                                                    >
                                                                        {tag}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <>
                                                        {linkedAsset?.mimeType.startsWith("image/") ? (
                                                            // eslint-disable-next-line @next/next/no-img-element
                                                            <img
                                                                alt={linkedAsset.name}
                                                                src={`/api/projects/${project.id}/assets/${linkedAsset.id}/content`}
                                                                className="w-full h-full object-cover"
                                                                draggable={false}
                                                            />
                                                        ) : (
                                                            <div className="h-full w-full bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.7),transparent_36%),linear-gradient(180deg,#cbd5e1_0%,#94a3b8_100%)]" />
                                                        )}
                                                        {drawingPreviewStrokes.length > 0 && (
                                                            <svg
                                                                className="absolute inset-0"
                                                                viewBox="0 0 100 100"
                                                                preserveAspectRatio="none"
                                                                pointerEvents="none"
                                                            >
                                                                {drawingPreviewStrokes.map((stroke) => (
                                                                    <polyline
                                                                        key={stroke.id}
                                                                        points={toPolylinePoints(stroke.points)}
                                                                        fill="none"
                                                                        stroke={stroke.tool === "eraser" ? "#ffffff" : stroke.color || "#111827"}
                                                                        strokeOpacity={stroke.opacity ?? 1}
                                                                        strokeWidth={Math.max(0.45, (stroke.size || 2) * 0.4)}
                                                                        strokeLinecap="round"
                                                                        strokeLinejoin="round"
                                                                    />
                                                                ))}
                                                            </svg>
                                                        )}
                                                        <div className="absolute inset-x-0 bottom-0 z-10 border-t border-slate-200/90 bg-white/96 px-3 py-2">
                                                            <div className="flex items-start justify-between gap-3">
                                                                <div className="min-w-0">
                                                                    <p className="truncate text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-700">
                                                                        Description
                                                                    </p>
                                                                    <p className="mt-1 text-[11px] leading-snug text-slate-700 line-clamp-2">
                                                                        {blockSummary}
                                                                    </p>
                                                                </div>
                                                                <div className="shrink-0 rounded-full border border-slate-300 bg-slate-100 px-2 py-1 text-[10px] text-slate-700">
                                                                    {linkedAsset ? "Linked" : "Concept"}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </>
                                                )}

                                                {!block.isTextOnly && (
                                                    <button
                                                        data-connector="right"
                                                        onMouseDown={(event) => beginLinkDrag(block.id, event)}
                                                        className="absolute -right-3 top-1/2 z-20 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 shadow-lg transition-colors hover:bg-slate-50"
                                                        title="Drag to connect"
                                                    >
                                                        <ArrowRight className="w-3.5 h-3.5" />
                                                    </button>
                                                )}
                                                {(showDropTarget || latestIncomingLink) && (
                                                    <button
                                                        data-connector="left"
                                                        onMouseDown={(event) => event.stopPropagation()}
                                                        onMouseUp={(event) => event.stopPropagation()}
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            const currentDraft = linkDraft;
                                                            if (showDropTarget && currentDraft) {
                                                                connectBlocks(currentDraft.fromBlockId, block.id);
                                                                setLinkDraft(null);
                                                                return;
                                                            }
                                                            if (latestIncomingLink) {
                                                                removeLinkById(latestIncomingLink.id);
                                                            }
                                                        }}
                                                        className={`absolute -left-3 top-1/2 z-20 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border shadow-lg ${showDropTarget ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
                                                        title={showDropTarget ? "Drop connection" : "Disconnect incoming arrow"}
                                                    >
                                                        <ArrowLeft className="w-3.5 h-3.5" />
                                                    </button>
                                                )}
                                                {block.isTextOnly && (
                                                    <button
                                                        data-connector="bottom"
                                                        onMouseDown={(event) => beginLinkDrag(block.id, event)}
                                                        className="absolute bottom-[-12px] left-1/2 z-20 flex h-7 w-7 -translate-x-1/2 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 shadow-lg transition-colors hover:bg-slate-50"
                                                        title="Drag to connect"
                                                    >
                                                        <ArrowDown className="w-3.5 h-3.5" />
                                                    </button>
                                                )}
                                            </div>


                                            <button
                                                className="absolute bottom-1 right-1 h-3 w-3 rounded-sm border border-white/50 bg-slate-950/70"
                                                onMouseDown={(event) => startResize(event, block, "xy")}
                                                title="Resize"
                                            />
                                            <button
                                                className="absolute right-0 top-1/2 h-8 w-2.5 -translate-y-1/2 rounded-l border-l border-white/40 bg-slate-950/60"
                                                onMouseDown={(event) => startResize(event, block, "x")}
                                                title="Stretch width"
                                            />
                                            <button
                                                className="absolute bottom-0 left-1/2 h-2.5 w-8 -translate-x-1/2 rounded-t border-t border-white/40 bg-slate-950/60"
                                                onMouseDown={(event) => startResize(event, block, "y")}
                                                title="Stretch height"
                                            />
                                        </article>
                                    );
                                })}
                            </div>

                            {storyboard.showMiniMap && (
                                <div className="absolute right-3 bottom-16 z-30 bg-white/95 border border-zinc-300 rounded-lg p-2 shadow w-[236px]">
                                    <div className="relative rounded bg-zinc-100" style={{ width: 220, height: 130 }}>
                                        {blocks.map((block) => (
                                            <div
                                                key={`mini-${block.id}`}
                                                className="absolute rounded-sm"
                                                style={{
                                                    left: (block.x - boardBounds.minX) * minimapScale,
                                                    top: (block.y - boardBounds.minY) * minimapScale,
                                                    width: Math.max(2, block.w * minimapScale),
                                                    height: Math.max(2, block.h * minimapScale),
                                                    backgroundColor: "#9ca3af55",
                                                    border: `1px solid ${ROLE_COLORS[block.type]}`,
                                                }}
                                            />
                                        ))}
                                        <div
                                            className="absolute border border-blue-600"
                                            style={{
                                                left: (visible.x - boardBounds.minX) * minimapScale,
                                                top: (visible.y - boardBounds.minY) * minimapScale,
                                                width: Math.max(4, visible.w * minimapScale),
                                                height: Math.max(4, visible.h * minimapScale),
                                            }}
                                        />
                                    </div>
                                </div>
                            )}

                            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40">
                                <button onClick={addWireframe} className="rounded-full bg-zinc-900 text-white px-5 py-2.5 shadow-xl hover:bg-zinc-700 hover:scale-[1.02] transition-all duration-200 text-sm font-medium">
                                    <Plus className="w-4 h-4 inline mr-1" />
                                    Add Wireframe
                                </button>
                            </div>

                            {contextMenu.open && contextMenu.blockId && (
                                <div
                                    data-context-menu="true"
                                    className="fixed z-50 w-60 rounded-lg border border-zinc-300 bg-white shadow-xl p-2 text-xs text-zinc-800"
                                    style={{ left: contextMenu.x, top: contextMenu.y }}
                                    onClick={(event) => event.stopPropagation()}
                                >
                                    <p className="text-zinc-500 px-1 pb-1">Set type of shot/scene</p>
                                    <div className="grid grid-cols-2 gap-1">
                                        {SHOT_PRESETS.map((preset) => (
                                            <button
                                                key={preset.value}
                                                onClick={() => {
                                                    if (preset.value !== "custom") {
                                                        applyShotPreset(contextMenu.blockId || "", preset.value);
                                                        setContextMenu({ open: false, x: 0, y: 0, blockId: null });
                                                    } else {
                                                        setCustomShotValue("");
                                                    }
                                                }}
                                                className="px-2 py-1 rounded border border-zinc-300 text-left text-zinc-800 hover:bg-zinc-100"
                                            >
                                                {preset.label}
                                            </button>
                                        ))}
                                    </div>
                                    <div className="mt-2 flex flex-wrap gap-1">
                                        <input
                                            value={customShotValue}
                                            onChange={(event) => setCustomShotValue(event.target.value)}
                                            className="input-field text-xs text-zinc-900"
                                            placeholder="Custom shot"
                                        />
                                        <button
                                            onClick={() => {
                                                applyShotPreset(contextMenu.blockId || "", "custom", customShotValue.trim() || "Custom");
                                                setContextMenu({ open: false, x: 0, y: 0, blockId: null });
                                            }}
                                            className="btn-ghost px-2 py-1 text-zinc-800"
                                        >
                                            Save
                                        </button>
                                    </div>

                                    <p className="text-zinc-500 px-1 pt-2 pb-1">Set planning role</p>
                                    <div className="grid grid-cols-2 gap-1">
                                        {ROLE_OPTIONS.map((role) => (
                                            <button
                                                key={role.value}
                                                onClick={() => {
                                                    applyRole(contextMenu.blockId || "", role.value);
                                                    setContextMenu({ open: false, x: 0, y: 0, blockId: null });
                                                }}
                                                className="px-2 py-1 rounded border border-zinc-300 text-left text-zinc-800 hover:bg-zinc-100"
                                            >
                                                {role.label}
                                            </button>
                                        ))}
                                    </div>

                                    <p className="text-zinc-500 px-1 pt-2 pb-1">Category</p>
                                    <div className="grid grid-cols-2 gap-1">
                                        {CATEGORY_OPTIONS.map((category) => (
                                            <button
                                                key={category}
                                                onClick={() => {
                                                    updateBlockById(contextMenu.blockId || "", { category });
                                                    setContextMenu({ open: false, x: 0, y: 0, blockId: null });
                                                }}
                                                className="px-2 py-1 rounded border border-zinc-300 text-left text-zinc-800 hover:bg-zinc-100"
                                            >
                                                {category}
                                            </button>
                                        ))}
                                    </div>
                                    <div className="mt-2 flex gap-1">
                                        <input
                                            value={customCategoryValue}
                                            onChange={(event) => setCustomCategoryValue(event.target.value)}
                                            className="input-field text-xs text-zinc-900"
                                            placeholder="Custom category"
                                        />
                                        <button
                                            onClick={() => {
                                                updateBlockById(contextMenu.blockId || "", {
                                                    category: customCategoryValue.trim() || "general",
                                                });
                                                setContextMenu({ open: false, x: 0, y: 0, blockId: null });
                                            }}
                                            className="btn-ghost px-2 py-1 text-zinc-800"
                                        >
                                            Save
                                        </button>
                                    </div>

                                    <div className="mt-2 flex gap-1">
                                        <button
                                            onClick={() => {
                                                const block = blocks.find((entry) => entry.id === contextMenu.blockId);
                                                if (block) duplicateBlock(block);
                                                setContextMenu({ open: false, x: 0, y: 0, blockId: null });
                                            }}
                                            className="btn-ghost text-[11px] px-2 py-1 text-zinc-800"
                                        >
                                            Duplicate
                                        </button>
                                        <button
                                            onClick={() => {
                                                if (contextMenu.blockId) {
                                                    const target = blockById.get(contextMenu.blockId);
                                                    if (target) beginLinkFromBlock(target);
                                                }
                                                setContextMenu({ open: false, x: 0, y: 0, blockId: null });
                                            }}
                                            className="btn-ghost text-[11px] px-2 py-1 text-zinc-800"
                                        >
                                            Toggle Link
                                        </button>
                                        <button
                                            onClick={() => {
                                                if (contextMenu.blockId) removeLinksForBlock(contextMenu.blockId, "outgoing");
                                                setContextMenu({ open: false, x: 0, y: 0, blockId: null });
                                            }}
                                            className="btn-ghost text-[11px] px-2 py-1 text-zinc-800"
                                        >
                                            Remove Out Arrow
                                        </button>
                                        <button
                                            onClick={() => {
                                                if (contextMenu.blockId) removeLinksForBlock(contextMenu.blockId, "incoming");
                                                setContextMenu({ open: false, x: 0, y: 0, blockId: null });
                                            }}
                                            className="btn-ghost text-[11px] px-2 py-1 text-zinc-800"
                                        >
                                            Remove In Arrow
                                        </button>
                                        <button
                                            onClick={() => {
                                                if (contextMenu.blockId) removeLinksForBlock(contextMenu.blockId, "all");
                                                setContextMenu({ open: false, x: 0, y: 0, blockId: null });
                                            }}
                                            className="btn-ghost text-[11px] px-2 py-1 text-zinc-800"
                                        >
                                            Remove All Arrows
                                        </button>
                                        <button
                                            onClick={() => {
                                                updateBlockById(contextMenu.blockId || "", { isTextOnly: true });
                                                setContextMenu({ open: false, x: 0, y: 0, blockId: null });
                                            }}
                                            className="btn-ghost text-[11px] px-2 py-1 text-zinc-800"
                                        >
                                            Text Box
                                        </button>
                                        <button
                                            onClick={() => {
                                                updateBlockById(contextMenu.blockId || "", { isTextOnly: false });
                                                setContextMenu({ open: false, x: 0, y: 0, blockId: null });
                                            }}
                                            className="btn-ghost text-[11px] px-2 py-1 text-zinc-800"
                                        >
                                            Frame Box
                                        </button>
                                        <button
                                            onClick={() => {
                                                if (contextMenu.blockId) removeBlock(contextMenu.blockId);
                                                setContextMenu({ open: false, x: 0, y: 0, blockId: null });
                                            }}
                                            className="btn-ghost text-[11px] px-2 py-1 text-red-500"
                                        >
                                            Delete
                                        </button>
                                    </div>
                                </div>
                            )}
                            {drawingBlock && (
                                <div
                                    className="fixed inset-0 z-[65] bg-black/35 backdrop-blur-[1px] flex items-center justify-center p-4"
                                    onMouseDown={(event) => {
                                        if (event.target === event.currentTarget) closeDrawingCard();
                                    }}
                                >
                                    <div className="w-[min(1240px,97vw)] h-[min(820px,93vh)] rounded-xl border border-zinc-300 bg-white shadow-2xl overflow-hidden flex flex-col">
                                        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
                                            <div>
                                                <p className="text-sm font-semibold text-zinc-900">Wireframe Drawing Studio</p>
                                                <p className="text-[11px] text-zinc-500">Low-latency brush engine with layered stroke controls</p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className="text-[11px] text-zinc-500 px-2 py-1 rounded border border-zinc-200 bg-zinc-50">
                                                    {drawTool === "eraser" ? "Eraser" : "Brush"} · {brushSize.toFixed(1)}px
                                                </span>
                                                <button
                                                    className="rounded-full border border-zinc-300 p-1.5 text-zinc-600 hover:bg-zinc-100"
                                                    onClick={closeDrawingCard}
                                                    title="Close drawing card"
                                                >
                                                    <X className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </div>
                                        <div className="border-b border-zinc-200 bg-zinc-50/70 px-4 py-2.5 flex flex-wrap items-center gap-2.5">
                                            <div className="flex items-center gap-1 rounded-lg border border-zinc-300 bg-white p-1">
                                                <button
                                                    onClick={() => setDrawTool("brush")}
                                                    className={`text-[11px] px-2.5 py-1 rounded ${drawTool === "brush" ? "bg-zinc-900 text-white" : "text-zinc-700 hover:bg-zinc-100"}`}
                                                >
                                                    Brush
                                                </button>
                                                <button
                                                    onClick={() => setDrawTool("eraser")}
                                                    className={`text-[11px] px-2.5 py-1 rounded ${drawTool === "eraser" ? "bg-zinc-900 text-white" : "text-zinc-700 hover:bg-zinc-100"}`}
                                                >
                                                    Eraser
                                                </button>
                                            </div>
                                            <div className="flex items-center gap-1.5">
                                                {BRUSH_SWATCHES.map((swatch) => (
                                                    <button
                                                        key={swatch}
                                                        onClick={() => {
                                                            setDrawTool("brush");
                                                            setBrushColor(swatch);
                                                        }}
                                                        className={`h-6 w-6 rounded border ${brushColor === swatch ? "border-zinc-900" : "border-zinc-300"}`}
                                                        style={{ backgroundColor: swatch }}
                                                        title={`Color ${swatch}`}
                                                    />
                                                ))}
                                                <input
                                                    type="color"
                                                    value={brushColor}
                                                    onChange={(event) => {
                                                        setDrawTool("brush");
                                                        setBrushColor(event.target.value);
                                                    }}
                                                    className="h-7 w-9 rounded border border-zinc-300 bg-white"
                                                    title="Custom color"
                                                />
                                            </div>
                                            <label className="text-[11px] text-zinc-700 flex items-center gap-2">
                                                Size
                                                <input
                                                    type="range"
                                                    min={0.8}
                                                    max={14}
                                                    step={0.2}
                                                    value={brushSize}
                                                    onChange={(event) => setBrushSize(Number(event.target.value))}
                                                    className="w-28"
                                                />
                                            </label>
                                            <label className="text-[11px] text-zinc-700 flex items-center gap-2">
                                                Opacity
                                                <input
                                                    type="range"
                                                    min={0.1}
                                                    max={1}
                                                    step={0.05}
                                                    value={brushOpacity}
                                                    onChange={(event) => setBrushOpacity(Number(event.target.value))}
                                                    className="w-24"
                                                />
                                            </label>
                                            <button
                                                className="btn-ghost text-[11px] px-2.5 py-1"
                                                onClick={() => undoDrawingForBlock(drawingBlock.id)}
                                                disabled={drawingStrokes.length === 0}
                                            >
                                                Undo
                                            </button>
                                            <button
                                                className="btn-ghost text-[11px] px-2.5 py-1"
                                                onClick={() => clearDrawingForBlock(drawingBlock.id)}
                                                disabled={drawingStrokes.length === 0}
                                            >
                                                Clear
                                            </button>
                                        </div>
                                        <div className="flex-1 p-3 bg-zinc-100/70">
                                            <div
                                                ref={drawingSurfaceRef}
                                                className={`relative w-full h-full rounded-lg border border-zinc-300 bg-white overflow-hidden touch-none ${drawTool === "eraser" ? "cursor-cell" : "cursor-crosshair"}`}
                                                onPointerDown={startDrawingStroke}
                                                onPointerMove={moveDrawingStroke}
                                                onPointerUp={endDrawingStroke}
                                                onPointerCancel={endDrawingStroke}
                                            >
                                                {drawingAsset?.mimeType.startsWith("image/") && (
                                                    // eslint-disable-next-line @next/next/no-img-element
                                                    <img
                                                        alt={drawingAsset.name}
                                                        src={`/api/projects/${project.id}/assets/${drawingAsset.id}/content`}
                                                        className="absolute inset-0 w-full h-full object-contain opacity-85"
                                                        draggable={false}
                                                    />
                                                )}
                                                <svg
                                                    ref={drawingSvgRef}
                                                    className="absolute inset-0"
                                                    viewBox="0 0 100 100"
                                                    preserveAspectRatio="none"
                                                >
                                                    {drawingStrokes.map((stroke) => (
                                                        <polyline
                                                            key={stroke.id}
                                                            points={toPolylinePoints(stroke.points)}
                                                            fill="none"
                                                            stroke={stroke.tool === "eraser" ? "#ffffff" : stroke.color || "#0f172a"}
                                                            strokeOpacity={stroke.opacity ?? 1}
                                                            strokeWidth={Math.max(0.45, (stroke.size || 2.6) * 0.33)}
                                                            strokeLinecap="round"
                                                            strokeLinejoin="round"
                                                        />
                                                    ))}
                                                    {activeStroke && (
                                                        <polyline
                                                            points={toPolylinePoints(activeStroke.points)}
                                                            fill="none"
                                                            stroke={activeStroke.tool === "eraser" ? "#ffffff" : activeStroke.color || "#2563eb"}
                                                            strokeOpacity={activeStroke.opacity ?? 1}
                                                            strokeWidth={Math.max(0.45, (activeStroke.size || 2.6) * 0.33)}
                                                            strokeLinecap="round"
                                                            strokeLinejoin="round"
                                                        />
                                                    )}
                                                </svg>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                            {textBlock && (
                                <div
                                    className="fixed inset-0 z-[65] bg-black/35 backdrop-blur-[1px] flex items-center justify-center p-4"
                                    onMouseDown={(event) => {
                                        if (event.target === event.currentTarget) closeTextCard();
                                    }}
                                >
                                    <div className="w-[min(960px,94vw)] h-[min(700px,90vh)] rounded-xl border border-zinc-300 bg-white shadow-2xl overflow-hidden flex flex-col">
                                        <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2.5">
                                            <div>
                                                <p className="text-sm font-medium text-zinc-800">Text Planning Card</p>
                                                <p className="text-[11px] text-zinc-500">Write structure notes and script cues for this wireframe</p>
                                            </div>
                                            <button
                                                className="rounded-full border border-zinc-300 p-1.5 text-zinc-600 hover:bg-zinc-100"
                                                onClick={closeTextCard}
                                                title="Close text card"
                                            >
                                                <X className="w-4 h-4" />
                                            </button>
                                        </div>
                                        <div className="flex-1 overflow-auto p-4 space-y-3">
                                            <div className="grid grid-cols-2 gap-2">
                                                <input
                                                    type="number"
                                                    min={0}
                                                    className="input-field text-sm"
                                                    value={textBlock.scriptRef?.startChar || 0}
                                                    onChange={(event) =>
                                                        updateBlockById(textBlock.id, {
                                                            scriptRef: {
                                                                ...(textBlock.scriptRef || { sceneId: textBlock.sceneId }),
                                                                startChar: Math.max(0, Number(event.target.value) || 0),
                                                            },
                                                        })
                                                    }
                                                    placeholder="Script start"
                                                />
                                                <input
                                                    type="number"
                                                    min={0}
                                                    className="input-field text-sm"
                                                    value={textBlock.scriptRef?.endChar || 200}
                                                    onChange={(event) =>
                                                        updateBlockById(textBlock.id, {
                                                            scriptRef: {
                                                                ...(textBlock.scriptRef || { sceneId: textBlock.sceneId }),
                                                                endChar: Math.max(0, Number(event.target.value) || 0),
                                                            },
                                                        })
                                                    }
                                                    placeholder="Script end"
                                                />
                                            </div>
                                            <textarea
                                                rows={8}
                                                className="textarea-field text-sm"
                                                value={textBlock.notes || ""}
                                                onChange={(event) => updateBlockById(textBlock.id, { notes: event.target.value })}
                                                placeholder="Write planning notes"
                                            />
                                            <input
                                                className="input-field text-sm"
                                                value={(textBlock.tags || []).join(", ")}
                                                onChange={(event) => updateBlockById(textBlock.id, { tags: splitTags(event.target.value) })}
                                                placeholder="Tags (comma separated)"
                                            />
                                            <input
                                                className="input-field text-sm"
                                                value={textBlock.category || ""}
                                                onChange={(event) => updateBlockById(textBlock.id, { category: event.target.value })}
                                                placeholder="Category"
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}
                            {audioBlock && (
                                <div
                                    className="fixed inset-0 z-[65] bg-black/35 backdrop-blur-[1px] flex items-center justify-center p-4"
                                    onMouseDown={(event) => {
                                        if (event.target === event.currentTarget) closeAudioCard();
                                    }}
                                >
                                    <div className="w-[min(960px,94vw)] h-[min(700px,90vh)] rounded-xl border border-zinc-300 bg-white shadow-2xl overflow-hidden flex flex-col">
                                        <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2.5">
                                            <div>
                                                <p className="text-sm font-medium text-zinc-800">Audio Planning Card</p>
                                                <p className="text-[11px] text-zinc-500">Set audio timing and snap behavior for this wireframe</p>
                                            </div>
                                            <button
                                                className="rounded-full border border-zinc-300 p-1.5 text-zinc-600 hover:bg-zinc-100"
                                                onClick={closeAudioCard}
                                                title="Close audio card"
                                            >
                                                <X className="w-4 h-4" />
                                            </button>
                                        </div>
                                        <div className="flex-1 overflow-auto p-4 space-y-3">
                                            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 space-y-2">
                                                <p className="text-xs font-medium text-zinc-700">Wireframe Audio</p>
                                                <select
                                                    className="input-field text-sm"
                                                    value={audioBlock.audioAssetId || ""}
                                                    onChange={(event) =>
                                                        updateBlockById(audioBlock.id, {
                                                            audioAssetId: event.target.value || undefined,
                                                        })
                                                    }
                                                >
                                                    <option value="">No linked audio asset</option>
                                                    {audioAssets.map((asset) => (
                                                        <option key={asset.id} value={asset.id}>{asset.name}</option>
                                                    ))}
                                                </select>
                                                <input
                                                    className="input-field text-sm"
                                                    value={audioBlock.audioClipPath || ""}
                                                    onChange={(event) =>
                                                        updateBlockById(audioBlock.id, { audioClipPath: event.target.value })
                                                    }
                                                    placeholder="Or custom clip path"
                                                />
                                            </div>
                                            <p className="text-xs font-medium text-zinc-700">Project Audio Timeline</p>
                                            <input
                                                className="input-field text-sm"
                                                value={audioFilePath}
                                                onChange={(event) => setAudioFilePath(event.target.value)}
                                                onBlur={saveAudioTrack}
                                                placeholder="Project audio track path"
                                            />
                                            <div className="grid grid-cols-2 gap-2">
                                                <input
                                                    type="number"
                                                    min={0}
                                                    className="input-field text-sm"
                                                    value={audioBlock.audioRef?.startSec || 0}
                                                    onChange={(event) => {
                                                        const value = Math.max(0, Number(event.target.value) || 0);
                                                        const snapped = audioBlock.audioRef?.snapToBeat ? nearestBeat(value, beatMarkers) : value;
                                                        updateBlockById(audioBlock.id, {
                                                            audioRef: { ...(audioBlock.audioRef || {}), startSec: snapped },
                                                        });
                                                    }}
                                                    placeholder="Audio start sec"
                                                />
                                                <input
                                                    type="number"
                                                    min={0}
                                                    className="input-field text-sm"
                                                    value={audioBlock.audioRef?.endSec || 0}
                                                    onChange={(event) => {
                                                        const value = Math.max(0, Number(event.target.value) || 0);
                                                        const snapped = audioBlock.audioRef?.snapToBeat ? nearestBeat(value, beatMarkers) : value;
                                                        updateBlockById(audioBlock.id, {
                                                            audioRef: { ...(audioBlock.audioRef || {}), endSec: snapped },
                                                        });
                                                    }}
                                                    placeholder="Audio end sec"
                                                />
                                            </div>
                                            <label className="flex items-center gap-2 text-sm text-zinc-700">
                                                <input
                                                    type="checkbox"
                                                    checked={Boolean(audioBlock.audioRef?.snapToBeat)}
                                                    onChange={(event) =>
                                                        updateBlockById(audioBlock.id, {
                                                            audioRef: { ...(audioBlock.audioRef || {}), snapToBeat: event.target.checked },
                                                        })
                                                    }
                                                />
                                                Snap to beat markers
                                            </label>
                                            <input
                                                className="input-field text-sm"
                                                value={beatInput}
                                                onChange={(event) => setBeatInput(event.target.value)}
                                                onBlur={saveAudioTrack}
                                                placeholder="Beat markers (comma separated)"
                                            />
                                            <button
                                                onClick={applyAudioSuggestions}
                                                className="btn-ghost text-sm px-3 py-2 border border-zinc-300 rounded w-full"
                                            >
                                                Apply Audio Suggestions to Blocks
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        <aside
                            className={`absolute right-0 top-0 bottom-0 z-40 w-[320px] bg-white border-l border-zinc-300 p-3 overflow-y-auto shadow-2xl transition-transform duration-300 ${showInspector ? "translate-x-0" : "translate-x-full"}`}
                        >
                            <div className="flex items-center justify-between mb-2">
                                <p className="text-xs font-medium text-zinc-700">Wireframe Inspector</p>
                                <button
                                    className="btn-ghost text-[11px] px-2 py-1"
                                    onClick={() => setShowInspector(false)}
                                >
                                    Close
                                </button>
                            </div>
                            {!selectedBlock && <p className="text-xs text-zinc-500">Select a wireframe to customize.</p>}
                            {selectedBlock && (
                                <div className="space-y-3">
                                    <div className="rounded-xl border border-zinc-300 bg-gradient-to-b from-white to-zinc-50 p-3">
                                        <p className="text-[11px] text-zinc-500">Selected Wireframe</p>
                                        <p className="text-sm font-semibold text-zinc-800">{selectedBlock.id}</p>
                                        <p className="text-[11px] text-zinc-600 mt-1">
                                            Mode: <span className="font-medium text-zinc-800">{MODE_LABELS[activeMode]}</span>
                                        </p>
                                    </div>

                                    <div className="rounded-xl border border-zinc-300 bg-white p-3 space-y-2">
                                        <p className="text-xs font-medium text-zinc-700">Quick Actions</p>
                                        <div className="grid grid-cols-2 gap-2">
                                            <button
                                                className="btn-ghost text-xs px-2 py-1.5"
                                                onClick={() => openModeCardForBlock(selectedBlock.id)}
                                            >
                                                Open {MODE_LABELS[activeMode]} Card
                                            </button>
                                            <button
                                                className="btn-ghost text-xs px-2 py-1.5"
                                                onClick={() => updateSelectedBlock({ isTextOnly: !selectedBlock.isTextOnly })}
                                            >
                                                {selectedBlock.isTextOnly ? "Set Frame Box" : "Set Text Box"}
                                            </button>
                                            <button
                                                className="btn-ghost text-xs px-2 py-1.5"
                                                onClick={() => duplicateBlock(selectedBlock)}
                                            >
                                                Duplicate
                                            </button>
                                            {!isSelectedDetailsCard && (
                                                <button
                                                    className="btn-ghost text-xs px-2 py-1.5"
                                                    onClick={() => addDetailsCard(selectedBlock.id)}
                                                >
                                                    Add Detail Card
                                                </button>
                                            )}
                                            {isSelectedDetailsCard && (
                                                <button
                                                    className="btn-ghost text-xs px-2 py-1.5"
                                                    onClick={() => detachDetailsCard(selectedBlock.id)}
                                                >
                                                    Detach Card
                                                </button>
                                            )}
                                            <button
                                                className="btn-ghost text-xs px-2 py-1.5 text-red-600"
                                                onClick={() => removeBlock(selectedBlock.id)}
                                            >
                                                Delete
                                            </button>
                                        </div>
                                    </div>

                                    <div className="rounded-xl border border-zinc-300 bg-white p-3 space-y-2">
                                        <p className="text-xs font-medium text-zinc-700">Planning Details</p>
                                        <div className="grid grid-cols-2 gap-2">
                                            <input
                                                type="number"
                                                min={0}
                                                className="input-field text-xs"
                                                value={selectedBlock.durationPlanSec || 0}
                                                onChange={(event) =>
                                                    updateSelectedBlock({ durationPlanSec: Math.max(0, Number(event.target.value) || 0) })
                                                }
                                                placeholder="Duration"
                                            />
                                            <input
                                                className="input-field text-xs"
                                                value={selectedBlock.category || ""}
                                                onChange={(event) => updateSelectedBlock({ category: event.target.value })}
                                                placeholder="Category"
                                            />
                                        </div>
                                        <textarea
                                            rows={3}
                                            className="textarea-field text-xs"
                                            value={selectedBlock.notes || ""}
                                            onChange={(event) => updateSelectedBlock({ notes: event.target.value })}
                                            placeholder="Wireframe notes"
                                        />
                                        <input
                                            className="input-field text-xs"
                                            value={(selectedBlock.tags || []).join(", ")}
                                            onChange={(event) => updateSelectedBlock({ tags: splitTags(event.target.value) })}
                                            placeholder="Tags"
                                        />
                                        {textModeEnabled && (
                                            <div className="grid grid-cols-2 gap-2">
                                                <input
                                                    type="number"
                                                    min={0}
                                                    className="input-field text-xs"
                                                    value={selectedBlock.scriptRef?.startChar || 0}
                                                    onChange={(event) =>
                                                        updateSelectedBlock({
                                                            scriptRef: {
                                                                ...(selectedBlock.scriptRef || { sceneId: selectedBlock.sceneId }),
                                                                startChar: Math.max(0, Number(event.target.value) || 0),
                                                            },
                                                        })
                                                    }
                                                    placeholder="Script start"
                                                />
                                                <input
                                                    type="number"
                                                    min={0}
                                                    className="input-field text-xs"
                                                    value={selectedBlock.scriptRef?.endChar || 200}
                                                    onChange={(event) =>
                                                        updateSelectedBlock({
                                                            scriptRef: {
                                                                ...(selectedBlock.scriptRef || { sceneId: selectedBlock.sceneId }),
                                                                endChar: Math.max(0, Number(event.target.value) || 0),
                                                            },
                                                        })
                                                    }
                                                    placeholder="Script end"
                                                />
                                            </div>
                                        )}
                                    </div>

                                    {isSelectedDetailsCard && (
                                        <div className="rounded-xl border border-zinc-300 bg-white p-3 space-y-2">
                                            <p className="text-xs font-medium text-zinc-700">Filming Detail Card</p>
                                            <p className="text-[11px] text-zinc-500">
                                                This card is for full technical breakdown of the wireframe above.
                                            </p>
                                            <div className="grid grid-cols-2 gap-2">
                                                <input
                                                    className="input-field text-xs"
                                                    value={selectedBlock.shotDetails?.framing || ""}
                                                    onChange={(event) =>
                                                        updateSelectedBlock({
                                                            shotDetails: {
                                                                ...(selectedBlock.shotDetails || {}),
                                                                framing: event.target.value,
                                                            },
                                                        })
                                                    }
                                                    placeholder="Framing"
                                                />
                                                <input
                                                    className="input-field text-xs"
                                                    value={selectedBlock.shotDetails?.angle || ""}
                                                    onChange={(event) =>
                                                        updateSelectedBlock({
                                                            shotDetails: {
                                                                ...(selectedBlock.shotDetails || {}),
                                                                angle: event.target.value,
                                                            },
                                                        })
                                                    }
                                                    placeholder="Angle"
                                                />
                                                <input
                                                    className="input-field text-xs"
                                                    value={selectedBlock.shotDetails?.movement || ""}
                                                    onChange={(event) =>
                                                        updateSelectedBlock({
                                                            shotDetails: {
                                                                ...(selectedBlock.shotDetails || {}),
                                                                movement: event.target.value,
                                                            },
                                                        })
                                                    }
                                                    placeholder="Movement"
                                                />
                                                <input
                                                    className="input-field text-xs"
                                                    value={selectedBlock.shotDetails?.camera || ""}
                                                    onChange={(event) =>
                                                        updateSelectedBlock({
                                                            shotDetails: {
                                                                ...(selectedBlock.shotDetails || {}),
                                                                camera: event.target.value,
                                                            },
                                                        })
                                                    }
                                                    placeholder="Camera"
                                                />
                                                <input
                                                    className="input-field text-xs"
                                                    value={selectedBlock.shotDetails?.lens || ""}
                                                    onChange={(event) =>
                                                        updateSelectedBlock({
                                                            shotDetails: {
                                                                ...(selectedBlock.shotDetails || {}),
                                                                lens: event.target.value,
                                                            },
                                                        })
                                                    }
                                                    placeholder="Lens"
                                                />
                                                <input
                                                    className="input-field text-xs"
                                                    value={selectedBlock.shotDetails?.lighting || ""}
                                                    onChange={(event) =>
                                                        updateSelectedBlock({
                                                            shotDetails: {
                                                                ...(selectedBlock.shotDetails || {}),
                                                                lighting: event.target.value,
                                                            },
                                                        })
                                                    }
                                                    placeholder="Lighting"
                                                />
                                                <input
                                                    className="input-field text-xs"
                                                    value={selectedBlock.shotDetails?.colorPalette || ""}
                                                    onChange={(event) =>
                                                        updateSelectedBlock({
                                                            shotDetails: {
                                                                ...(selectedBlock.shotDetails || {}),
                                                                colorPalette: event.target.value,
                                                            },
                                                        })
                                                    }
                                                    placeholder="Color palette"
                                                />
                                                <input
                                                    className="input-field text-xs"
                                                    value={selectedBlock.shotDetails?.location || ""}
                                                    onChange={(event) =>
                                                        updateSelectedBlock({
                                                            shotDetails: {
                                                                ...(selectedBlock.shotDetails || {}),
                                                                location: event.target.value,
                                                            },
                                                        })
                                                    }
                                                    placeholder="Location"
                                                />
                                            </div>
                                        </div>
                                    )}

                                    <div className="rounded-xl border border-zinc-300 bg-white p-3 space-y-2">
                                        <p className="text-xs font-medium text-zinc-700">Media</p>
                                        <select
                                            className="input-field text-xs"
                                            value={selectedBlock.visualAssetId || ""}
                                            onChange={(event) => updateSelectedBlock({ visualAssetId: event.target.value || undefined })}
                                        >
                                            <option value="">No linked visual</option>
                                            {assets.map((asset) => (
                                                <option key={asset.id} value={asset.id}>{asset.name}</option>
                                            ))}
                                        </select>
                                        {drawingModeEnabled && (
                                            <select
                                                className="input-field text-xs"
                                                value={selectedBlock.layoutMode || storyboard.drawingLayoutDefault || "standard"}
                                                onChange={(event) => updateSelectedBlock({ layoutMode: event.target.value as DrawingLayoutMode })}
                                            >
                                                {DRAWING_LAYOUT_MODES.map((mode) => (
                                                    <option key={mode} value={mode}>{mode}</option>
                                                ))}
                                            </select>
                                        )}
                                    </div>

                                    {audioModeEnabled && (
                                        <div className="rounded-xl border border-zinc-300 bg-white p-3 space-y-2">
                                            <p className="text-xs font-medium text-zinc-700">Wireframe Audio</p>
                                            <select
                                                className="input-field text-xs"
                                                value={selectedBlock.audioAssetId || ""}
                                                onChange={(event) =>
                                                    updateSelectedBlock({ audioAssetId: event.target.value || undefined })
                                                }
                                            >
                                                <option value="">No linked audio asset</option>
                                                {audioAssets.map((asset) => (
                                                    <option key={asset.id} value={asset.id}>{asset.name}</option>
                                                ))}
                                            </select>
                                            <input
                                                className="input-field text-xs"
                                                value={selectedBlock.audioClipPath || ""}
                                                onChange={(event) => updateSelectedBlock({ audioClipPath: event.target.value })}
                                                placeholder="Custom clip path"
                                            />
                                            <div className="grid grid-cols-2 gap-2">
                                                <input type="number" min={0} className="input-field text-xs" value={selectedBlock.audioRef?.startSec || 0} onChange={(event) => { const value = Math.max(0, Number(event.target.value) || 0); const snapped = selectedBlock.audioRef?.snapToBeat ? nearestBeat(value, beatMarkers) : value; updateSelectedBlock({ audioRef: { ...(selectedBlock.audioRef || {}), startSec: snapped } }); }} placeholder="Audio start" />
                                                <input type="number" min={0} className="input-field text-xs" value={selectedBlock.audioRef?.endSec || 0} onChange={(event) => { const value = Math.max(0, Number(event.target.value) || 0); const snapped = selectedBlock.audioRef?.snapToBeat ? nearestBeat(value, beatMarkers) : value; updateSelectedBlock({ audioRef: { ...(selectedBlock.audioRef || {}), endSec: snapped } }); }} placeholder="Audio end" />
                                            </div>
                                            <label className="flex items-center gap-2 text-xs text-zinc-600">
                                                <input type="checkbox" checked={Boolean(selectedBlock.audioRef?.snapToBeat)} onChange={(event) => updateSelectedBlock({ audioRef: { ...(selectedBlock.audioRef || {}), snapToBeat: event.target.checked } })} />
                                                Snap to beat markers
                                            </label>
                                        </div>
                                    )}

                                    <div className="rounded-xl border border-zinc-300 bg-white p-3 space-y-2">
                                        <p className="text-xs font-medium text-zinc-700">Links and Grouping</p>
                                        <div className="grid grid-cols-2 gap-2">
                                            <button
                                                className="btn-ghost text-xs px-2 py-1.5"
                                                onClick={() => beginLinkFromBlock(selectedBlock)}
                                            >
                                                {linkDraft ? "Pick target" : "Start Link"}
                                            </button>
                                            <button
                                                className="btn-ghost text-xs px-2 py-1.5"
                                                onClick={() => removeLinksForBlock(selectedBlock.id, "all")}
                                            >
                                                Clear Links
                                            </button>
                                        </div>
                                        <div className="flex gap-2">
                                            <input value={groupName} onChange={(event) => setGroupName(event.target.value)} className="input-field text-xs" placeholder="Group name" />
                                            <button
                                                onClick={() => {
                                                    if (!selectedBlockId) return;
                                                    const group = createGroup(groupName.trim() || `Group ${groups.length + 1}`, [selectedBlockId]);
                                                    mutateStoryboard((prev) => ({
                                                        ...prev,
                                                        groups: [...(prev.groups || []), group],
                                                        blocks: (prev.blocks || []).map((block) =>
                                                            block.id === selectedBlockId ? { ...block, groupId: group.id } : block
                                                        ),
                                                    }));
                                                    setGroupName("");
                                                }}
                                                className="btn-ghost px-2 py-1 text-xs"
                                            >
                                                Add
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {audioModeEnabled && (
                                <div className="mt-4 pt-3 border-t border-zinc-300">
                                    <div className="rounded-xl border border-zinc-300 bg-white p-3 space-y-2">
                                    <p className="text-xs font-medium text-zinc-700">Project Audio</p>
                                    <input className="input-field text-xs" value={audioFilePath} onChange={(event) => setAudioFilePath(event.target.value)} onBlur={saveAudioTrack} placeholder="Track file path" />
                                    <input type="number" min={0} className="input-field text-xs" value={audioDuration} onChange={(event) => setAudioDuration(Number(event.target.value) || 0)} onBlur={saveAudioTrack} placeholder="Duration (sec)" />
                                    <input className="input-field text-xs" value={beatInput} onChange={(event) => setBeatInput(event.target.value)} onBlur={saveAudioTrack} placeholder="Beat markers (comma)" />
                                    <label className="flex items-center gap-2 text-xs text-zinc-600">
                                        <input type="checkbox" checked={Boolean(storyboard.autoDurationFromAudioEnabled)} onChange={(event) => mutateStoryboard((prev) => ({ ...prev, autoDurationFromAudioEnabled: event.target.checked }))} />
                                        Auto-apply suggested durations to scenes
                                    </label>
                                    <button onClick={applyAudioSuggestions} className="btn-ghost text-xs px-2 py-1 w-full border border-zinc-300 rounded">Apply Audio Suggestions</button>
                                    <p className="text-[11px] text-zinc-500">{segmentSuggestions.length} scene timing suggestions</p>
                                    </div>
                                </div>
                            )}
                        </aside>
                    </section>
                )}

                {renderMode === "timeline" && (
                    <section className="h-full bg-white p-4 overflow-auto">
                        <div className="flex items-center gap-2 mb-3">
                            <button onClick={() => setRenderMode("canvas")} className="btn-ghost text-xs">Back to Canvas</button>
                            <button onClick={reapplySceneOrderFromTimeline} className="btn-ghost text-xs"><RefreshCw className="w-3 h-3 inline mr-1" />Apply to Scene Order</button>
                        </div>
                        <div className="border border-zinc-300 rounded-lg overflow-hidden">
                            <table className="w-full text-xs">
                                <thead className="bg-zinc-100 text-zinc-600">
                                    <tr>
                                        <th className="text-left px-2 py-2">Seq</th>
                                        <th className="text-left px-2 py-2">Type</th>
                                        <th className="text-left px-2 py-2">Scene</th>
                                        <th className="text-left px-2 py-2">Duration</th>
                                        <th className="text-left px-2 py-2">Notes</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {linearRows.map((row) => (
                                        <tr key={row.blockId} className="border-t border-zinc-200">
                                            <td className="px-2 py-2">{row.sequenceIndex + 1}</td>
                                            <td className="px-2 py-2">{row.type}</td>
                                            <td className="px-2 py-2">{row.sceneTitle}</td>
                                            <td className="px-2 py-2">{formatDuration(Math.round(row.durationPlanSec))}</td>
                                            <td className="px-2 py-2">{row.shotSummary || row.notes || "-"}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </section>
                )}

                {renderMode === "shot-list" && (
                    <section className="h-full bg-white p-4 overflow-auto">
                        <div className="flex items-center gap-2 mb-3">
                            <button onClick={() => setRenderMode("canvas")} className="btn-ghost text-xs">Back to Canvas</button>
                            <button onClick={exportShotSheet} className="btn-ghost text-xs"><Download className="w-3 h-3 inline mr-1" />Export CSV</button>
                        </div>
                        <div className="space-y-1">
                            {shotChecklist.map((item) => (
                                <label key={item.id} className="flex items-center gap-2 border border-zinc-300 rounded px-2 py-2 text-xs bg-white">
                                    <input type="checkbox" checked={Boolean(checklistState[item.id])} onChange={(event) => setChecklistState((prev) => ({ ...prev, [item.id]: event.target.checked }))} />
                                    <span className="text-zinc-700">{item.sceneTitle}</span>
                                    <span className="text-zinc-500">{item.label}</span>
                                    {item.missingScene && <span className="ml-auto text-amber-600">missing scene</span>}
                                </label>
                            ))}
                        </div>
                    </section>
                )}

                {renderMode === "teleprompter" && (
                    <section className="h-full bg-white p-4 overflow-auto">
                        <div className="flex items-center gap-2 mb-3">
                            <button onClick={() => setRenderMode("canvas")} className="btn-ghost text-xs">Back to Canvas</button>
                            <button onClick={exportTeleprompter} className="btn-ghost text-xs"><Download className="w-3 h-3 inline mr-1" />Export Text</button>
                            <button onClick={() => setRenderMode("shot-list")} className="btn-ghost text-xs"><CheckSquare className="w-3 h-3 inline mr-1" />Checklist</button>
                        </div>
                        <textarea className="textarea-field min-h-[76vh] font-mono text-xs" readOnly value={teleprompterScript} />
                    </section>
                )}
                <ConfirmDialog
                    open={Boolean(pendingSelectionConfirm)}
                    title="Create selection area?"
                    message="This will add a new storyboard area based on the selected region."
                    confirmLabel="Create"
                    onCancel={() => setPendingSelectionConfirm(null)}
                    onConfirm={() => {
                        if (!pendingSelectionConfirm) return;
                        commitSelectionArea(pendingSelectionConfirm);
                        setPendingSelectionConfirm(null);
                    }}
                />
            </div>
        </main>
    );
}
