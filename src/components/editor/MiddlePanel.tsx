"use client";

import { useState, useEffect, useRef } from "react";
import {
    Type,
    Target,
    Clock,
    Film,
    StickyNote,
    Megaphone,
    AlignLeft,
    Paperclip,
    FileVideo,
    FileAudio,
    FileImage,
    FileText,
    File,
    Plus,
    X,
    ChevronDown,
    ChevronRight,
} from "lucide-react";
import type { Scene, SceneStatus, ShotType, Asset } from "@/lib/types";
import {
    SCENE_STATUSES,
    SHOT_TYPES,
    STATUS_COLORS,
    STATUS_LABELS,
    SHOT_TYPE_LABELS,
    formatDuration,
    wordCount,
    estimateDurationFromWords,
} from "@/lib/types";

interface MiddlePanelProps {
    scene: Scene | null;
    assets: Asset[];
    onUpdate: (updates: Partial<Scene>) => void;
    onLinkAsset: (assetId: string) => void;
    onUnlinkAsset: (assetId: string) => void;
}

const ASSET_ICONS: Record<string, React.ElementType> = {
    footage: FileVideo,
    audio: FileAudio,
    graphic: FileImage,
    overlay: FileImage,
    reference: FileText,
};

function getAssetIcon(type: string) {
    return ASSET_ICONS[type] || File;
}

function formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export default function MiddlePanel({
    scene,
    assets,
    onUpdate,
    onLinkAsset,
    onUnlinkAsset,
}: MiddlePanelProps) {
    const [localScene, setLocalScene] = useState<Scene | null>(null);
    const [assetsOpen, setAssetsOpen] = useState(true);
    const [showAssetPicker, setShowAssetPicker] = useState(false);
    const [assetDropActive, setAssetDropActive] = useState(false);
    const debounceRef = useRef<NodeJS.Timeout>();

    useEffect(() => {
        setLocalScene(scene ? { ...scene } : null);
    }, [scene]);

    function handleChange(field: keyof Scene, value: string | number) {
        if (!localScene) return;
        const updated = { ...localScene, [field]: value };
        setLocalScene(updated);

        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            onUpdate({ [field]: value });
        }, 220);
    }

    function handleStatusChange(status: SceneStatus) {
        if (!localScene) return;
        setLocalScene({ ...localScene, status });
        onUpdate({ status });
    }

    if (!localScene) {
        return (
            <main className="flex-1 flex items-center justify-center bg-[var(--bg-primary)]">
                <div className="text-center animate-fade-in">
                    <div className="w-16 h-16 rounded-2xl bg-surface/60 border border-border/40 flex items-center justify-center mx-auto mb-4">
                        <AlignLeft className="w-8 h-8 text-zinc-700" />
                    </div>
                    <h3 className="text-sm font-medium text-zinc-500 mb-1">
                        No scene selected
                    </h3>
                    <p className="text-xs text-zinc-600">
                        Select a scene from the left panel or create a new one
                    </p>
                </div>
            </main>
        );
    }

    const words = wordCount(localScene.scriptBody);
    const autoSeconds = estimateDurationFromWords(words);

    // Assets linked to this scene
    const linkedAssets = assets.filter((a) =>
        a.sceneIds.includes(localScene.id)
    );
    // Assets NOT linked to this scene (available to add)
    const availableAssets = assets.filter(
        (a) => !a.sceneIds.includes(localScene.id)
    );

    function handleAssetDrop(e: React.DragEvent) {
        e.preventDefault();
        setAssetDropActive(false);
        const raw = e.dataTransfer.getData("application/x-contengement-asset");
        if (!raw) return;
        try {
            const parsed = JSON.parse(raw) as { assetId?: string };
            if (!parsed.assetId) return;
            if (!linkedAssets.some((asset) => asset.id === parsed.assetId)) {
                onLinkAsset(parsed.assetId);
            }
        } catch {
            // ignore invalid payload
        }
    }

    return (
        <main className="flex-1 overflow-y-auto bg-[var(--bg-primary)]">
            <div className="max-w-3xl mx-auto px-8 py-8 space-y-6 animate-fade-in">
                {/* ─── Scene Header ─── */}
                <div>
                    <input
                        type="text"
                        value={localScene.title}
                        onChange={(e) => handleChange("title", e.target.value)}
                        className="w-full text-2xl font-bold bg-transparent border-none outline-none text-zinc-100 placeholder:text-zinc-700"
                        placeholder="Scene title..."
                    />
                </div>

                {/* ─── Status Chips ─── */}
                <div className="flex flex-wrap gap-2">
                    {SCENE_STATUSES.map((s) => (
                        <button
                            key={s}
                            onClick={() => handleStatusChange(s)}
                            className={`status-badge text-xs transition-all ${localScene.status === s
                                    ? "border-current shadow-sm"
                                    : "border-border/40 opacity-50 hover:opacity-80"
                                }`}
                            style={{
                                color: STATUS_COLORS[s],
                                backgroundColor:
                                    localScene.status === s
                                        ? `${STATUS_COLORS[s]}15`
                                        : "transparent",
                                borderColor:
                                    localScene.status === s
                                        ? `${STATUS_COLORS[s]}40`
                                        : undefined,
                            }}
                        >
                            <span
                                className="w-1.5 h-1.5 rounded-full"
                                style={{ backgroundColor: STATUS_COLORS[s] }}
                            />
                            {STATUS_LABELS[s]}
                        </button>
                    ))}
                </div>

                {/* ─── Goal ─── */}
                <div className="space-y-1.5">
                    <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-500">
                        <Target className="w-3 h-3" />
                        Scene Goal
                    </label>
                    <input
                        type="text"
                        value={localScene.goal}
                        onChange={(e) => handleChange("goal", e.target.value)}
                        className="input-field text-sm"
                        placeholder="What does this scene accomplish?"
                    />
                </div>

                {/* ─── Shot Type & Duration Row ─── */}
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                        <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-500">
                            <Film className="w-3 h-3" />
                            Shot Type
                        </label>
                        <select
                            value={localScene.shotType}
                            onChange={(e) =>
                                handleChange("shotType", e.target.value as ShotType)
                            }
                            className="input-field text-sm bg-surface-elevated"
                        >
                            {SHOT_TYPES.map((t) => (
                                <option key={t} value={t}>
                                    {SHOT_TYPE_LABELS[t]}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="space-y-1.5">
                        <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-500">
                            <Clock className="w-3 h-3" />
                            Duration
                            <span className="text-zinc-600 font-normal">
                                (auto: {formatDuration(autoSeconds)})
                            </span>
                        </label>
                        <div className="flex items-center gap-2">
                            <input
                                type="number"
                                min={0}
                                value={localScene.estimatedDurationSec}
                                onChange={(e) =>
                                    handleChange(
                                        "estimatedDurationSec",
                                        parseInt(e.target.value) || 0
                                    )
                                }
                                className="input-field text-sm w-24"
                                placeholder="sec"
                            />
                            <button
                                onClick={() =>
                                    handleChange("estimatedDurationSec", autoSeconds)
                                }
                                className="btn-ghost text-[11px] text-accent whitespace-nowrap"
                                title="Use word-count estimate"
                            >
                                Auto
                            </button>
                        </div>
                    </div>
                </div>

                {/* ─── Scene Assets ─── */}
                <div
                    className={`space-y-2 rounded-xl transition-all ${assetDropActive ? "ring-1 ring-accent/50 bg-accent/5 p-2" : ""}`}
                    onDragOver={(e) => {
                        e.preventDefault();
                        setAssetDropActive(true);
                    }}
                    onDragLeave={() => setAssetDropActive(false)}
                    onDrop={handleAssetDrop}
                >
                    <button
                        onClick={() => setAssetsOpen(!assetsOpen)}
                        className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-400 transition-colors w-full"
                    >
                        {assetsOpen ? (
                            <ChevronDown className="w-3 h-3" />
                        ) : (
                            <ChevronRight className="w-3 h-3" />
                        )}
                        <Paperclip className="w-3 h-3" />
                        Scene Assets
                        {linkedAssets.length > 0 && (
                            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-accent/10 text-accent text-[10px] font-semibold">
                                {linkedAssets.length}
                            </span>
                        )}
                    </button>
                    {assetDropActive && (
                        <p className="text-[10px] text-accent px-1">
                            Drop to link this media to the current scene
                        </p>
                    )}

                    {assetsOpen && (
                        <div className="space-y-1.5 animate-fade-in">
                            {/* Linked assets list */}
                            {linkedAssets.length > 0 ? (
                                <div className="space-y-1">
                                    {linkedAssets.map((asset) => {
                                        const Icon = getAssetIcon(asset.type);
                                        return (
                                            <div
                                                key={asset.id}
                                                className="group flex items-center gap-2.5 px-3 py-2 rounded-lg bg-surface/50 border border-border/30 hover:border-border/50 transition-all"
                                            >
                                                <div className="w-7 h-7 rounded-md bg-surface-elevated flex items-center justify-center shrink-0">
                                                    <Icon className="w-3.5 h-3.5 text-zinc-400" />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-xs text-zinc-300 truncate">
                                                        {asset.name}
                                                    </p>
                                                    <p className="text-[10px] text-zinc-600">
                                                        {asset.type} · {formatBytes(asset.sizeBytes)}
                                                    </p>
                                                </div>
                                                <button
                                                    onClick={() => onUnlinkAsset(asset.id)}
                                                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-500/10 rounded transition-all"
                                                    title="Unlink from scene"
                                                >
                                                    <X className="w-3 h-3 text-zinc-500 hover:text-red-400" />
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <p className="text-[11px] text-zinc-600 px-3 py-2">
                                    No assets linked to this scene yet.
                                </p>
                            )}

                            {/* Add asset button / picker */}
                            {availableAssets.length > 0 && (
                                <div className="relative">
                                    <button
                                        onClick={() => setShowAssetPicker(!showAssetPicker)}
                                        className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-accent/70 hover:text-accent hover:bg-accent-muted rounded-lg transition-all"
                                    >
                                        <Plus className="w-3 h-3" />
                                        Link asset to scene
                                    </button>

                                    {showAssetPicker && (
                                        <div className="absolute z-20 top-full left-0 mt-1 w-72 glass-panel-elevated p-2 space-y-0.5 max-h-48 overflow-y-auto animate-slide-up">
                                            {availableAssets.map((asset) => {
                                                const Icon = getAssetIcon(asset.type);
                                                return (
                                                    <button
                                                        key={asset.id}
                                                        onClick={() => {
                                                            onLinkAsset(asset.id);
                                                            setShowAssetPicker(false);
                                                        }}
                                                        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md hover:bg-surface-hover/60 transition-all text-left"
                                                    >
                                                        <div className="w-6 h-6 rounded bg-surface-elevated flex items-center justify-center shrink-0">
                                                            <Icon className="w-3 h-3 text-zinc-400" />
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <p className="text-xs text-zinc-300 truncate">
                                                                {asset.name}
                                                            </p>
                                                            <p className="text-[10px] text-zinc-600">
                                                                {asset.type} · {formatBytes(asset.sizeBytes)}
                                                            </p>
                                                        </div>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            )}

                            {assets.length === 0 && (
                                <p className="text-[11px] text-zinc-600 px-3">
                                    Upload assets in the right panel first.
                                </p>
                            )}
                        </div>
                    )}
                </div>

                {/* ─── Script Body ─── */}
                <div className="space-y-1.5">
                    <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-500">
                        <Type className="w-3 h-3" />
                        Script
                        <span className="ml-auto text-zinc-600 font-normal font-mono text-[10px]">
                            {words} words
                        </span>
                    </label>
                    <textarea
                        value={localScene.scriptBody}
                        onChange={(e) => handleChange("scriptBody", e.target.value)}
                        className="textarea-field text-sm font-mono leading-relaxed min-h-[240px]"
                        placeholder="Write your script here..."
                        rows={12}
                    />
                    {words === 0 && (
                        <p className="text-[11px] text-amber-500/60 flex items-center gap-1">
                            ⚠ No script written
                        </p>
                    )}
                </div>

                {/* ─── Notes ─── */}
                <div className="space-y-1.5">
                    <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-500">
                        <StickyNote className="w-3 h-3" />
                        Notes
                    </label>
                    <textarea
                        value={localScene.notes}
                        onChange={(e) => handleChange("notes", e.target.value)}
                        className="textarea-field text-sm min-h-[80px]"
                        placeholder="Director/editor notes..."
                        rows={3}
                    />
                </div>

                {/* ─── CTA ─── */}
                <div className="space-y-1.5">
                    <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-500">
                        <Megaphone className="w-3 h-3" />
                        Call to Action
                    </label>
                    <input
                        type="text"
                        value={localScene.cta}
                        onChange={(e) => handleChange("cta", e.target.value)}
                        className="input-field text-sm"
                        placeholder='e.g. "Like and subscribe", "Link in description"'
                    />
                </div>
            </div>
        </main>
    );
}
