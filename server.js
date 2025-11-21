import express from "express";
import cors from "cors";
import { preguntarIA, probarModelo } from "./ia.js";
import mysql from 'mysql2/promise';
import PDFDocument from "pdfkit";
import nodemailer from "nodemailer";
import { PassThrough } from "stream";


const app = express();
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

const dbConfig = {
  host: "srv720.hstgr.io",
  user: "u529705423_matchtech",      
  password: "TechMatch2020",      
  database: "u529705423_pagina_isi"
};
const pool = mysql.createPool(dbConfig);

app.post("/api/chats", async (req, res) => {
  let connection;
  try {
    const { id_usuario, titulo = 'Nuevo chat' } = req.body;
    
    if (!id_usuario) {
      return res.status(400).json({ error: "id_usuario es requerido" });
    }

    connection = await pool.getConnection();
    const [result] = await connection.execute(
      'INSERT INTO chats (id_usuario, titulo) VALUES (?, ?)',
      [id_usuario, titulo]
    );

    res.json({ 
      id_chat: result.insertId,
      titulo,
      mensaje: 'Chat creado exitosamente'
    });

  } catch (error) {
    console.error('❌ Error creando chat:', error);
    res.status(500).json({ error: 'Error al crear chat' });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/chats/:id_usuario", async (req, res) => {
  let connection;
  try {
    const { id_usuario } = req.params;
    
    connection = await pool.getConnection();
    const [chats] = await connection.execute(
    'SELECT * FROM chats WHERE id_usuario = ? AND eliminado = 0 ORDER BY fecha_actualizado DESC',
    [id_usuario]
    );

    res.json(chats);

  } catch (error) {
    console.error('❌ Error obteniendo chats:', error);
    res.status(500).json({ error: 'Error al obtener chats' });
  } finally {
    if (connection) connection.release();
  }
});


app.put("/api/chats/:id_chat", async (req, res) => {
  let connection;
  try {
    const { id_chat } = req.params;
    const { titulo } = req.body;
    
    if (!titulo) {
      return res.status(400).json({ error: "titulo es requerido" });
    }

    connection = await pool.getConnection();
    await connection.execute(
      'UPDATE chats SET titulo = ?, fecha_actualizado = CURRENT_TIMESTAMP WHERE id_chat = ?',
      [titulo, id_chat]
    );

    res.json({ mensaje: 'Título actualizado' });

  } catch (error) {
    console.error('❌ Error actualizando chat:', error);
    res.status(500).json({ error: 'Error al actualizar chat' });
  } finally {
    if (connection) connection.release();
  }
});


app.get("/api/mensajes/:id_chat", async (req, res) => {
  let connection;
  try {
    const { id_chat } = req.params;
    
    connection = await pool.getConnection();
    const [mensajes] = await connection.execute(
      'SELECT * FROM mensajes WHERE id_chat = ? AND eliminado = 0 ORDER BY fecha ASC',
      [id_chat]
    );

    res.json(mensajes);

  } catch (error) {
    console.error('❌ Error obteniendo mensajes:', error);
    res.status(500).json({ error: 'Error al obtener mensajes' });
  } finally {
    if (connection) connection.release();
  }
});


app.post("/api/mensajes", async (req, res) => {
  let connection;
  try {
    const { id_chat, contenido, rol = 'user' } = req.body;
    
    if (!id_chat || !contenido) {
      return res.status(400).json({ error: "id_chat y contenido son requeridos" });
    }

    connection = await pool.getConnection();
    

    const [result] = await connection.execute(
      'INSERT INTO mensajes (id_chat, rol, contenido) VALUES (?, ?, ?)',
      [id_chat, rol, contenido]
    );


    await connection.execute(
      'UPDATE chats SET fecha_actualizado = CURRENT_TIMESTAMP WHERE id_chat = ?',
      [id_chat]
    );

    let respuestaIA = '';

  
    if (rol === 'user') {
      console.log(`💬 Procesando mensaje para chat ${id_chat}: ${contenido.substring(0, 50)}...`);
      
      respuestaIA = await preguntarIA(contenido);

      await connection.execute(
        'INSERT INTO mensajes (id_chat, rol, contenido) VALUES (?, "bot", ?)',
        [id_chat, respuestaIA]
      );

     
      const [mensajesCount] = await connection.execute(
        'SELECT COUNT(*) as count FROM mensajes WHERE id_chat = ? AND rol = "user"',
        [id_chat]
      );

      if (mensajesCount[0].count === 1) {
        try {
       
          const promptTitulo = `
          Analiza la siguiente consulta del usuario y genera un título muy corto y descriptivo (máximo 4 palabras) para un chat.
          El título debe capturar la esencia de lo que el usuario está preguntando.
          Ejemplos:
          - "Mejores celulares gaming 2024"
          - "Recomendaciones laptops trabajo"
          - "Dudas programación web"
          - "Ayuda configuración router"
          
          Consulta del usuario: "${contenido}"
          
          Responde SOLO con el título, nada más.
          `;
          
          const tituloChat = await preguntarIA(promptTitulo);
          
      
          const tituloLimpio = tituloChat.trim().substring(0, 40);
          
          await connection.execute(
            'UPDATE chats SET titulo = ? WHERE id_chat = ?',
            [tituloLimpio, id_chat]
          );
          
          console.log(`📝 Título generado por IA: ${tituloLimpio}`);
          
        } catch (error) {
          console.error('❌ Error generando título con IA, usando título por defecto:', error);
          const tituloFallback = contenido.substring(0, 20) + (contenido.length > 20 ? '...' : '');
          await connection.execute(
            'UPDATE chats SET titulo = ? WHERE id_chat = ?',
            [tituloFallback, id_chat]
          );
        }
      }

      console.log(`✅ Respuesta IA generada para chat ${id_chat}`);
    }

    connection.release();
    

    const [chatActualizado] = await connection.execute(
      'SELECT titulo FROM chats WHERE id_chat = ?',
      [id_chat]
    );

    res.json({ 
      respuesta: respuestaIA,
      id_mensaje: result.insertId,
      tituloChat: chatActualizado[0].titulo,
      id_chat: id_chat
    });

  } catch (error) {
    console.error('❌ Error guardando mensaje:', error);
    if (connection) connection.release();
    res.status(500).json({ 
      error: 'Error al guardar mensaje',
      respuesta: 'Lo siento, hubo un error al procesar tu mensaje.'
    });
  }
});


app.post("/api/chat", async (req, res) => {
  try {
    const { mensaje } = req.body;
    
    if (!mensaje) {
      return res.status(400).json({ error: "Mensaje vacío" });
    }

    console.log("💬 Pregunta recibida (chat público):", mensaje);
    
    const respuesta = await preguntarIA(mensaje);
    
    console.log("✅ Respuesta enviada al frontend");
    
    res.json({ respuesta });
    
  } catch (error) {
    console.error("❌ Error en /api/chat:", error);
    res.status(500).json({ 
      error: "Error interno del servidor",
      respuesta: "Lo siento, hubo un error. Por favor intenta de nuevo."
    });
  }
});


app.delete("/api/chats/:id_chat", async (req, res) => {
  let connection;
  try {
    const { id_chat } = req.params;
    
    connection = await pool.getConnection();
    await connection.execute(
      'UPDATE chats SET eliminado = 1, fecha_actualizado = CURRENT_TIMESTAMP WHERE id_chat = ?',
      [id_chat]
    );
    res.json({ mensaje: 'Chat eliminado' });

  } catch (error) {
    console.error('❌ Error eliminando chat:', error);
    res.status(500).json({ error: 'Error al eliminar chat' });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/health", async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const [result] = await connection.execute('SELECT 1 as test');
    connection.release();

    res.json({ 
      status: "Servidor funcionando ✅", 
      modelo: "deepseek.v3-v1:0",
      database: "Conectada ✅",
      caracteristicas: [
        "Búsqueda web en tiempo real", 
        "IA DeepSeek V3", 
        "Respuestas contextuales",
        "Chats persistentes",
        "Base de datos MySQL"
      ]
    });

  } catch (error) {
    console.error('❌ Error en health check:', error);
    if (connection) connection.release();
    res.status(500).json({ 
      status: "Servidor con problemas ❌",
      database: "Error de conexión ❌",
      error: error.message
    });
  }
});

app.get("/api/info", (req, res) => {
  res.json({
    nombre: "MatchTech API",
    version: "1.0.0",
    modelos: {
      ia: "deepseek.v3-v1:0",
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
  const { titulo, contenido } = req.body;

  if (!titulo || !contenido) {
    return res.status(400).json({ error: "Faltan datos" });
  }

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${titulo}.pdf"`);

  const doc = new PDFDocument();
  doc.pipe(res);

  doc.fontSize(24).text(titulo, { align: "center" });
  doc.moveDown();
  doc.fontSize(12).text(contenido, { align: "left" });

  doc.end();
});

app.post("/api/enviarCorreo", async (req, res) => {
  const { email, titulo, contenido } = req.body;

  if (!email || !titulo || !contenido) {
    return res.status(400).json({ error: "Faltan datos" });
  }

  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: "villamoradiegoandres@gmail.com",
        pass: "sfud qgxv gtcp nslz" 
      }
    });


    const pdfStream = new PassThrough();
    const doc = new PDFDocument();

    doc.pipe(pdfStream);

    doc.fontSize(24).text(titulo, { align: "center" });
    doc.moveDown();
    doc.fontSize(12).text(contenido);

    doc.end();

    const buffers = [];
    pdfStream.on("data", (data) => buffers.push(data));
    pdfStream.on("end", async () => {
      const pdfBuffer = Buffer.concat(buffers);

      await transporter.sendMail({
        from: '"MatchTech" <villamoradiegoandres@gmail.com>',
        to: email,
        subject: `Chat compartido: ${titulo}`,
        text: "Adjunto encontrarás el PDF con la conversación.",
        attachments: [
          {
            filename: `${titulo}.pdf`,
            content: pdfBuffer
          }
        ]
      });

      res.json({ ok: true, mensaje: "Correo enviado correctamente" });
    });
  } catch (error) {
    console.error("❌ Error enviando correo:", error);
    res.status(500).json({ error: "No se pudo enviar el correo" });
  }
});


app.use((req, res) => {
  res.status(404).json({ error: "Endpoint no encontrado" });
});


app.use((error, req, res, next) => {
  console.error('❌ Error global:', error);
  res.status(500).json({ 
    error: "Error interno del servidor",
    mensaje: "Algo salió mal. Por favor intenta más tarde."
  });
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌐 Servidor activo`);
});