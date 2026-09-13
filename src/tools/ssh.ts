import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { NodeSSH } from "node-ssh";

const ssh = new NodeSSH();

// Helper function to connect (or reuse connection)
async function connectSSH() {
  if (ssh.isConnected()) return;

  const host = process.env.SSH_HOST;
  const username = process.env.SSH_USERNAME;
  // Puede ser la ruta a la llave (ej. /home/user/.ssh/id_rsa) o la contraseña
  let privateKeyPath = process.env.SSH_PRIVATE_KEY_PATH; 
  const password = process.env.SSH_PASSWORD;

  // Validate if the key path is valid, if not, ignore it so it falls back to password
  if (privateKeyPath) {
    const fs = require('fs');
    if (!fs.existsSync(privateKeyPath)) {
      console.warn(`[DevOps SSH] ⚠️ Advertencia: La llave SSH no existe en la ruta '${privateKeyPath}'. Ignorando y usando contraseña...`);
      privateKeyPath = undefined;
    }
  }

  if (!host || !username) {
    throw new Error("Faltan variables SSH_HOST y/o SSH_USERNAME en el archivo .env");
  }
  
  if (!privateKeyPath && !password) {
    throw new Error("Falta configuración válida de llave SSH o contraseña en el archivo .env");
  }

  await ssh.connect({
    host,
    username,
    privateKeyPath: privateKeyPath || undefined,
    password: password || undefined,
  });
}

export const executeSSHCommandTool = tool(
  async ({ command }) => {
    try {
      console.log(`\n[DevOps SSH] 🔄 Iniciando conexión con ${process.env.SSH_HOST}...`);
      await connectSSH();
      
      // Imprime el comando en la consola del servidor local para que el usuario pueda auditarlo
      console.log(`\n[DevOps SSH] 👨‍💻 Ejecutando comando remoto: ${command}`);
      
      const result = await ssh.execCommand(command);
      
      let output = "";
      if (result.stdout) output += `STDOUT:\n${result.stdout}\n`;
      if (result.stderr) output += `STDERR:\n${result.stderr}\n`;
      
      if (result.code !== 0 && result.code !== null) {
        output += `Exit code: ${result.code}\n`;
      }
      
      return output.trim() || "Comando ejecutado con éxito, pero no devolvió ninguna salida (output).";
    } catch (error: any) {
      return `Error al ejecutar el comando SSH: ${error.message}`;
    }
  },
  {
    name: "execute_ssh_command",
    description: "Ejecuta un comando bash en el servidor remoto principal (DevOps). Útil para ver estado del sistema (uptime, free -h), ver logs, o reiniciar servicios.",
    schema: z.object({
      command: z.string().describe("El comando bash o script a ejecutar en el servidor remoto."),
    }),
  }
);
