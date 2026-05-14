const express = require("express");
const cors = require("cors");
const { ExpressPeerServer } = require("peer");
const http = require("http");

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

// ── PeerJS Server ──────────────────────────────────────────────────────
const peerServer = ExpressPeerServer(server, {
    debug: true,
    path: "/",
    allow_discovery: false
});

app.use("/peerjs", peerServer);

// ── Code-Mapping: 5-Zeichen Code → Peer-ID ────────────────────────────
// { "X7K2P": { peerId: "abc123...", createdAt: 1234567890 } }
const codeMap = new Map();

// Zeichen für Code-Generierung (keine 0/O/I/1 wegen Verwechslungsgefahr)
const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function genCode() {
    let code;
    do {
        code = Array.from({ length: 5 }, () =>
            CHARS[Math.floor(Math.random() * CHARS.length)]
        ).join("");
    } while (codeMap.has(code));
    return code;
}

// Abgelaufene Codes aufräumen (älter als 2 Stunden)
setInterval(() => {
    const cutoff = Date.now() - 2 * 60 * 60 * 1000;
    for (const [code, entry] of codeMap.entries()) {
        if (entry.createdAt < cutoff) {
            console.log(`[CLEANUP] Code ${code} abgelaufen`);
            codeMap.delete(code);
        }
    }
}, 10 * 60 * 1000);

// ── Root ───────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
    res.json({
        status: "ok",
        activeCodes: codeMap.size,
        message: "Duel Relay Server läuft ✓"
    });
});

// ── Code registrieren ──────────────────────────────────────────────────
// POST /register  { peerId: "abc123..." }
// → gibt { code: "X7K2P" } zurück
app.post("/register", (req, res) => {
    const { peerId } = req.body;
    if (!peerId) {
        return res.status(400).json({ success: false, error: "peerId fehlt" });
    }

    // Falls diese Peer-ID schon einen Code hat, denselben zurückgeben
    for (const [code, entry] of codeMap.entries()) {
        if (entry.peerId === peerId) {
            console.log(`[REGISTER] Bestehender Code ${code} für ${peerId.slice(0, 8)}...`);
            return res.json({ success: true, code });
        }
    }

    const code = genCode();
    codeMap.set(code, { peerId, createdAt: Date.now() });
    console.log(`[REGISTER] Neuer Code ${code} → ${peerId.slice(0, 8)}...`);
    res.json({ success: true, code });
});

// ── Code auflösen ──────────────────────────────────────────────────────
// GET /resolve/:code
// → gibt { peerId: "abc123..." } zurück
app.get("/resolve/:code", (req, res) => {
    const code = req.params.code.toUpperCase().trim();
    const entry = codeMap.get(code);

    if (!entry) {
        console.log(`[RESOLVE] Code ${code} nicht gefunden`);
        return res.status(404).json({ success: false, error: "Code nicht gefunden oder abgelaufen" });
    }

    console.log(`[RESOLVE] Code ${code} → ${entry.peerId.slice(0, 8)}...`);
    res.json({ success: true, peerId: entry.peerId });
});

// ── Code löschen wenn Spieler geht ────────────────────────────────────
// DELETE /unregister/:peerId
app.delete("/unregister/:peerId", (req, res) => {
    const { peerId } = req.params;
    for (const [code, entry] of codeMap.entries()) {
        if (entry.peerId === peerId) {
            codeMap.delete(code);
            console.log(`[UNREGISTER] Code ${code} gelöscht`);
            return res.json({ success: true });
        }
    }
    res.json({ success: true }); // Kein Fehler wenn nicht gefunden
});

// ── Start ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Duel Relay Server läuft auf Port ${PORT}`);
    console.log(`PeerJS: /peerjs | Code-API: /register /resolve/:code`);
});
