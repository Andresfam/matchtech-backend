import express from "express";
import cors from "cors";
import { preguntarIA } from "./ia.js";
import mysql from "mysql2/promise";
import PDFDocument from "pdfkit";
import nodemailer from "nodemailer";
import { PassThrough } from "stream";

const app = express();

app.use(cors({
  origin: "*",
  methods: "GET,POST,PUT,DELETE,OPTIONS",
  allowedHeaders: ["Content-Type", "Authorization"],
  preflightContinue: false,
  optionsSuccessStatus: 200
}));

// Manejo explícito de preflight OPTIONS
app.options("*", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.sendStatus(200);
});

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));


const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

function safeJson(res, status, payload) {
  res.status(status).json(payload);
}

app.post("/api/chats", async (req, res) => {
  try {
    const { id_usuario, titulo = "Nuevo chat" } = req.body;

    if (!id_usuario) return safeJson(res, 400, { error: "id_usuario es requerido" });

    const [result] = await pool.execute(
      "INSERT INTO chats (id_usuario, titulo) VALUES (?, ?)",
      [id_usuario, titulo]
    );

    return safeJson(res, 200, {
      id_chat: result.insertId,
      titulo,
      mensaje: "Chat creado exitosamente",
    });
  } catch (error) {
    console.error("❌ Error creando chat:", error);
    return safeJson(res, 500, { error: "Error al crear chat" });
  }
});

app.get("/api/chats/:id_usuario", async (req, res) => {
  try {
    const { id_usuario } = req.params;
    const [chats] = await pool.execute(
      "SELECT * FROM chats WHERE id_usuario = ? AND eliminado = 0 ORDER BY fecha_actualizado DESC",
      [id_usuario]
    );

    return safeJson(res, 200, chats);
  } catch (error) {
    console.error("❌ Error obteniendo chats:", error);
    return safeJson(res, 500, { error: "Error al obtener chats" });
  }
});

app.put("/api/chats/:id_chat", async (req, res) => {
  try {
    const { id_chat } = req.params;
    const { titulo } = req.body;

    if (!titulo) return safeJson(res, 400, { error: "titulo es requerido" });

    await pool.execute(
      "UPDATE chats SET titulo = ?, fecha_actualizado = CURRENT_TIMESTAMP WHERE id_chat = ?",
      [titulo, id_chat]
    );

    return safeJson(res, 200, { mensaje: "Título actualizado" });
  } catch (error) {
    console.error("❌ Error actualizando chat:", error);
    return safeJson(res, 500, { error: "Error al actualizar chat" });
  }
});

app.get("/api/mensajes/:id_chat", async (req, res) => {
  try {
    const { id_chat } = req.params;
    const [mensajes] = await pool.execute(
      "SELECT * FROM mensajes WHERE id_chat = ? AND eliminado = 0 ORDER BY fecha ASC",
      [id_chat]
    );

    return safeJson(res, 200, mensajes);
  } catch (error) {
    console.error("❌ Error obteniendo mensajes:", error);
    return safeJson(res, 500, { error: "Error al obtener mensajes" });
  }
});

app.post("/api/mensajes", async (req, res) => {
  try {
    const { id_chat, contenido, rol = "user" } = req.body;

    if (!id_chat || !contenido)
      return safeJson(res, 400, { error: "id_chat y contenido son requeridos" });

    const [result] = await pool.execute(
      "INSERT INTO mensajes (id_chat, rol, contenido) VALUES (?, ?, ?)",
      [id_chat, rol, contenido]
    );

    await pool.execute(
      "UPDATE chats SET fecha_actualizado = CURRENT_TIMESTAMP WHERE id_chat = ?",
      [id_chat]
    );

    let respuestaIA = "";

    if (rol === "user") {
      console.log("💬 Mensaje recibido:", contenido);

      try {
        respuestaIA = await preguntarIA(contenido);
      } catch (err) {
        console.error("❌ Error en IA:", err);
        respuestaIA = "Lo siento, no pude procesar tu mensaje.";
      }

      await pool.execute(
        'INSERT INTO mensajes (id_chat, rol, contenido) VALUES (?, "bot", ?)',
        [id_chat, respuestaIA]
      );

      const [[count]] = await pool.execute(
        `SELECT COUNT(*) as count FROM mensajes 
         WHERE id_chat = ? AND rol = "user"`,
        [id_chat]
      );

      if (count.count === 1) {
        const promptTitulo = `
          Genera un título de máximo 4 palabras para esta conversación:
          "${contenido}"
          Responde solo el título.
        `;

        try {
          let tituloChat = await preguntarIA(promptTitulo);
          tituloChat = tituloChat.trim().substring(0, 40);

          await pool.execute("UPDATE chats SET titulo = ? WHERE id_chat = ?", [
            tituloChat,
            id_chat,
          ]);

          console.log("📝 Título generado:", tituloChat);
        } catch {
          const fallback = contenido.substring(0, 20) + "...";
          await pool.execute("UPDATE chats SET titulo = ? WHERE id_chat = ?", [
            fallback,
            id_chat,
          ]);
        }
      }
    }

    const [[chatActualizado]] = await pool.execute(
      "SELECT titulo FROM chats WHERE id_chat = ?",
      [id_chat]
    );

    return safeJson(res, 200, {
      respuesta: respuestaIA,
      id_mensaje: result.insertId,
      tituloChat: chatActualizado ? chatActualizado.titulo : null,
      id_chat,
    });
  } catch (error) {
    console.error("❌ Error guardando mensaje:", error);
    return safeJson(res, 500, { error: "Error al guardar mensaje" });
  }
});

app.post("/api/chat", async (req, res) => {
  try {
    const { mensaje } = req.body;

    if (!mensaje) return safeJson(res, 400, { error: "Mensaje vacío" });

    const respuesta = await preguntarIA(mensaje);

    return safeJson(res, 200, { respuesta });
  } catch (error) {
    console.error("❌ Error en /api/chat:", error);
    return safeJson(res, 500, { respuesta: "Error en el servidor." });
  }
});

app.delete("/api/chats/:id_chat", async (req, res) => {
  try {
    const { id_chat } = req.params;

    await pool.execute(
      "UPDATE chats SET eliminado = 1, fecha_actualizado = CURRENT_TIMESTAMP WHERE id_chat = ?",
      [id_chat]
    );

    return safeJson(res, 200, { mensaje: "Chat eliminado" });
  } catch (error) {
    console.error("❌ Error eliminando chat:", error);
    return safeJson(res, 500, { error: "Error al eliminar chat" });
  }
});

app.get("/health", async (req, res) => {
  try {
    await pool.execute("SELECT 1");

    return safeJson(res, 200, {
      status: "Servidor OK",
      modelo: "deepseek.v3-v1:0",
      db: "Conectada",
    });
  } catch (error) {
    return safeJson(res, 500, {
      status: "Error",
      db: "Falló",
      error: error.message,
    });
  }
});

app.post("/api/pdf", (req, res) => {
  try {
    const { titulo, contenido } = req.body;

    if (!titulo || !contenido)
      return safeJson(res, 400, { error: "Faltan datos" });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${titulo}.pdf"`);

    const doc = new PDFDocument();
    doc.pipe(res);

    doc.fontSize(24).text(titulo, { align: "center" });
    doc.moveDown();
    doc.fontSize(12).text(contenido);

    doc.end();
  } catch (error) {
    console.error("❌ Error generando PDF:", error);
    return safeJson(res, 500, { error: "Error al generar PDF" });
  }
});

app.post("/api/enviarCorreo", async (req, res) => {
  try {
    const { email, titulo, contenido } = req.body;

    if (!email || !titulo || !contenido)
      return safeJson(res, 400, { error: "Faltan datos" });

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    const doc = new PDFDocument();
    const buffers = [];

    doc.on("data", (chunk) => buffers.push(chunk));

    doc.on("end", async () => {
      const pdfBuffer = Buffer.concat(buffers);

      try {
        await transporter.sendMail({
          from: `"MatchTech" <${process.env.EMAIL_USER}>"`,
          to: email,
          subject: `Chat compartido: ${titulo}`,
          text: "Adjunto el PDF con tu chat.",
          attachments: [
            {
              filename: `${titulo}.pdf`,
              content: pdfBuffer,
            },
          ],
        });

        return safeJson(res, 200, { mensaje: "Correo enviado" });
      } catch (err) {
        console.error("❌ Error enviando correo:", err);
        return safeJson(res, 500, { error: "No se pudo enviar el correo" });
      }
    });

    doc.fontSize(24).text(titulo, { align: "center" });
    doc.moveDown();
    doc.fontSize(12).text(contenido);
    doc.end();
  } catch (error) {
    console.error("❌ Error en enviarCorreo:", error);
    return safeJson(res, 500, { error: "Error interno" });
  }
});

app.use((req, res) => {
  res.status(404).json({ error: "Endpoint no encontrado" });
});

app.use((err, req, res, next) => {
  console.error("🔥 Error global:", err);
  res.status(500).json({
    error: "Error interno del servidor",
    mensaje: "Algo salió mal.",
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌍 Servidor activo en puerto ${PORT}`);
});
