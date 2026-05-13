const express = require("express");
const multer = require("multer");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();

app.use(cors());
app.use(express.json());

const SUPABASE_URL = "https://paezlzjonablaseodpze.supabase.co";

// HIER DEINEN ANON KEY EINSETZEN
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBhZXpsempvbmFibGFzZW9kcHplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2Njk5NzksImV4cCI6MjA5NDI0NTk3OX0.Ud7pdjYTXDwsIS4QZ46KkJ4QRFmj7HHj10anHmZRv6k";

const BUCKET = "Files";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.get("/", (req, res) => {
    res.send("Supabase Download Server läuft.");
});

// Upload
app.post("/upload", upload.single("file"), async (req, res) => {

    if (!req.file) {
        return res.status(400).json({
            success: false,
            message: "Keine Datei hochgeladen"
        });
    }

    const fileName = Date.now() + "_" + req.file.originalname;

    const { error } = await supabase.storage
        .from(BUCKET)
        .upload(fileName, req.file.buffer, {
            contentType: req.file.mimetype,
            upsert: true
        });

    if (error) {
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }

    const publicUrl =
        `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${fileName}`;

    res.json({
        success: true,
        url: publicUrl
    });

});

// Dateiliste
app.get("/files", async (req, res) => {

    const { data, error } = await supabase.storage
        .from(BUCKET)
        .list();

    if (error) {
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }

    const files = data.map(file => ({
        name: file.name,
        url:
        `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${file.name}`
    }));

    res.json(files);

});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log("Server läuft auf Port " + PORT);
});
