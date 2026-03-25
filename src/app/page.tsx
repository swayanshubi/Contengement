"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import {
    Plus,
    Film,
    Clock,
    LayoutList,
    Trash2,
    Sparkles,
} from "lucide-react";
import type { Project } from "@/lib/types";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

export default function DashboardPage() {
    const [projects, setProjects] = useState<Project[]>([]);
    const [loading, setLoading] = useState(true);
    const [showCreate, setShowCreate] = useState(false);
    const [newTitle, setNewTitle] = useState("");
    const [projectToDelete, setProjectToDelete] = useState<string | null>(null);

    useEffect(() => {
        fetchProjects();
    }, []);

    async function fetchProjects() {
        const res = await fetch("/api/projects");
        const data = await res.json();
        setProjects(data);
        setLoading(false);
    }

    async function createProject() {
        if (!newTitle.trim()) return;
        await fetch("/api/projects", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: newTitle.trim() }),
        });
        setNewTitle("");
        setShowCreate(false);
        fetchProjects();
    }

    async function deleteProject(id: string, e: React.MouseEvent) {
        e.preventDefault();
        e.stopPropagation();
        setProjectToDelete(id);
    }

    async function confirmDeleteProject() {
        if (!projectToDelete) return;
        const id = projectToDelete;
        setProjectToDelete(null);
        await fetch(`/api/projects/${id}`, { method: "DELETE" });
        fetchProjects();
    }

    return (
        <div className="min-h-full bg-[var(--bg-primary)]">
            {/* ─── Header ─── */}
            <header className="border-b border-border/50">
                <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-surface-elevated border border-border/40 flex items-center justify-center shadow-lg shadow-accent/20 overflow-hidden">
                            <Image
                                src="/contengement-mascot.svg"
                                alt="Contengement mascot"
                                width={36}
                                height={36}
                                className="w-9 h-9 object-contain p-0.5"
                                priority
                            />
                        </div>
                        <div>
                            <h1 className="text-lg font-bold gradient-text">Contengement</h1>
                            <p className="text-[11px] text-zinc-500 tracking-wide">
                                Content Management
                            </p>
                        </div>
                    </div>
                    <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2">
                        <Plus className="w-4 h-4" />
                        New Project
                    </button>
                </div>
            </header>

            {/* ─── Content ─── */}
            <main className="max-w-6xl mx-auto px-6 py-8">
                {loading ? (
                    <div className="flex items-center justify-center h-64">
                        <div className="w-6 h-6 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
                    </div>
                ) : projects.length === 0 ? (
                    /* ─── Empty State ─── */
                    <div className="flex flex-col items-center justify-center h-[60vh] animate-fade-in">
                        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-violet-500/10 to-indigo-600/10 border border-accent/20 flex items-center justify-center mb-6">
                            <Sparkles className="w-10 h-10 text-accent/60" />
                        </div>
                        <h2 className="text-xl font-semibold text-zinc-200 mb-2">
                            No projects yet
                        </h2>
                        <p className="text-zinc-500 text-sm mb-6 max-w-sm text-center">
                            Create your first project to start planning scenes, writing
                            scripts, and organizing your production.
                        </p>
                        <button
                            onClick={() => setShowCreate(true)}
                            className="btn-primary flex items-center gap-2"
                        >
                            <Plus className="w-4 h-4" />
                            Create First Project
                        </button>
                    </div>
                ) : (
                    /* ─── Project Grid ─── */
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 animate-fade-in">
                        {projects.map((project) => (
                            <Link
                                key={project.id}
                                href={`/project/${project.id}`}
                                className="block group glass-panel p-5 hover:border-accent/30 hover:shadow-lg hover:shadow-accent/5 transition-all duration-300"
                            >
                                <div className="flex items-start justify-between mb-4">
                                    <div className="flex items-center gap-2.5">
                                        <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
                                            <Film className="w-4 h-4 text-accent" />
                                        </div>
                                        <div>
                                            <h3 className="font-semibold text-zinc-100 group-hover:text-white transition-colors line-clamp-1">
                                                {project.title}
                                            </h3>
                                            <span className="status-badge text-[10px] bg-surface-elevated border-border mt-1">
                                                {project.status}
                                            </span>
                                        </div>
                                    </div>
                                    <button
                                        onClick={(e) => deleteProject(project.id, e)}
                                        className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-500/10 rounded-md transition-all"
                                    >
                                        <Trash2 className="w-3.5 h-3.5 text-zinc-500 hover:text-red-400" />
                                    </button>
                                </div>

                                <div className="flex items-center gap-4 text-xs text-zinc-500">
                                    <span className="flex items-center gap-1">
                                        <LayoutList className="w-3 h-3" />0 scenes
                                    </span>
                                    <span className="flex items-center gap-1">
                                        <Clock className="w-3 h-3" />0:00
                                    </span>
                                </div>

                                <div className="mt-3 pt-3 border-t border-border/40">
                                    <p className="text-[11px] text-zinc-600">
                                        Updated{" "}
                                        {new Date(project.updatedAt).toLocaleDateString("en-US", {
                                            month: "short",
                                            day: "numeric",
                                        })}
                                    </p>
                                </div>
                            </Link>
                        ))}
                    </div>
                )}
            </main>

            {/* ─── Create Modal ─── */}
            {showCreate && (
                <div className="modal-overlay" onClick={() => setShowCreate(false)}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                        <h2 className="text-lg font-semibold text-zinc-100 mb-1">
                            New Project
                        </h2>
                        <p className="text-sm text-zinc-500 mb-5">
                            Give your video project a working title.
                        </p>
                        <input
                            autoFocus
                            type="text"
                            placeholder="e.g. How I Built My SaaS in 30 Days"
                            className="input-field mb-4"
                            value={newTitle}
                            onChange={(e) => setNewTitle(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && createProject()}
                        />
                        <div className="flex justify-end gap-2">
                            <button
                                onClick={() => setShowCreate(false)}
                                className="btn-secondary text-sm"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={createProject}
                                disabled={!newTitle.trim()}
                                className="btn-primary text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                Create Project
                            </button>
                        </div>
                    </div>
                </div>
            )}
            <ConfirmDialog
                open={Boolean(projectToDelete)}
                title="Delete project?"
                message="This will remove the project and all related data."
                confirmLabel="Delete"
                danger
                onCancel={() => setProjectToDelete(null)}
                onConfirm={confirmDeleteProject}
            />
        </div>
    );
}
