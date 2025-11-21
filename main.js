document.addEventListener("DOMContentLoaded", () => {
  const sendBtn = document.getElementById("sendBtn");
  const userInput = document.getElementById("userInput");
  const chatContainer = document.getElementById("chatContainer");
  const mainContent = document.querySelector(".main-content");

  console.log("sendBtn:", sendBtn);
  console.log("userInput:", userInput);
  console.log("chatContainer:", chatContainer);
  console.log("mainContent:", mainContent);

  if (!sendBtn || !userInput || !chatContainer || !mainContent) {
    console.error("❌ ERROR: No se encontraron elementos del DOM");
    return;
  }

  sendBtn.addEventListener("click", enviarMensaje);
  userInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") enviarMensaje();
  });

  async function enviarMensaje() {
    console.log("🟡 Función enviarMensaje ejecutándose");
    
    const texto = userInput.value.trim();
    console.log("Texto ingresado:", texto);
    
    if (!texto) {
      console.log("❌ Texto vacío, no se envía");
      return;
    }

    if (chatContainer.classList.contains("oculto")) {
      console.log("🟡 Activando modo chat por primera vez");
      
      mainContent.classList.add("chat-active");
      
      chatContainer.classList.remove("oculto");
      chatContainer.innerHTML = "";
      
      console.log("✅ Modo chat activado");
    }

    console.log("🟡 Agregando mensaje del usuario");
    agregarMensaje(texto, "user");
    userInput.value = "";

    try {
      console.log("🟡 Enviando mensaje al backend...");
      
      const res = await fetch("http://localhost:3000/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ mensaje: texto })
      });

      console.log("✅ Respuesta HTTP recibida:", res.status);
      
      if (!res.ok) {
        throw new Error(`Error HTTP: ${res.status}`);
      }

      const data = await res.json();
      console.log("✅ Datos recibidos:", data);
      
      agregarMensaje(data.respuesta || "⚠️ Respuesta vacía", "bot");

    } catch (error) {
      console.error("❌ Error al conectar al servidor:", error);
      
      agregarMensaje("🔧 Error de conexión: " + error.message, "bot");
      
      setTimeout(() => {
        agregarMensaje("¡Hola! Soy MatchTech. Parece que hay un problema de conexión con el servidor de IA.", "bot");
      }, 500);
    }
  }
  
  function agregarMensaje(texto, tipo) {
    console.log("🟡 Agregando mensaje:", texto, "tipo:", tipo);
    
    const div = document.createElement("div");
    div.className = tipo === "user" ? "message user" : "message bot";
    div.textContent = texto;
    chatContainer.appendChild(div);
    chatContainer.scrollTop = chatContainer.scrollHeight;
    
    console.log("✅ Mensaje agregado al DOM");
  }
});