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
        url: `/files/${file.name}`,
        download_url: `/download/${file.name}`
    }));

    res.json(files);
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

// ── Datei als .html herunterladen ──────────────────────────────────────
app.get("/download/:name", async (req, res) => {
    const fileName = req.params.name;
    let localPath = path.join(uploadFolder, fileName);

    if (!fs.existsSync(localPath)) {
        localPath = await syncFileFromSupabase(fileName);
    }

    if (!localPath) {
        return res.status(404).send("Datei nicht gefunden");
    }

    // Dateiname immer mit .html-Endung
    const downloadName = /\.html?$/i.test(fileName) ? fileName : fileName + ".html";

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${downloadName}"`);
    res.sendFile(localPath);
});

// ── Start ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
    console.log("Server läuft auf Port " + PORT);
    await syncAllFiles(); // Beim Start alle Dateien von Supabase laden
});
