"use client";

import { useEffect, useRef, useState } from "react";
import type { Project } from "@/lib/types";

interface ProjectNotesViewProps {
    project: Project;
    onUpdateProject: (updates: Record<string, unknown>) => void;
}

export default function ProjectNotesView({ project, onUpdateProject }: ProjectNotesViewProps) {
    const [value, setValue] = useState(project.notesPad || "");
    const saveTimer = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        setValue(project.notesPad || "");
    }, [project.id, project.notesPad]);

    function queueSave(nextValue: string) {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => {
            onUpdateProject({ notesPad: nextValue });
        }, 250);
    }

    return (
        <main className="flex-1 overflow-y-auto bg-[var(--bg-primary)] p-6">
            <div className="mx-auto flex h-full w-full max-w-5xl flex-col">
                <div className="mb-3">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">
                        Freeform Notes
                    </p>
                    <h2 className="text-sm font-semibold text-zinc-100">
                        Capture anything with no rules
                    </h2>
                </div>
                <textarea
                    value={value}
                    onChange={(event) => {
                        const nextValue = event.target.value;
                        setValue(nextValue);
                        queueSave(nextValue);
                    }}
                    placeholder="Write anything here: ideas, research, learning notes, reminders, or future script plans."
                    className="min-h-[82vh] w-full resize-y rounded-2xl border border-zinc-700/80 bg-[linear-gradient(180deg,rgba(32,36,44,0.96)_0%,rgba(25,29,36,0.96)_100%)] p-5 text-sm leading-7 text-zinc-100 placeholder:text-zinc-500 shadow-[0_18px_48px_rgba(0,0,0,0.34)] outline-none focus:border-cyan-400/35 focus:ring-1 focus:ring-cyan-400/30"
                />
            </div>
        </main>
    );
}
