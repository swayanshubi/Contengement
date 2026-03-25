import fs from "fs";
import os from "os";
import path from "path";

const DEFAULT_APP_DIR_NAME = "Contengement";
const LEGACY_APP_DIR_NAMES: string[] = [];
const LEGACY_DIR_NAMES = [".contengement"];
const MIGRATION_MARKER_FILE = "migration-from-legacy.json";
const STORAGE_META_FILE = "storage-meta.json";

export const STORAGE_SCHEMA_VERSION = 1;

export interface StorageLayout {
    rootDir: string;
    projectsDir: string;
    uploadsDir: string;
    corruptDir: string;
    storageMetaPath: string;
    migrationMarkerPath: string;
}

interface StorageMeta {
    schemaVersion: number;
    createdAt: string;
    updatedAt: string;
    appDirName: string;
}

let cachedLayout: StorageLayout | null = null;
let didBootstrap = false;

function getConfiguredAppDirName(): string {
    const configured = process.env.CONTENGEMENT_APP_DIR_NAME?.trim();
    return configured || DEFAULT_APP_DIR_NAME;
}

function resolveUserDataBaseDir(): string {
    if (process.platform === "win32") {
        return process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    }
    if (process.platform === "darwin") {
        return path.join(os.homedir(), "Library", "Application Support");
    }
    return process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
}

export function getLegacyStorageRootDir(): string {
    return path.join(process.cwd(), LEGACY_DIR_NAMES[0]);
}

function resolveStorageRootDir(): string {
    const envOverride = process.env.CONTENGEMENT_DATA_DIR?.trim();
    if (envOverride) return path.resolve(envOverride);
    return path.join(resolveUserDataBaseDir(), getConfiguredAppDirName());
}

export function getStorageLayout(): StorageLayout {
    if (cachedLayout) return cachedLayout;

    const rootDir = resolveStorageRootDir();
    cachedLayout = {
        rootDir,
        projectsDir: path.join(rootDir, "projects"),
        uploadsDir: path.join(rootDir, "uploads"),
        corruptDir: path.join(rootDir, "corrupt"),
        storageMetaPath: path.join(rootDir, STORAGE_META_FILE),
        migrationMarkerPath: path.join(rootDir, MIGRATION_MARKER_FILE),
    };
    return cachedLayout;
}

function ensureBaseDirs(layout: StorageLayout) {
    [layout.rootDir, layout.projectsDir, layout.uploadsDir, layout.corruptDir].forEach((dir) => {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    });
}

function hasEntries(dir: string): boolean {
    if (!fs.existsSync(dir)) return false;
    return fs.readdirSync(dir).length > 0;
}

function hasCurrentData(layout: StorageLayout): boolean {
    return hasEntries(layout.projectsDir) || hasEntries(layout.uploadsDir);
}

function hasStorageData(rootDir: string): boolean {
    const projectsDir = path.join(rootDir, "projects");
    const uploadsDir = path.join(rootDir, "uploads");
    const indexFile = path.join(rootDir, "projects.json");
    return hasEntries(projectsDir) || hasEntries(uploadsDir) || fs.existsSync(indexFile);
}

function copyDirContents(srcDir: string, destDir: string) {
    if (!fs.existsSync(srcDir)) return;
    for (const entry of fs.readdirSync(srcDir)) {
        const srcPath = path.join(srcDir, entry);
        const destPath = path.join(destDir, entry);
        if (fs.existsSync(destPath)) continue;
        fs.cpSync(srcPath, destPath, { recursive: true });
    }
}

function writeMigrationMarker(layout: StorageLayout, legacyRoot: string) {
    const payload = {
        migratedAt: new Date().toISOString(),
        from: legacyRoot,
        to: layout.rootDir,
    };
    fs.writeFileSync(layout.migrationMarkerPath, JSON.stringify(payload, null, 2), "utf-8");
}

function getLegacyAppDataRoots(layout: StorageLayout): string[] {
    const baseDir = resolveUserDataBaseDir();
    return LEGACY_APP_DIR_NAMES.map((name) => path.join(baseDir, name)).filter(
        (candidate) => path.resolve(candidate) !== path.resolve(layout.rootDir)
    );
}

function migrateFromRoot(layout: StorageLayout, sourceRoot: string): boolean {
    if (!fs.existsSync(sourceRoot)) return false;
    if (path.resolve(sourceRoot) === path.resolve(layout.rootDir)) return false;
    if (!hasStorageData(sourceRoot)) return false;
    if (hasCurrentData(layout)) return false;

    try {
        copyDirContents(path.join(sourceRoot, "projects"), layout.projectsDir);
        copyDirContents(path.join(sourceRoot, "uploads"), layout.uploadsDir);

        const sourceIndexPath = path.join(sourceRoot, "projects.json");
        const currentIndexPath = path.join(layout.rootDir, "projects.json");
        if (fs.existsSync(sourceIndexPath) && !fs.existsSync(currentIndexPath)) {
            fs.cpSync(sourceIndexPath, currentIndexPath);
        }

        writeMigrationMarker(layout, sourceRoot);
        return true;
    } catch (error) {
        console.error("Legacy storage migration failed", error);
        return false;
    }
}

function migrateFromLegacyIfNeeded(layout: StorageLayout) {
    if (fs.existsSync(layout.migrationMarkerPath)) return;

    const localLegacyRoots = LEGACY_DIR_NAMES.map((dirName) => path.join(process.cwd(), dirName));
    const migrationSources = [...localLegacyRoots, ...getLegacyAppDataRoots(layout)];
    for (const sourceRoot of migrationSources) {
        if (migrateFromRoot(layout, sourceRoot)) {
            return;
        }
    }
}

function writeStorageMeta(layout: StorageLayout, existing?: Partial<StorageMeta>) {
    const now = new Date().toISOString();
    const next: StorageMeta = {
        schemaVersion: STORAGE_SCHEMA_VERSION,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        appDirName: getConfiguredAppDirName(),
    };
    fs.writeFileSync(layout.storageMetaPath, JSON.stringify(next, null, 2), "utf-8");
}

function ensureStorageMeta(layout: StorageLayout) {
    if (!fs.existsSync(layout.storageMetaPath)) {
        writeStorageMeta(layout);
        return;
    }

    let parsed: Partial<StorageMeta> | null = null;
    try {
        parsed = JSON.parse(fs.readFileSync(layout.storageMetaPath, "utf-8")) as Partial<StorageMeta>;
    } catch {
        writeStorageMeta(layout);
        return;
    }

    if (!parsed || typeof parsed !== "object") {
        writeStorageMeta(layout);
        return;
    }
    if (typeof parsed.schemaVersion !== "number") {
        writeStorageMeta(layout, parsed);
        return;
    }
    if (parsed.schemaVersion > STORAGE_SCHEMA_VERSION) {
        throw new Error(
            `Unsupported storage schema version ${parsed.schemaVersion}. Current version: ${STORAGE_SCHEMA_VERSION}`
        );
    }
    writeStorageMeta(layout, parsed);
}

export function ensureStorageReady(): StorageLayout {
    const layout = getStorageLayout();
    if (didBootstrap) return layout;

    ensureBaseDirs(layout);
    migrateFromLegacyIfNeeded(layout);
    ensureStorageMeta(layout);

    didBootstrap = true;
    return layout;
}
