import { NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { getProject, addScene } from "@/lib/db";
import type { Scene } from "@/lib/types";

export async function GET(
    _req: Request,
    { params }: { params: { id: string } }
) {
    const data = getProject(params.id);
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const sorted = [...data.scenes].sort((a, b) => a.sortOrder - b.sortOrder);
    return NextResponse.json(sorted);
}

export async function POST(
    req: Request,
    { params }: { params: { id: string } }
) {
    const data = getProject(params.id);
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = await req.json();
    const maxOrder = data.scenes.reduce((max, s) => Math.max(max, s.sortOrder), -1);

    const scene: Scene = {
        id: uuid(),
        projectId: params.id,
        sortOrder: maxOrder + 1,
        title: body.title || `Scene ${data.scenes.length + 1}`,
        goal: body.goal || "",
        shotType: body.shotType || "a-roll",
        estimatedDurationSec: body.estimatedDurationSec || 0,
        status: body.status || "planned",
        scriptBody: body.scriptBody || "",
        notes: body.notes || "",
        cta: "",
        cameraDirectionNotes: "",
        framingNotes: "",
        overlaySlots: [],
        hookType: "",
        hookNotes: "",
        snapToBeat: false,
    };

    const updated = addScene(params.id, scene);
    if (!updated) return NextResponse.json({ error: "Failed" }, { status: 500 });
    return NextResponse.json(scene, { status: 201 });
}
