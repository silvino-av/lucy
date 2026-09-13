import { tool } from "@langchain/core/tools";
import { z } from "zod";

export const getCurrentTimeTool = tool(
  () => {
    const now = new Date();
    const options: Intl.DateTimeFormatOptions = { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short',
      timeZone: 'America/Mexico_City'
    };
    return `La fecha y hora actual del sistema es: ${now.toLocaleDateString('es-ES', options)}`;
  },
  {
    name: "get_current_time",
    description: "Usa esta herramienta SIEMPRE que necesites saber qué día, hora o fecha es hoy en el mundo real.",
    schema: z.object({}),
  }
);
