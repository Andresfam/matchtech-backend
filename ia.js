import dotenv from "dotenv";
dotenv.config();
import fetch from "node-fetch";
import AWS from "aws-sdk";

const TAVILY_API_KEY = process.env.TAVILY_API_KEY;;

export async function buscarEnInternet(query) {
  try {
    console.log("🔍 Buscando en internet:", query);

    if (!query || query.trim() === "") {
      console.log("⚠️ Consulta vacía, no se puede buscar en Tavily");
      return [];
    }

    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY,
        query: query,
        search_depth: "basic",
        max_results: 5
      })
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Tavily API error: ${res.status} → ${errorText}`);
    }

    const data = await res.json();
    console.log("✅ Resultados Tavily encontrados:", data.results?.length || 0);
    return data.results || [];

  } catch (err) {
    console.error("❌ Error en Tavily:", err);
    return [];
  }
}


const MODEL_ID = "mistral.mistral-large-2407-v1:0";

const bedrock = new AWS.BedrockRuntime({
  region: "us-west-2",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY,
    secretAccessKey: process.env.AWS_SECRET_KEY
  }
});


export async function deepseekResponder(prompt) {
  try {
    const body = JSON.stringify({
      messages: [
        {
          role: "user",
          content: prompt
        }
      ],
      max_tokens: 3000,
      temperature: 0.7,
      top_p: 0.9
    });

    const params = {
      modelId: MODEL_ID,
      contentType: "application/json",
      accept: "application/json",
      body: body
    };

    const response = await bedrock.invokeModel(params).promise();

    const responseBody = JSON.parse(Buffer.from(response.body).toString());

    let respuestaTexto = "";

    if (responseBody.choices?.[0]?.message?.content) {
      respuestaTexto = responseBody.choices[0].message.content;
    } else if (responseBody.text) {
      respuestaTexto = responseBody.text;
    } else {
      respuestaTexto = "No pude interpretar la respuesta del modelo.";
    }

    return respuestaTexto.trim();

  } catch (err) {
    console.error("❌ ERROR en:", err);
    return `Error: ${err.message}`;
  }
}


function analizarIntencion(pregunta) {
  const preguntaLower = pregunta.toLowerCase().trim();

  const saludosMatchTech = [
    'hola match', 'hola matchtech', 'hey match', 'hola match tech',
    'match tech', 'matchtech', 'buenos días match', 'buenas tardes match',
    'qué tal match', 'cómo estás match'
  ];

  const saludosGenericos = [
    'hola', 'hey', 'hi', 'buenos días', 'buenas tardes', 'buenas noches',
    'qué tal', 'cómo estás', 'saludos'
  ];

  const preguntasIdentidad = [
    'quién eres', 'qué eres', 'cuál es tu nombre', 'cómo te llamas',
    'eres una ia', 'eres un bot', 'eres humano'
  ];

  if (saludosMatchTech.some(s => preguntaLower.includes(s))) return 'saludo_personalizado';
  if (saludosGenericos.some(s => preguntaLower === s)) return 'saludo_generico';
  if (preguntasIdentidad.some(p => preguntaLower.includes(p))) return 'identidad';

  return 'consulta_general';
}

function esDispositivoElectronico(pregunta) {
  const dispositivos = [
    "celular", "celulares", "smartphone", "iphone", "android",
    "computador", "computadores", "laptop", "portátil", "pc",
    "tablet", "tableta","tablets",
    "televisor", "tv", "smart tv",
    "nevera", "refrigerador", "nevera inteligente",
    "lavadora", "lavadora inteligente",
    "monitor",
    "audífonos", "audifonos", "headphones",
    "reloj", "smartwatch", "reloj inteligente",
    "teclado", "mouse", "ratón"
  ];

  const texto = pregunta.toLowerCase();
  return dispositivos.some(p => texto.includes(p));
}



function extraerTemaRelevante(textoOriginal) {

  
  const palabrasIgnorar = [
    "hola", "hey", "buenas", "por", "favor", "pls", "quiero", "quisiera",
    "dame", "damé", "busco", "necesito", "información", "datos", "info",
    "sobre", "acerca", "de", "hola!"
  ];


  const nacionalidades = [
    "colombiano", "colombiana", "mexicano", "mexicana",
    "argentino", "argentina", "chileno", "chilena",
    "español", "española", "peruano", "peruana",
    "venezolano", "venezolana"
  ];

  
  const generos = [
    "realismo mágico", "realismo", "ficción", "literatura",
    "novela", "cuento", "poesía", "ensayo", "crónica"
  ];

 
  let textoLimpio = " " + textoOriginal.toLowerCase() + " ";
  for (let p of palabrasIgnorar) {
    textoLimpio = textoLimpio.replace(new RegExp("\\b" + p + "\\b", "gi"), " ");
  }
  textoLimpio = textoLimpio.replace(/\s+/g, " ").trim();

  const palabras = textoOriginal.split(/\s+/);


  const nombres = [];
  let buffer = [];

  for (let palabra of palabras) {
    const esNombre = /^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+$/.test(palabra)
      && !palabrasIgnorar.includes(palabra.toLowerCase());

    if (esNombre) {
      buffer.push(palabra);
    } else {
      if (buffer.length > 0) {
        nombres.push(buffer.join(" "));
        buffer = [];
      }
    }
  }

  if (buffer.length > 0) nombres.push(buffer.join(" "));


  const nombresFinales = [...new Set(
    nombres.filter(n => n.split(" ").length >= 2)
  )];

  const nacionalidadesDetectadas = nacionalidades.filter(n =>
    textoLimpio.includes(n)
  );

  const generosDetectados = generos.filter(g =>
    textoLimpio.includes(g)
  );

 
  let obras = textoOriginal.match(/[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(\s+[A-ZÁÉÍÓÚÑ]?[a-záéíóúñ]+){2,6}/g) || [];

 
  obras = obras.filter(o => !/\bde$|\bdel$/.test(o.toLowerCase()));

  obras = obras.filter(o => !nombresFinales.includes(o));

  const obrasFinales = [...new Set(obras)];

  
  const partes = [];

 
  if (nombresFinales.length > 0) {
    const nombre = nombresFinales[0];
    const nac = nacionalidadesDetectadas.length > 0
      ? nacionalidadesDetectadas[0]
      : "";

    partes.push(
      nac
        ? `el autor ${nac} ${nombre}`
        : `el autor ${nombre}`
    );
  }

  if (obrasFinales.length > 0) {
    const obra = obrasFinales[0];
    const genero = generosDetectados.length > 0
      ? generosDetectados[0]
      : "";

    partes.push(
      genero
        ? `su ${genero} titulada ${obra}`
        : `su novela ${obra}`
    );
  }

  if (partes.length === 0) return textoLimpio || textoOriginal;

  return partes.join(" y ");
}



export async function preguntarIA(pregunta) {
  try {
    console.log(`🧠 Procesando: "${pregunta}"`);

    const intencion = analizarIntencion(pregunta);

    if (intencion === 'saludo_personalizado')
      return `¡Hola! 😊 Soy MatchTech, tu asistente de IA. ¿En qué puedo ayudarte hoy?`;

    if (intencion === 'saludo_generico')
      return `¡Hola! 👋 Soy MatchTech, tu asistente de confianza. ¿Qué necesitas saber?`;

    if (intencion === 'identidad')
      return `Soy MatchTech, tu asistente de inteligencia artificial listo para ayudarte con tecnología y dispositivos electrónicos.`;

      if (!esDispositivoElectronico(pregunta)) {
        const tema = extraerTemaRelevante(pregunta);

        return `¡Vaya! 😯
      Parece que estás buscando información sobre ${tema}, pero lamentablemente solo estoy hecho para conectarte con tu nuevo amigo electrónico 🧑‍💻🤝🔌  
      Pero aquí estaré por si necesitas ayuda con eso.`;
      }



    const resultados = await buscarEnInternet(pregunta);

    let seccionContexto = "";
    if (resultados.length > 0) {
      seccionContexto =
        resultados.map(r =>
          `Título: ${r.title}\nContenido: ${r.content.substring(0, 250)}...\nURL: ${r.url}`
        ).join("\n\n");
    } else {
      seccionContexto = "No se encontró información específica.";
    }

    const prompt = `Eres MatchTech, un asistente experto en dispositivos electrónicos.

El usuario pregunta: "${pregunta}"

INFORMACIÓN DE INTERNET:
${seccionContexto}

REGLAS IMPORTANTES:
1. Si el usuario pide un dispositivo electrónico, DEBES recomendar SIEMPRE 5 productos en formato:

📱 Nombre del producto  
• Descripción del producto (pantalla, batería, procesador, rendimiento, cámara, construcción, para qué sirve)  
• Precio aproximado en COP  
• Link de Mercado Libre usando este formato:  
  https://listado.mercadolibre.com.co/{nombre-del-producto-sin-espacios}

2. Si menciona un presupuesto, respeta ese rango.

3. Debes ser descriptivo y claro, estilo experto amable.

4. Prohibido mencionar “búsquedas web”, “Tavily”, “fuente”, ni nada técnico.  

5. Responde en texto plano.  

RESPUESTA:`;

    const respuesta = await deepseekResponder(prompt);

    let respuestaFinal = respuesta
      .replace(/\*\*/g, "")
      .replace(/`/g, "")
      .trim();

    return respuestaFinal;

  } catch (error) {
    console.error("❌ Error en preguntarIA:", error);

    return `Ups… tuve un problema procesando tu mensaje, pero ya estoy listo para intentarlo de nuevo. 😊`;
  }
}


export async function probarModelo() {
  console.log("🧪 Probando conexión con DeepSeek V3...");
  const testPrompt = "Hola Match, ¿cómo estás?";

  try {
    const respuesta = await preguntarIA(testPrompt);
    console.log("✅ Respuesta:", respuesta);
    return true;
  } catch (error) {
    console.error("❌ Error:", error);
    return false;
  }
}
