"use client";

import { useState } from "react";
import {
    Plus,
    ChevronUp,
    ChevronDown,
    Trash2,
    Clock,
    Lightbulb,
    ChevronRight,
    ChevronDown as ChevDown,
    Edit3,
    Check,
} from "lucide-react";
import type { Project, Scene } from "@/lib/types";
import { formatDuration, STATUS_COLORS, STATUS_LABELS } from "@/lib/types";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

interface LeftPanelProps {
    project: Project;
    scenes: Scene[];
    selectedSceneId: string | null;
    onSelectScene: (id: string | null) => void;
    onAddScene: () => void;
    onRemoveScene: (id: string) => void;
    onMoveScene: (id: string, dir: "up" | "down") => void;
    onUpdateProject: (updates: Record<string, unknown>) => void;
}

export default function LeftPanel({
    project,
    scenes,
    selectedSceneId,
    onSelectScene,
    onAddScene,
    onRemoveScene,
    onMoveScene,
    onUpdateProject,
}: LeftPanelProps) {
    const [hookOpen, setHookOpen] = useState(true);
    const [editingHook, setEditingHook] = useState(false);
    const [hookText, setHookText] = useState(project.hook || "");
    const [sceneToDelete, setSceneToDelete] = useState<string | null>(null);

    const totalDuration = scenes.reduce(
        (sum, s) => sum + s.estimatedDurationSec,
        0
    );

    function saveHook() {
        onUpdateProject({ hook: hookText });
        setEditingHook(false);
    }

    function confirmDeleteScene() {
        if (!sceneToDelete) return;
        onRemoveScene(sceneToDelete);
        setSceneToDelete(null);
    }

    return (
        <aside className="w-72 border-r border-border/50 flex flex-col bg-surface-secondary/40 shrink-0 overflow-hidden">
            {/* ─── Project Meta ─── */}
            <div className="px-4 py-4 border-b border-border/30">
                <div className="flex items-center gap-2 text-xs text-zinc-500 mb-1">
                    <Clock className="w-3 h-3" />
                    <span>
                        {scenes.length} scene{scenes.length !== 1 ? "s" : ""} ·{" "}
                        {formatDuration(totalDuration)}
                    </span>
                </div>
            </div>

            {/* ─── Hook Section ─── */}
            <div className="border-b border-border/30">
                <button
                    onClick={() => setHookOpen(!hookOpen)}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-zinc-400 hover:text-zinc-300 transition-colors"
                >
                    {hookOpen ? (
                        <ChevDown className="w-3 h-3" />
                    ) : (
                        <ChevronRight className="w-3 h-3" />
                    )}
                    <Lightbulb className="w-3 h-3 text-amber-400/70" />
                    HOOK
                    {!project.hook && (
                        <span className="ml-auto text-[10px] text-amber-500/60 font-normal">
                            Missing
                        </span>
                    )}
                </button>
                {hookOpen && (
                    <div className="px-4 pb-3 animate-fade-in">
                        {editingHook ? (
                            <div className="flex flex-col gap-2">
                                <textarea
                                    autoFocus
                                    rows={3}
                                    className="textarea-field text-xs"
                                    value={hookText}
                                    onChange={(e) => setHookText(e.target.value)}
                                    placeholder="Write your hook here..."
                                />
                                <div className="flex gap-1.5 justify-end">
                                    <button
                                        onClick={() => setEditingHook(false)}
                                        className="btn-ghost text-[11px]"
                                    >
                                        Cancel
                                    </button>
                                    <button onClick={saveHook} className="btn-ghost text-[11px] text-accent">
                                        <Check className="w-3 h-3 inline mr-1" />
                                        Save
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div
                                onClick={() => {
                                    setHookText(project.hook || "");
                                    setEditingHook(true);
                                }}
                                className="text-xs text-zinc-400 cursor-pointer hover:text-zinc-300 transition-colors p-2 rounded-md hover:bg-surface-hover/40 min-h-[2rem]"
                            >
                                {project.hook || (
                                    <span className="text-zinc-600 italic">
                                        Click to write your hook...
                                    </span>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* ─── Scene List ─── */}
            <div className="flex-1 overflow-y-auto">
                <div className="section-header flex items-center justify-between">
                    <span>SCENES</span>
                </div>
                <div className="px-2 pb-2 space-y-0.5">
                    {scenes.map((scene, idx) => (
                        <div
                            key={scene.id}
                            onClick={() => onSelectScene(scene.id)}
                            className={`scene-card group ${selectedSceneId === scene.id ? "scene-card-active" : ""
                                }`}
                        >
                            <div className="flex items-center gap-2">
                                <div
                                    className="status-dot"
                                    style={{ backgroundColor: STATUS_COLORS[scene.status] }}
                                    title={STATUS_LABELS[scene.status]}
                                />
                                <span className="text-sm text-zinc-200 truncate flex-1">
                                    {scene.title}
                                </span>
                                <span className="text-[10px] text-zinc-600 font-mono shrink-0">
                                    {formatDuration(scene.estimatedDurationSec)}
                                </span>
                            </div>

                            {/* ─── Actions (visible on hover) ─── */}
                            <div className="hidden group-hover:flex items-center gap-0.5 mt-1.5 ml-4">
                                {idx > 0 && (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onMoveScene(scene.id, "up");
                                        }}
                                        className="btn-ghost p-0.5"
                                        title="Move up"
                                    >
                                        <ChevronUp className="w-3 h-3" />
                                    </button>
                                )}
                                {idx < scenes.length - 1 && (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onMoveScene(scene.id, "down");
                                        }}
                                        className="btn-ghost p-0.5"
                                        title="Move down"
                                    >
                                        <ChevronDown className="w-3 h-3" />
                                    </button>
                                )}
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setSceneToDelete(scene.id);
                                    }}
                                    className="btn-ghost p-0.5 ml-auto hover:text-red-400"
                                    title="Delete scene"
                                >
                                    <Trash2 className="w-3 h-3" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* ─── Add Scene ─── */}
            <div className="p-3 border-t border-border/30">
                <button
                    onClick={onAddScene}
                    className="w-full btn-secondary flex items-center justify-center gap-2 text-sm py-2"
                >
                    <Plus className="w-4 h-4" />
                    Add Scene
                </button>
            </div>
            <ConfirmDialog
                open={Boolean(sceneToDelete)}
                title="Delete scene?"
                message="This scene and its related links will be removed."
                confirmLabel="Delete"
                danger
                onCancel={() => setSceneToDelete(null)}
                onConfirm={confirmDeleteScene}
            />
        </aside>
    );
}
