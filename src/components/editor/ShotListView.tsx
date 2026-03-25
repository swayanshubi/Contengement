"use client";

import { ClipboardList } from "lucide-react";
import type { Project, Scene } from "@/lib/types";
import { SHOT_TYPES, SHOT_TYPE_LABELS, STATUS_COLORS, STATUS_LABELS, formatDuration } from "@/lib/types";

interface ShotListViewProps {
    project: Project;
    scenes: Scene[];
    onUpdateScene: (sceneId: string, updates: Partial<Scene>) => void;
}

export default function ShotListView({
    project,
    scenes,
    onUpdateScene,
}: ShotListViewProps) {
    const sceneOne = scenes[0] || null;
    const totalDuration = scenes.reduce(
        (sum, scene) => sum + scene.estimatedDurationSec,
        0
    );

    return (
        <main className="flex-1 overflow-y-auto bg-[var(--bg-primary)]">
            <div className="max-w-6xl mx-auto px-6 py-6 space-y-5 animate-fade-in">
                <div className="glass-panel-elevated p-5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                        <div>
                            <div className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-accent">
                                <ClipboardList className="w-3.5 h-3.5" />
                                Shot Planning
                            </div>
                            <h2 className="mt-3 text-2xl font-semibold text-zinc-100">
                                {project.title}
                            </h2>
                            <p className="mt-1 text-sm text-zinc-400">
                                Review every scene, lock framing notes, and prep the final capture order.
                            </p>
                        </div>

                        <div className="flex gap-2 text-xs text-zinc-300">
                            <div className="rounded-2xl border border-border/40 bg-white/[0.03] px-4 py-3">
                                <p className="text-zinc-500">Scenes</p>
                                <p className="mt-1 text-lg font-semibold text-zinc-100">
                                    {scenes.length}
                                </p>
                            </div>
                            <div className="rounded-2xl border border-border/40 bg-white/[0.03] px-4 py-3">
                                <p className="text-zinc-500">Runtime</p>
                                <p className="mt-1 text-lg font-semibold text-zinc-100">
                                    {formatDuration(totalDuration)}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {sceneOne && (
                    <div className="glass-panel p-4 space-y-3">
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                                Opening Hook
                            </p>
                            <p className="mt-1 text-sm text-zinc-300">
                                Keep the first scene punchy so the storyboard and shot list start from the same hook.
                            </p>
                        </div>
                        <div className="grid md:grid-cols-3 gap-2">
                            <input
                                className="input-field text-xs"
                                value={sceneOne.hookType || ""}
                                onChange={(e) =>
                                    onUpdateScene(sceneOne.id, { hookType: e.target.value })
                                }
                                placeholder="Hook type"
                            />
                            <input
                                type="number"
                                min={1}
                                max={5}
                                className="input-field text-xs"
                                value={sceneOne.hookStrength || ""}
                                onChange={(e) =>
                                    onUpdateScene(sceneOne.id, {
                                        hookStrength: Number(e.target.value) || undefined,
                                    })
                                }
                                placeholder="Hook strength (1-5)"
                            />
                            <input
                                className="input-field text-xs"
                                value={sceneOne.hookNotes || ""}
                                onChange={(e) =>
                                    onUpdateScene(sceneOne.id, { hookNotes: e.target.value })
                                }
                                placeholder="Hook notes"
                            />
                        </div>
                    </div>
                )}

                <div className="glass-panel overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead className="bg-surface/40 text-zinc-500">
                                <tr>
                                    <th className="text-left px-3 py-2">Scene</th>
                                    <th className="text-left px-3 py-2">Status</th>
                                    <th className="text-left px-3 py-2">Duration</th>
                                    <th className="text-left px-3 py-2">Shot Type</th>
                                    <th className="text-left px-3 py-2">Camera Direction</th>
                                    <th className="text-left px-3 py-2">Framing</th>
                                    <th className="text-left px-3 py-2">Overlays</th>
                                    <th className="text-left px-3 py-2">Snap To Beat</th>
                                </tr>
                            </thead>
                            <tbody>
                                {scenes.map((scene, idx) => (
                                    <tr key={scene.id} className="border-t border-border/30 bg-white/[0.01]">
                                        <td className="px-3 py-2 align-top">
                                            <div className="min-w-40">
                                                <p className="text-zinc-200 font-medium">#{idx + 1}</p>
                                                <p className="text-zinc-400 truncate">{scene.title}</p>
                                            </div>
                                        </td>
                                        <td className="px-3 py-2 align-top">
                                            <span
                                                className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5"
                                                style={{
                                                    borderColor: `${STATUS_COLORS[scene.status]}60`,
                                                    color: STATUS_COLORS[scene.status],
                                                }}
                                            >
                                                {STATUS_LABELS[scene.status]}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2 align-top text-zinc-400">
                                            {formatDuration(scene.estimatedDurationSec)}
                                        </td>
                                        <td className="px-3 py-2 align-top">
                                            <select
                                                value={scene.shotType}
                                                onChange={(e) =>
                                                    onUpdateScene(scene.id, {
                                                        shotType: e.target.value as Scene["shotType"],
                                                    })
                                                }
                                                className="input-field text-xs py-1.5 min-w-28"
                                            >
                                                {SHOT_TYPES.map((type) => (
                                                    <option key={type} value={type}>
                                                        {SHOT_TYPE_LABELS[type]}
                                                    </option>
                                                ))}
                                            </select>
                                        </td>
                                        <td className="px-3 py-2 align-top">
                                            <textarea
                                                rows={2}
                                                value={scene.cameraDirectionNotes || ""}
                                                onChange={(e) =>
                                                    onUpdateScene(scene.id, {
                                                        cameraDirectionNotes: e.target.value,
                                                    })
                                                }
                                                className="textarea-field text-xs min-w-56"
                                                placeholder="Camera direction notes"
                                            />
                                        </td>
                                        <td className="px-3 py-2 align-top">
                                            <textarea
                                                rows={2}
                                                value={scene.framingNotes || ""}
                                                onChange={(e) =>
                                                    onUpdateScene(scene.id, {
                                                        framingNotes: e.target.value,
                                                    })
                                                }
                                                className="textarea-field text-xs min-w-56"
                                                placeholder="Framing notes"
                                            />
                                        </td>
                                        <td className="px-3 py-2 align-top text-zinc-400">
                                            {(scene.overlaySlots || []).length}
                                        </td>
                                        <td className="px-3 py-2 align-top">
                                            <input
                                                type="checkbox"
                                                checked={Boolean(scene.snapToBeat)}
                                                onChange={(e) =>
                                                    onUpdateScene(scene.id, {
                                                        snapToBeat: e.target.checked,
                                                    })
                                                }
                                            />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </main>
    );
}
