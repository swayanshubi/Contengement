"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, FileText, PanelRightClose, PanelRightOpen } from "lucide-react";
import type { ProjectData, Scene } from "@/lib/types";
import { useAppStore } from "@/lib/store";
import CompiledScriptModal from "@/components/editor/CompiledScriptModal";
import LeftPanel from "@/components/editor/LeftPanel";
import MasterScriptView from "@/components/editor/MasterScriptView";
import MiddlePanel from "@/components/editor/MiddlePanel";
import ProjectNotesView from "@/components/editor/ProjectNotesView";
import ProjectNavRail from "@/components/editor/ProjectNavRail";
import RightPanel from "@/components/editor/RightPanel";
import ShotListView from "@/components/editor/ShotListView";
import StoryboardView from "@/components/editor/StoryboardView";

type EditorView = "scene" | "storyboard" | "shot-list" | "master-script" | "notes";

export default function ProjectEditorPage() {
    const params = useParams();
    const router = useRouter();
    const projectId = params.id as string;

    const [data, setData] = useState<ProjectData | null>(null);
    const [loading, setLoading] = useState(true);
    const [editorView, setEditorView] = useState<EditorView>("scene");

    const {
        selectedSceneId,
        selectScene,
        rightPanelOpen,
        toggleRightPanel,
        compiledScriptOpen,
        setCompiledScriptOpen,
    } = useAppStore();

    const fetchData = useCallback(async () => {
        const res = await fetch(`/api/projects/${projectId}`);
        if (!res.ok) {
            router.push("/");
            return;
        }

        const nextData: ProjectData = await res.json();
        nextData.scenes.sort((a, b) => a.sortOrder - b.sortOrder);
        setData(nextData);
        setLoading(false);
    }, [projectId, router]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    async function addScene() {
        const res = await fetch(`/api/projects/${projectId}/scenes`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
        });

        if (!res.ok) {
            await fetchData();
            return;
        }

        const created: Scene = await res.json();
        setData((prev) => {
            if (!prev) return prev;
            return {
                ...prev,
                scenes: [...prev.scenes, created].sort((a, b) => a.sortOrder - b.sortOrder),
                project: { ...prev.project, updatedAt: new Date().toISOString() },
            };
        });
        selectScene(created.id);
    }

    async function updateScene(sceneId: string, updates: Partial<Scene>) {
        const previousData = data;
        setData((prev) => {
            if (!prev) return prev;
            return {
                ...prev,
                scenes: prev.scenes.map((scene) =>
                    scene.id === sceneId ? { ...scene, ...updates } : scene
                ),
                project: { ...prev.project, updatedAt: new Date().toISOString() },
            };
        });

        const res = await fetch(`/api/projects/${projectId}/scenes/${sceneId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(updates),
        });

        if (!res.ok) {
            setData(previousData);
            await fetchData();
            return;
        }

        const updatedScene: Scene | null = await res.json();
        if (!updatedScene) return;

        setData((prev) => {
            if (!prev) return prev;
            return {
                ...prev,
                scenes: prev.scenes.map((scene) =>
                    scene.id === sceneId ? { ...scene, ...updatedScene } : scene
                ),
            };
        });
    }

    async function removeScene(sceneId: string) {
        const previousData = data;
        setData((prev) => {
            if (!prev) return prev;
            const scenes = prev.scenes
                .filter((scene) => scene.id !== sceneId)
                .map((scene, index) => ({ ...scene, sortOrder: index }));

            return {
                ...prev,
                scenes,
                project: { ...prev.project, updatedAt: new Date().toISOString() },
            };
        });

        const res = await fetch(`/api/projects/${projectId}/scenes/${sceneId}`, {
            method: "DELETE",
        });

        if (!res.ok) {
            setData(previousData);
            await fetchData();
            return;
        }

        if (selectedSceneId === sceneId) {
            selectScene(null);
        }
    }

    async function moveScene(sceneId: string, direction: "up" | "down") {
        if (!data) return;

        const scenes = [...data.scenes].sort((a, b) => a.sortOrder - b.sortOrder);
        const index = scenes.findIndex((scene) => scene.id === sceneId);
        if (index < 0) return;
        if (direction === "up" && index === 0) return;
        if (direction === "down" && index === scenes.length - 1) return;

        const nextIndex = direction === "up" ? index - 1 : index + 1;
        [scenes[index], scenes[nextIndex]] = [scenes[nextIndex], scenes[index]];

        await reorderScenesByIds(scenes.map((scene) => scene.id));
    }

    async function reorderScenesByIds(orderedIds: string[]) {
        const previousData = data;
        setData((prev) => {
            if (!prev) return prev;
            const orderMap = new Map(orderedIds.map((id, index) => [id, index]));
            const nextScenes = prev.scenes
                .map((scene) => ({
                    ...scene,
                    sortOrder: orderMap.get(scene.id) ?? scene.sortOrder,
                }))
                .sort((a, b) => a.sortOrder - b.sortOrder);

            return {
                ...prev,
                scenes: nextScenes,
            };
        });

        const res = await fetch(`/api/projects/${projectId}/scenes/reorder`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderedIds }),
        });

        if (!res.ok) {
            setData(previousData);
            await fetchData();
            return;
        }

        const updatedScenes: Scene[] = await res.json();
        setData((prev) => (prev ? { ...prev, scenes: updatedScenes } : prev));
    }

    async function updateProject(updates: Record<string, unknown>) {
        const previousData = data;
        setData((prev) => {
            if (!prev) return prev;
            return {
                ...prev,
                project: {
                    ...prev.project,
                    ...updates,
                    updatedAt: new Date().toISOString(),
                },
            };
        });

        const res = await fetch(`/api/projects/${projectId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(updates),
        });

        if (!res.ok) {
            setData(previousData);
            await fetchData();
            return;
        }

        const project = await res.json();
        setData((prev) => (prev ? { ...prev, project } : prev));
    }

    async function linkAsset(assetId: string, sceneId: string) {
        const previousData = data;
        setData((prev) => {
            if (!prev) return prev;
            return {
                ...prev,
                assets: prev.assets.map((asset) =>
                    asset.id === assetId && !asset.sceneIds.includes(sceneId)
                        ? { ...asset, sceneIds: [...asset.sceneIds, sceneId] }
                        : asset
                ),
            };
        });

        const res = await fetch(`/api/projects/${projectId}/assets/link`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ assetId, sceneId, action: "link" }),
        });

        if (!res.ok) {
            setData(previousData);
            await fetchData();
        }
    }

    async function unlinkAsset(assetId: string, sceneId: string) {
        const previousData = data;
        setData((prev) => {
            if (!prev) return prev;
            return {
                ...prev,
                assets: prev.assets.map((asset) =>
                    asset.id === assetId
                        ? { ...asset, sceneIds: asset.sceneIds.filter((id) => id !== sceneId) }
                        : asset
                ),
            };
        });

        const res = await fetch(`/api/projects/${projectId}/assets/link`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ assetId, sceneId, action: "unlink" }),
        });

        if (!res.ok) {
            setData(previousData);
            await fetchData();
        }
    }

    async function createSceneFromMasterScript(input: {
        title: string;
        scriptBody: string;
    }) {
        const res = await fetch(`/api/projects/${projectId}/scenes`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                title: input.title,
                scriptBody: input.scriptBody,
                status: "scripted",
            }),
        });

        if (!res.ok) {
            await fetchData();
            return;
        }
        await fetchData();
    }

    if (loading || !data) {
        return (
            <div className="flex h-full items-center justify-center bg-[var(--bg-primary)]">
                <div className="h-6 w-6 rounded-full border-2 border-accent/30 border-t-accent animate-spin" />
            </div>
        );
    }

    const selectedScene = data.scenes.find((scene) => scene.id === selectedSceneId) || null;

    return (
        <div className="flex h-full flex-col overflow-hidden bg-[var(--bg-primary)]">
            <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border/50 bg-gradient-to-r from-zinc-950 via-zinc-950 to-zinc-900/80 px-4">
                <button
                    onClick={() => router.push("/")}
                    className="btn-ghost flex items-center gap-1.5 text-sm"
                >
                    <ArrowLeft className="h-4 w-4" />
                    <span className="hidden sm:inline">Dashboard</span>
                </button>

                <div className="h-5 w-px bg-border/60" />

                <div className="min-w-0 flex-1">
                    <p className="text-[10px] uppercase tracking-[0.28em] text-zinc-500">
                        Project Workspace
                    </p>
                    <h1 className="truncate text-sm font-semibold text-zinc-100">
                        {data.project.title}
                    </h1>
                </div>

                <button
                    onClick={() => setCompiledScriptOpen(true)}
                    className="btn-ghost flex items-center gap-1 text-xs"
                >
                    <FileText className="h-3.5 w-3.5" />
                    Script
                </button>

                <button onClick={toggleRightPanel} className="btn-ghost p-1.5">
                    {rightPanelOpen ? (
                        <PanelRightClose className="h-4 w-4" />
                    ) : (
                        <PanelRightOpen className="h-4 w-4" />
                    )}
                </button>
            </header>

            <div className="relative flex flex-1 overflow-hidden">
                <div className="project-rail-group pointer-events-none absolute inset-y-0 left-0 z-40 flex">
                    <div className="project-rail-edge pointer-events-auto h-full w-5" />
                    <div className="project-rail-shell pointer-events-auto my-3 h-[calc(100%-1.5rem)]">
                        <ProjectNavRail
                            projectTitle={data.project.title}
                            editorView={editorView}
                            onChangeView={setEditorView}
                            onOpenScript={() => setCompiledScriptOpen(true)}
                        />
                    </div>
                </div>

                {editorView !== "storyboard" && editorView !== "master-script" && editorView !== "notes" && (
                    <LeftPanel
                        project={data.project}
                        scenes={data.scenes}
                        selectedSceneId={selectedSceneId}
                        onSelectScene={selectScene}
                        onAddScene={addScene}
                        onRemoveScene={removeScene}
                        onMoveScene={moveScene}
                        onUpdateProject={updateProject}
                    />
                )}

                {editorView === "scene" && (
                    <MiddlePanel
                        scene={selectedScene}
                        assets={data.assets}
                        onUpdate={(updates) => {
                            if (selectedScene) {
                                updateScene(selectedScene.id, updates);
                            }
                        }}
                        onLinkAsset={(assetId) => {
                            if (selectedScene) {
                                linkAsset(assetId, selectedScene.id);
                            }
                        }}
                        onUnlinkAsset={(assetId) => {
                            if (selectedScene) {
                                unlinkAsset(assetId, selectedScene.id);
                            }
                        }}
                    />
                )}

                {editorView === "shot-list" && (
                    <ShotListView
                        project={data.project}
                        scenes={data.scenes}
                        onUpdateScene={updateScene}
                    />
                )}

                {editorView === "storyboard" && (
                    <StoryboardView
                        project={data.project}
                        scenes={data.scenes}
                        assets={data.assets}
                        onUpdateProject={updateProject}
                        onUpdateScene={updateScene}
                        onReorderScenes={reorderScenesByIds}
                    />
                )}

                {editorView === "master-script" && (
                    <MasterScriptView
                        project={data.project}
                        scenes={data.scenes}
                        onUpdateProject={updateProject}
                        onCreateSceneFromScript={createSceneFromMasterScript}
                    />
                )}

                {editorView === "notes" && (
                    <ProjectNotesView
                        project={data.project}
                        onUpdateProject={updateProject}
                    />
                )}

                {rightPanelOpen && (
                    <RightPanel
                        assets={data.assets}
                        scenes={data.scenes}
                        projectId={projectId}
                        onRefresh={fetchData}
                    />
                )}
            </div>

            {compiledScriptOpen && (
                <CompiledScriptModal
                    scenes={data.scenes}
                    projectTitle={data.project.title}
                    onClose={() => setCompiledScriptOpen(false)}
                />
            )}
        </div>
    );
}
