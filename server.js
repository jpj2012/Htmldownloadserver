const express = require("express");
const multer = require("multer");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();

app.use(cors());
app.use(express.json());

const uploadFolder = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadFolder)) {
    fs.mkdirSync(uploadFolder);
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadFolder);
    },
    filename: function (req, file, cb) {
        cb(null, file.originalname);
    }
});

const upload = multer({ storage: storage });

app.get("/", (req, res) => {
    res.send("HTML Upload Server läuft.");
});

// Datei hochladen
app.post("/upload", upload.single("file"), (req, res) => {
    if (!req.file) {
        return res.status(400).json({
            success: false,
            message: "Keine Datei hochgeladen"
        });
    }

    res.json({
        success: true,
        filename: req.file.filename,
        url: `/files/${req.file.filename}`
    });
});

// Alle Dateien anzeigen
app.get("/files", (req, res) => {
    fs.readdir(uploadFolder, (err, files) => {
        if (err) {
            return res.status(500).json({
                success: false
            });
        }

        res.json(files);
    });
});

// Datei herunterladen
app.get("/files/:name", (req, res) => {
    const filePath = path.join(uploadFolder, req.params.name);

    if (!fs.existsSync(filePath)) {
        return res.status(404).send("Datei nicht gefunden");
    }

    res.download(filePath);
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log("Server läuft auf Port " + PORT);
});
