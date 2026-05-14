const express = require("express");
const multer = require("multer");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const app = express();

app.use(cors());
app.use(express.json());

const SUPABASE_URL = "https://paezlzjonablaseodpze.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBhZXpsempvbmFibGFzZW9kcHplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2Njk5NzksImV4cCI6MjA5NDI0NTk3OX0.Ud7pdjYTXDwsIS4QZ46KkJ4QRFmj7HHj10anHmZRv6k";
const BUCKET = "Files";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Lokaler Cache-Ordner auf Render
const uploadFolder = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadFolder)) {
    fs.mkdirSync(uploadFolder);
}

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// ── Hilfsfunktion: Datei von Supabase herunterladen & lokal speichern ──
async function syncFileFromSupabase(fileName) {
    const localPath = path.join(uploadFolder, fileName);
    if (fs.existsSync(localPath)) return localPath; // schon gecacht

    console.log(`Lade von Supabase: ${fileName}`);
    const { data, error } = await supabase.storage
        .from(BUCKET)
        .download(fileName);

    if (error || !data) {
        console.error("Supabase Download Fehler:", error?.message);
        return null;
    }

    const buffer = Buffer.from(await data.arrayBuffer());
    fs.writeFileSync(localPath, buffer);
    return localPath;
}

// ── Alle Dateien von Supabase beim Start synchronisieren ──
async function syncAllFiles() {
    console.log("Synchronisiere alle Dateien von Supabase...");
    const { data, error } = await supabase.storage.from(BUCKET).list();
    if (error || !data) {
        console.error("Fehler beim Laden der Dateiliste:", error?.message);
        return;
    }

    for (const file of data) {
        await syncFileFromSupabase(file.name);
    }
    console.log(`${data.length} Datei(en) synchronisiert.`);
}

// ── Root ───────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
    res.send("HTML Server läuft.");
});

// ── Upload → Supabase + lokal speichern ───────────────────────────────
app.post("/upload", upload.single("file"), async (req, res) => {

    if (!req.file) {
        return res.status(400).json({ success: false, message: "Keine Datei hochgeladen" });
    }

    const fileName = Date.now() + "_" + req.file.originalname;
    const isHtml = /\.html?$/i.test(req.file.originalname);
    const contentType = isHtml ? "text/html; charset=utf-8" : req.file.mimetype;

    // 1. Zu Supabase hochladen (dauerhaft gespeichert)
    const { error } = await supabase.storage
        .from(BUCKET)
        .upload(fileName, req.file.buffer, { contentType, upsert: true });

    if (error) {
        return res.status(500).json({ success: false, error: error.message });
    }

    // 2. Lokal auf Render speichern (für direktes Serving)
    const localPath = path.join(uploadFolder, fileName);
    fs.writeFileSync(localPath, req.file.buffer);

    res.json({
        success: true,
        filename: fileName,
        // URL zeigt auf diesen Server → HTML wird korrekt gerendert!
        url: `/files/${fileName}`
    });
});

// ── Dateiliste ─────────────────────────────────────────────────────────
app.get("/files", async (req, res) => {
    const { data, error } = await supabase.storage.from(BUCKET).list();

    if (error) {
        return res.status(500).json({ success: false, error: error.message });
    }

    // URLs zeigen auf diesen Server, nicht direkt auf Supabase
    const files = data.map(file => ({
        name: file.name,
        url: `/files/${file.name}`
    }));

    res.json(files);
});

// ── Datei löschen ─────────────────────────────────────────────────────
app.delete("/delete/:name", async (req, res) => {
    const fileName = req.params.name;
    const localPath = path.join(uploadFolder, fileName);

    console.log(`[DELETE] Versuche zu löschen: "${fileName}"`);

    // 1. Aus Supabase löschen
    const { data, error } = await supabase.storage.from(BUCKET).remove([fileName]);

    console.log(`[DELETE] Supabase response:`, JSON.stringify({ data, error }));

    if (error) {
        return res.status(500).json({ success: false, error: error.message });
    }

    // Supabase gibt kein Error zurück, auch wenn RLS die Löschung blockiert.
    // Wir prüfen daher ob die Datei danach noch existiert.
    const { data: checkData } = await supabase.storage.from(BUCKET).list();
    const stillExists = checkData && checkData.some(f => f.name === fileName);

    if (stillExists) {
        console.log(`[DELETE] Datei existiert noch nach remove() – vermutlich RLS-Policy blockiert!`);
        return res.status(403).json({
            success: false,
            error: "Supabase hat die Löschung blockiert. Bitte DELETE-Policy im Supabase Dashboard für den Anon-Key aktivieren: Storage → Policies → Files → INSERT/SELECT/DELETE für anon erlauben."
        });
    }

    // 2. Lokal löschen falls vorhanden
    if (fs.existsSync(localPath)) fs.unlinkSync(localPath);

    console.log(`[DELETE] Erfolgreich gelöscht: "${fileName}"`);
    res.json({ success: true });
});

// ── Datei umbenennen ───────────────────────────────────────────────────
app.post("/rename", async (req, res) => {
    const { oldName, newName } = req.body;
    if (!oldName || !newName) return res.status(400).json({ success: false, error: "Fehlende Parameter" });

    const oldPath = path.join(uploadFolder, oldName);
    const newPath = path.join(uploadFolder, newName);

    // 1. In Supabase kopieren dann altes löschen (Supabase hat kein rename)
    const { error: copyError } = await supabase.storage.from(BUCKET).copy(oldName, newName);
    if (copyError) return res.status(500).json({ success: false, error: copyError.message });

    const { error: delError } = await supabase.storage.from(BUCKET).remove([oldName]);
    if (delError) return res.status(500).json({ success: false, error: delError.message });

    // 2. Lokal umbenennen falls vorhanden
    if (fs.existsSync(oldPath)) fs.renameSync(oldPath, newPath);

    res.json({ success: true });
});

// ── Datei als .html herunterladen ─────────────────────────────────────
app.get("/download/:name", async (req, res) => {
    const fileName = req.params.name;
    let localPath = path.join(uploadFolder, fileName);

    if (!fs.existsSync(localPath)) {
        localPath = await syncFileFromSupabase(fileName);
    }

    if (!localPath) {
        return res.status(404).send("Datei nicht gefunden");
    }

    const downloadName = /\.html?$/i.test(fileName) ? fileName : fileName + ".html";
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${downloadName}"`);
    res.sendFile(localPath);
});

// ── Speicherinfo für den Manager ──────────────────────────────────────
app.get("/storage-info", (req, res) => {
    const { execSync } = require("child_process");
    try {
        // Belegter Speicher im uploads-Ordner in Bytes
        const usedStr = execSync(`du -sb "${uploadFolder}" 2>/dev/null || echo "0"`).toString().trim();
        const usedBytes = parseInt(usedStr.split("\t")[0]) || 0;
        // Render Free Plan: 512 MB ephemeral disk
        const totalBytes = 512 * 1024 * 1024;
        res.json({ usedBytes, totalBytes });
    } catch {
        res.json({ usedBytes: 0, totalBytes: 512 * 1024 * 1024 });
    }
});

// ── Datei ausliefern (HTML wird gerendert!) ────────────────────────────
app.get("/files/:name", async (req, res) => {
    const fileName = req.params.name;
    let localPath = path.join(uploadFolder, fileName);

    // Falls lokal nicht vorhanden → von Supabase holen und cachen
    if (!fs.existsSync(localPath)) {
        localPath = await syncFileFromSupabase(fileName);
    }

    if (!localPath) {
        return res.status(404).send("Datei nicht gefunden");
    }

    const isHtml = /\.html?$/i.test(fileName);
    if (isHtml) {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
    }

    res.sendFile(localPath);
});

// ── Start ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
    console.log("Server läuft auf Port " + PORT);
    await syncAllFiles(); // Beim Start alle Dateien von Supabase laden
});
