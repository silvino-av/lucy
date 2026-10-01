import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { NodeSSH } from "node-ssh";
import { execFile } from "child_process";
import fs from "fs";
import { findServer, getServers, type ServerConfig } from "../config/servers";

// Pool de conexiones NodeSSH por servidor para fallback
const connectionPool = new Map<string, NodeSSH>();

/**
 * Ejecuta un comando en un servidor remoto.
 * 1. Intenta primero con OpenSSH nativo del sistema (utiliza las llaves y configuración SSH del usuario).
 * 2. Si falla y existe contraseña/llave configurada, usa NodeSSH como fallback.
 */
async function executeOnRemoteServer(server: ServerConfig, command: string): Promise<string> {
  const host = server.host;
  const user = server.user;
  const port = server.port || 22;

  console.log(`\n[DevOps SSH] 🔄 Conectando a [${server.id}] (${user}@${host}:${port})...`);

  // 1. Método nativo OpenSSH (con llaves del sistema)
  const nativeResult = await new Promise<{ success: boolean; output: string }>((resolve) => {
    const args = [
      "-o", "BatchMode=yes",
      "-o", "ConnectTimeout=7",
      "-o", "StrictHostKeyChecking=accept-new",
      "-p", port.toString(),
      `${user}@${host}`,
      command,
    ];

    execFile("ssh", args, { timeout: 30000 }, (error, stdout, stderr) => {
      if (!error) {
        let out = "";
        if (stdout) out += stdout;
        if (stderr) out += `\nSTDERR:\n${stderr}`;
        resolve({ success: true, output: out.trim() });
      } else {
        resolve({ success: false, output: stderr || error.message });
      }
    });
  });

  if (nativeResult.success) {
    console.log(`[DevOps SSH] ✅ Comando ejecutado exitosamente vía OpenSSH en [${server.id}]`);
    return nativeResult.output || `[${server.name}] Comando ejecutado con éxito, sin salida de texto.`;
  }

  // 2. Método de respaldo: NodeSSH con contraseña o llave explícita (si está configurada)
  const password = server.password || process.env.SSH_PASSWORD;
  const privateKeyPath = server.privateKeyPath || process.env.SSH_PRIVATE_KEY_PATH;

  if (!password && !privateKeyPath) {
    return `[Servidor: ${server.name} (${server.host})]\nError de autenticación SSH: ${nativeResult.output.trim()}\n(Asegúrate de haber copiado tu llave SSH pública al servidor con: ssh-copy-id ${user}@${host})`;
  }

  try {
    let ssh = connectionPool.get(server.id);
    if (!ssh || !ssh.isConnected()) {
      ssh = new NodeSSH();
      await ssh.connect({
        host,
        username: user,
        port,
        password: password || undefined,
        privateKeyPath: (privateKeyPath && fs.existsSync(privateKeyPath)) ? privateKeyPath : undefined,
        readyTimeout: 7000,
      });
      connectionPool.set(server.id, ssh);
    }

    const result = await ssh.execCommand(command);
    let output = "";
    if (result.stdout) output += result.stdout;
    if (result.stderr) output += `\nSTDERR:\n${result.stderr}`;
    if (result.code !== 0 && result.code !== null) {
      output += `\nExit code: ${result.code}`;
    }
    return output.trim() || `[${server.name}] Comando ejecutado con éxito, sin salida de texto.`;
  } catch (err: any) {
    return `[Servidor: ${server.name} (${server.host})]\nError al ejecutar comando: ${err.message}`;
  }
}

export const executeSSHCommandTool = tool(
  async ({ command, server: serverQuery }) => {
    try {
      const server = findServer(serverQuery);
      if (!server) {
        return `Error: No se encontró ningún servidor configurado que coincida con "${serverQuery || 'default'}". Usa 'list_servers' para ver los servidores disponibles.`;
      }

      console.log(`\n[DevOps SSH] 👨‍💻 [${server.id}] Ejecutando: ${command}`);
      const output = await executeOnRemoteServer(server, command);
      return `[Servidor: ${server.name} (${server.host})]\n${output}`;
    } catch (error: any) {
      return `Error al ejecutar comando SSH en ${serverQuery || 'servidor'}: ${error.message}`;
    }
  },
  {
    name: "execute_ssh_command",
    description: "Ejecuta un comando bash en un servidor remoto de Silvino. Puedes especificar el alias o ID del servidor (ej. 'principal', 'db'). Si no se indica, se ejecuta en el servidor principal por defecto.",
    schema: z.object({
      command: z.string().describe("El comando bash o script a ejecutar en el servidor."),
      server: z.string().optional().describe("El ID o alias del servidor donde ejecutar el comando (ej: 'principal', 'db'). Si se omite, se usa el servidor por defecto."),
    }),
  }
);

export const listServersTool = tool(
  async () => {
    const servers = getServers();
    if (servers.length === 0) {
      return "No hay servidores registrados en servers.json ni en el archivo .env.";
    }

    let report = `🖥️ Servidores registrados para administración (${servers.length}):\n\n`;
    for (const s of servers) {
      const isDefaultText = s.isDefault ? " ⭐ (Por defecto)" : "";
      report += `• [${s.id}] ${s.name}${isDefaultText}\n`;
      report += `  Destino: ${s.user}@${s.host}:${s.port || 22}\n`;
      if (s.description) {
        report += `  Función: ${s.description}\n`;
      }
      report += `\n`;
    }

    return report.trim();
  },
  {
    name: "list_servers",
    description: "Lista todos los servidores registrados en el catálogo servers.json de Lucy, mostrando sus alias, hosts y funciones.",
    schema: z.object({}),
  }
);
