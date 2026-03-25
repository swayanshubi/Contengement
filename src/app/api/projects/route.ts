import { NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { getAllProjects, saveProject } from "@/lib/db";
import type { Project, ProjectData } from "@/lib/types";

export async function GET() {
    const projects = getAllProjects();
    return NextResponse.json(projects);
}

export async function POST(req: Request) {
    const body = await req.json();
    const now = new Date().toISOString();

    const project: Project = {
        id: uuid(),
        title: body.title || "Untitled Project",
        status: "draft",
        hook: "",
        targetPlatform: body.targetPlatform || "youtube",
        storyboardEnabled: body.storyboardEnabled ?? true,
        storyboardAspect: body.storyboardAspect,
        storyboardSafeZone: body.storyboardSafeZone ?? false,
        storyboard: body.storyboard,
        notesPad: typeof body.notesPad === "string" ? body.notesPad : "",
        audioTrack: body.audioTrack,
        createdAt: now,
        updatedAt: now,
    };

    const data: ProjectData = {
        project,
        scenes: [],
        assets: [],
    };

    saveProject(data);
    return NextResponse.json(project, { status: 201 });
}
