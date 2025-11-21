import express from "express";
import cors from "cors";
import { preguntarIA, probarModelo } from "./ia.js";
import mysql from "mysql2/promise";
import PDFDocument from "pdfkit";
import nodemailer from "nodemailer";
import { PassThrough } from "stream";

const app = express();

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));


const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_CONN_LIMIT || "10"),
  queueLimit: 0
};

const pool = mysql.createPool(dbConfig);

function safeJson(res, status, payload) {
  res.status(status).json(payload);
}

app.post("/api/chats", async (req, res) => {
  try {
    const { id_usuario, titulo = 'Nuevo chat' } = req.body;
    if (!id_usuario) return safeJson(res, 400, { error: "id_usuario es requerido" });

    const [result] = await pool.execute(
      'INSERT INTO chats (id_usuario, titulo) VALUES (?, ?)',
      [id_usuario, titulo]
    );

    return safeJson(res, 200, {
      id_chat: result.insertId,
      titulo,
      mensaje: 'Chat creado exitosamente'
    });
  } catch (error) {
    console.error('❌ Error creando chat:', error);
    return safeJson(res, 500, { error: 'Error al crear chat' });
  }
});


app.get("/api/chats/:id_usuario", async (req, res) => {
  try {
    const { id_usuario } = req.params;
    const [chats] = await pool.execute(
      'SELECT * FROM chats WHERE id_usuario = ? AND eliminado = 0 ORDER BY fecha_actualizado DESC',
      [id_usuario]
    );
    return safeJson(res, 200, chats);
  } catch (error) {
    console.error('❌ Error obteniendo chats:', error);
    return safeJson(res, 500, { error: 'Error al obtener chats' });
  }
});

app.put("/api/chats/:id_chat", async (req, res) => {
  try {
    const { id_chat } = req.params;
    const { titulo } = req.body;
    if (!titulo) return safeJson(res, 400, { error: "titulo es requerido" });

    await pool.execute(
      'UPDATE chats SET titulo = ?, fecha_actualizado = CURRENT_TIMESTAMP WHERE id_chat = ?',
      [titulo, id_chat]
    );

    return safeJson(res, 200, { mensaje: 'Título actualizado' });
  } catch (error) {
    console.error('❌ Error actualizando chat:', error);
    return safeJson(res, 500, { error: 'Error al actualizar chat' });
  }
});


app.get("/api/mensajes/:id_chat", async (req, res) => {
  try {
    const { id_chat } = req.params;
    const [mensajes] = await pool.execute(
      'SELECT * FROM mensajes WHERE id_chat = ? AND eliminado = 0 ORDER BY fecha ASC',
      [id_chat]
    );
    return safeJson(res, 200, mensajes);
  } catch (error) {
    console.error('❌ Error obteniendo mensajes:', error);
    return safeJson(res, 500, { error: 'Error al obtener mensajes' });
  }
});

app.post("/api/mensajes", async (req, res) => {
  try {
    const { id_chat, contenido, rol = 'user' } = req.body;
    if (!id_chat || !contenido) return safeJson(res, 400, { error: "id_chat y contenido son requeridos" });

    
    const [result] = await pool.execute(
      'INSERT INTO mensajes (id_chat, rol, contenido) VALUES (?, ?, ?)',
      [id_chat, rol, contenido]
    );

   
    await pool.execute(
      'UPDATE chats SET fecha_actualizado = CURRENT_TIMESTAMP WHERE id_chat = ?',
      [id_chat]
    );

    let respuestaIA = '';

    if (rol === 'user') {
      console.log(`💬 Procesando mensaje para chat ${id_chat}: ${String(contenido).substring(0, 50)}...`);
     
      try {
        respuestaIA = await preguntarIA(contenido);
      } catch (err) {
        console.error("❌ Error en preguntarIA:", err);
        respuestaIA = "Lo siento, no pude procesar tu petición en este momento.";
      }

      
      await pool.execute(
        'INSERT INTO mensajes (id_chat, rol, contenido) VALUES (?, "bot", ?)',
        [id_chat, respuestaIA]
      );

      
      const [countRows] = await pool.execute(
        'SELECT COUNT(*) as count FROM mensajes WHERE id_chat = ? AND rol = "user"',
        [id_chat]
      );

      const mensajesCount = (countRows && countRows[0] && countRows[0].count) ? countRows[0].count : 0;

      if (mensajesCount === 1) {
        try {
          const promptTitulo = `
            Analiza la siguiente consulta del usuario y genera un título muy corto y descriptivo (máximo 4 palabras) para un chat.
            Consulta del usuario: "${contenido}"
            Responde SOLO con el título, nada más.
          `;
          const tituloChat = await preguntarIA(promptTitulo);
          const tituloLimpio = String(tituloChat).trim().substring(0, 40) || 'Nuevo chat';
          await pool.execute(
            'UPDATE chats SET titulo = ? WHERE id_chat = ?',
            [tituloLimpio, id_chat]
          );
          console.log(`📝 Título generado por IA: ${tituloLimpio}`);
        } catch (error) {
          console.error('❌ Error generando título con IA, usando título por defecto:', error);
          const tituloFallback = String(contenido).substring(0, 20) + (contenido.length > 20 ? '...' : '');
          await pool.execute(
            'UPDATE chats SET titulo = ? WHERE id_chat = ?',
            [tituloFallback, id_chat]
          );
        }
      }

      console.log(`✅ Respuesta IA generada para chat ${id_chat}`);
    }

    
    const [chatActualizado] = await pool.execute(
      'SELECT titulo FROM chats WHERE id_chat = ?',
      [id_chat]
    );

    return safeJson(res, 200, {
      respuesta: respuestaIA,
      id_mensaje: result.insertId,
      tituloChat: (chatActualizado && chatActualizado[0]) ? chatActualizado[0].titulo : null,
      id_chat: id_chat
    });

  } catch (error) {
    console.error('❌ Error guardando mensaje:', error);
    return safeJson(res, 500, {
      error: 'Error al guardar mensaje',
      respuesta: 'Lo siento, hubo un error al procesar tu mensaje.'
    });
  }
});


app.post("/api/chat", async (req, res) => {
  try {
    const { mensaje } = req.body;
    if (!mensaje) return safeJson(res, 400, { error: "Mensaje vacío" });

    console.log("💬 Pregunta recibida (chat público):", mensaje);
    const respuesta = await preguntarIA(mensaje);
    console.log("✅ Respuesta enviada al frontend");
    return safeJson(res, 200, { respuesta });
  } catch (error) {
    console.error("❌ Error en /api/chat:", error);
    return safeJson(res, 500, {
      error: "Error interno del servidor",
      respuesta: "Lo siento, hubo un error. Por favor intenta de nuevo."
    });
  }
});


app.delete("/api/chats/:id_chat", async (req, res) => {
  try {
    const { id_chat } = req.params;
    await pool.execute(
      'UPDATE chats SET eliminado = 1, fecha_actualizado = CURRENT_TIMESTAMP WHERE id_chat = ?',
      [id_chat]
    );
    return safeJson(res, 200, { mensaje: 'Chat eliminado' });
  } catch (error) {
    console.error('❌ Error eliminando chat:', error);
    return safeJson(res, 500, { error: 'Error al eliminar chat' });
  }
});

app.get("/health", async (req, res) => {
  try {
    const [result] = await pool.execute('SELECT 1 as test');
    return safeJson(res, 200, {
      status: "Servidor funcionando ✅",
      modelo: "Ministral",
      database: "Conectada ✅",
      caracteristicas: [
        "Búsqueda web en tiempo real",
        "IA Ministral",
        "Respuestas contextuales",
        "Chats persistentes",
        "Base de datos MySQL"
      ]
    });
  } catch (error) {
    console.error('❌ Error en health check:', error);
    return safeJson(res, 500, {
      status: "Servidor con problemas ❌",
      database: "Error de conexión ❌",
      error: error.message
    });
  }
});

app.get("/api/info", (req, res) => {
  return safeJson(res, 200, {
    nombre: "MatchTech API",
    version: "1.0.0",
    modelos: {
      ia: "Ministral",
      busqueda: "Tavily API"
    },
    endpoints: {
      publico: "/api/chat",
      chats: "/api/chats",
      mensajes: "/api/mensajes",
      health: "/health"
    }
  });
});


app.post("/api/pdf", (req, res) => {
  try {
    const { titulo, contenido } = req.body;
    if (!titulo || !contenido) return safeJson(res, 400, { error: "Faltan datos" });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${titulo}.pdf"`);

    const doc = new PDFDocument();
    doc.pipe(res);
    doc.fontSize(24).text(titulo, { align: "center" });
    doc.moveDown();
    doc.fontSize(12).text(contenido, { align: "left" });
    doc.end();
  } catch (error) {
    console.error("❌ Error generando PDF:", error);
    return safeJson(res, 500, { error: "Error generando PDF" });
  }
});


app.post("/api/enviarCorreo", async (req, res) => {
  try {
    const { email, titulo, contenido } = req.body;
    if (!email || !titulo || !contenido) return safeJson(res, 400, { error: "Faltan datos" });

 
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    const doc = new PDFDocument();
    const buffers = [];
    doc.on('data', (d) => buffers.push(d));
    doc.on('end', async () => {
      const pdfBuffer = Buffer.concat(buffers);

      try {
        await transporter.sendMail({
          from: `"MatchTech" <${process.env.EMAIL_USER || 'villamoradiegoandres@gmail.com'}>`,
          to: email,
          subject: `Chat compartido: ${titulo}`,
          text: "Adjunto encontrarás el PDF con la conversación.",
          attachments: [{ filename: `${titulo}.pdf`, content: pdfBuffer }]
        });

        return safeJson(res, 200, { ok: true, mensaje: "Correo enviado correctamente" });
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
    return safeJson(res, 500, { error: "No se pudo procesar la solicitud" });
  }
});


app.use((req, res) => {
  res.status(404).json({ error: "Endpoint no encontrado" });
});

app.use((err, req, res, next) => {
  console.error('❌ Error global:', err);
  res.status(500).json({
    error: "Error interno del servidor",
    mensaje: "Algo salió mal. Por favor intenta más tarde."
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌐 Servidor activo en puerto ${PORT}`);
});
